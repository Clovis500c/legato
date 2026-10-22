//! One plugin = one thread with its own QuickJS runtime: 64 MB of memory, 1 s per entry (an event, a reply, a timer)
//! before it's interrupted, nothing but the `app` bridge. Calls leave as `Call`s (permission checked here first);
//! answers and events come back through `Running`.

use crate::manifest::Manifest;
use crate::perms::{self, Permission, Route};
use rquickjs::{CatchResultExt, Context, Ctx, Function, Runtime};
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

const PRELUDE: &str = include_str!("prelude.js");
const MEMORY: usize = 64 << 20;
const STACK: usize = 1 << 20;
/// One entry into the plugin's code may run this long.
const BUDGET: Duration = Duration::from_secs(1);
/// Interrupted this many times: stopped.
const MAX_OVERRUNS: u32 = 3;
const MAX_PENDING: usize = 256;
const MAX_TIMERS: usize = 64;
const MIN_INTERVAL_MS: u64 = 50;

/// A plugin asks the app for something (permission already granted).
#[derive(Debug, Clone, PartialEq)]
pub struct Call {
    pub plugin: String,
    pub id: u64,
    pub method: String,
    pub args: Value,
    pub route: Route,
}

/// The app side: carries calls out, keeps logs, hears about crashes.
pub trait Outbox: Send + Sync + 'static {
    fn call(&self, call: Call);
    fn log(&self, plugin: &str, level: &str, text: &str);
    fn stopped(&self, plugin: &str, error: Option<String>);
}

enum Msg {
    Event(String, Value),
    Reply(u64, Result<Value, String>),
    Stop,
}

/// A started plugin.
pub struct Running {
    pub manifest: Manifest,
    granted: Vec<Permission>,
    tx: Sender<Msg>,
    thread: Option<JoinHandle<()>>,
}

impl Running {
    /// Starts `code` with the permissions the user approved (a subset of the manifest's).
    pub fn start(manifest: Manifest, granted: Vec<Permission>, code: String, app_version: &str, out: Arc<dyn Outbox>) -> Self {
        let (tx, rx) = mpsc::channel();
        let (m, g, v) = (manifest.clone(), granted.clone(), app_version.to_string());
        let thread = std::thread::Builder::new()
            .name(format!("plugin {}", manifest.id))
            .spawn(move || {
                let id = m.id.clone();
                let error = run(m, g, code, &v, out.clone(), rx).err();
                out.stopped(&id, error);
            })
            .ok();
        Self { manifest, granted, tx, thread }
    }

    /// An app event, if the plugin may hear it.
    pub fn event(&self, name: &str, payload: Value) {
        if perms::may_receive(&self.granted, name) {
            let _ = self.tx.send(Msg::Event(name.into(), payload));
        }
    }

    pub fn reply(&self, id: u64, result: Result<Value, String>) {
        let _ = self.tx.send(Msg::Reply(id, result));
    }

    pub fn granted(&self) -> &[Permission] {
        &self.granted
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        let _ = self.tx.send(Msg::Stop);
        // Not joined: a plugin stuck in a long call is interrupted within BUDGET and exits by itself.
        drop(self.thread.take());
    }
}

#[derive(Default)]
struct Timers {
    next: u64,
    due: BTreeMap<(Instant, u64), (u64, bool)>,
}

impl Timers {
    fn set(&mut self, ms: u64, repeat: bool) -> Option<u64> {
        if self.due.len() >= MAX_TIMERS {
            return None;
        }
        self.next += 1;
        let ms = if repeat { ms.max(MIN_INTERVAL_MS) } else { ms };
        self.due.insert((Instant::now() + Duration::from_millis(ms), self.next), (ms, repeat));
        Some(self.next)
    }

    fn clear(&mut self, id: u64) {
        self.due.retain(|(_, i), _| *i != id);
    }

    fn first(&self) -> Option<Instant> {
        self.due.keys().next().map(|(at, _)| *at)
    }

    /// Timers due now (repeating ones put back).
    fn fire(&mut self) -> Vec<u64> {
        let now = Instant::now();
        let mut out = Vec::new();
        while let Some(((at, id), (ms, repeat))) = self.due.first_key_value().map(|(k, v)| (*k, *v)) {
            if at > now {
                break;
            }
            self.due.remove(&(at, id));
            if repeat {
                self.due.insert((now + Duration::from_millis(ms), id), (ms, repeat));
            }
            out.push(id);
        }
        out
    }
}

/// Message of what the plugin threw.
fn thrown(ctx: &Ctx, e: rquickjs::Error) -> String {
    match e {
        rquickjs::Error::Exception => {
            let v = ctx.catch();
            v.as_exception().map(|x| format!("{}{}", x.message().unwrap_or_default(), x.stack().map(|s| format!("\n{s}")).unwrap_or_default())).unwrap_or_else(|| format!("{v:?}"))
        }
        e => e.to_string(),
    }
}

fn run(m: Manifest, granted: Vec<Permission>, code: String, app_version: &str, out: Arc<dyn Outbox>, rx: Receiver<Msg>) -> Result<(), String> {
    let rt = Runtime::new().map_err(|e| e.to_string())?;
    rt.set_memory_limit(MEMORY);
    rt.set_max_stack_size(STACK);
    let start = Instant::now();
    let deadline = Arc::new(AtomicU64::new(u64::MAX));
    let d = deadline.clone();
    rt.set_interrupt_handler(Some(Box::new(move || start.elapsed().as_millis() as u64 > d.load(Ordering::Relaxed))));
    let arm = || deadline.store((start.elapsed() + BUDGET).as_millis() as u64, Ordering::Relaxed);
    let disarm = || deadline.store(u64::MAX, Ordering::Relaxed);
    let ctx = Context::full(&rt).map_err(|e| e.to_string())?;
    let timers = Rc::new(RefCell::new(Timers::default()));
    let pending = Rc::new(Cell::new(0usize));
    let next_call = Rc::new(Cell::new(0u64));

    // Host function: every call from the plugin. Answers JSON: {ok}, {pending: id} or {err}.
    let host = {
        let (timers, pending, next_call, out, plugin) = (timers.clone(), pending.clone(), next_call.clone(), out.clone(), m.id.clone());
        move |method: String, args: String| -> String {
            let args: Value = serde_json::from_str(&args).unwrap_or(Value::Null);
            let answer = match method.as_str() {
                "timer.set" => match timers.borrow_mut().set(args["ms"].as_u64().unwrap_or(0), args["repeat"].as_bool().unwrap_or(false)) {
                    Some(id) => json!({ "ok": id }),
                    None => json!({ "err": "Too many timers" }),
                },
                "timer.clear" => {
                    timers.borrow_mut().clear(args["id"].as_u64().unwrap_or(0));
                    json!({ "ok": null })
                }
                "log" => {
                    out.log(&plugin, args["level"].as_str().unwrap_or("info"), args["text"].as_str().unwrap_or_default());
                    json!({ "ok": null })
                }
                _ => match perms::check(&granted, &method, &args) {
                    Err(e) => json!({ "err": e }),
                    Ok(_) if pending.get() >= MAX_PENDING => json!({ "err": "Too many calls waiting for an answer" }),
                    Ok(route) => {
                        let id = next_call.get() + 1;
                        next_call.set(id);
                        pending.set(pending.get() + 1);
                        out.call(Call { plugin: plugin.clone(), id, method, args, route });
                        json!({ "pending": id })
                    }
                },
            };
            answer.to_string()
        }
    };

    let info = json!({ "id": m.id, "api": crate::manifest::API, "appVersion": app_version }).to_string();
    arm();
    let started: Result<(), String> = ctx.with(|ctx| {
        let g = ctx.globals();
        g.set("__host", Function::new(ctx.clone(), host).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        g.set("__plugin", info).map_err(|e| e.to_string())?;
        ctx.eval::<(), _>(PRELUDE).catch(&ctx).map_err(|e| format!("prelude: {e}"))?;
        ctx.eval::<(), _>(code).map_err(|e| thrown(&ctx, e))?;
        Ok(())
    });
    started?;
    let mut overruns = 0u32;
    let jobs = || {
        arm();
        while rt.is_job_pending() {
            if rt.execute_pending_job().is_err() {
                break;
            }
        }
        disarm();
    };
    jobs();

    loop {
        let wait = timers.borrow().first().map_or(Duration::from_secs(3600), |at| at.saturating_duration_since(Instant::now()));
        let entries: Vec<(&str, String)> = match rx.recv_timeout(wait) {
            Ok(Msg::Stop) | Err(RecvTimeoutError::Disconnected) => return Ok(()),
            Ok(Msg::Event(name, payload)) => vec![("event", json!({ "name": name, "payload": payload }).to_string())],
            Ok(Msg::Reply(id, r)) => {
                pending.set(pending.get().saturating_sub(1));
                vec![("reply", match r {
                    Ok(value) => json!({ "id": id, "ok": true, "value": value }),
                    Err(error) => json!({ "id": id, "ok": false, "error": error }),
                }
                .to_string())]
            }
            Err(RecvTimeoutError::Timeout) => timers.borrow_mut().fire().into_iter().map(|id| ("timer", json!({ "id": id }).to_string())).collect(),
        };
        for (kind, payload) in entries {
            arm();
            let r: Result<(), String> = ctx.with(|ctx| {
                let f: Function = ctx.globals().get("__dispatch").map_err(|e| e.to_string())?;
                f.call::<_, ()>((kind, payload)).map_err(|e| thrown(&ctx, e))
            });
            disarm();
            if let Err(e) = r {
                out.log(&m.id, "error", &e);
                if e.contains("interrupted") {
                    overruns += 1;
                    if overruns >= MAX_OVERRUNS {
                        return Err("Stopped: it kept running too long".into());
                    }
                }
            }
        }
        jobs();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct Spy {
        calls: Mutex<Vec<Call>>,
        logs: Mutex<Vec<String>>,
        stopped: Mutex<Option<Option<String>>>,
    }

    impl Outbox for Spy {
        fn call(&self, call: Call) {
            self.calls.lock().unwrap().push(call);
        }
        fn log(&self, _: &str, level: &str, text: &str) {
            self.logs.lock().unwrap().push(format!("{level}: {text}"));
        }
        fn stopped(&self, _: &str, error: Option<String>) {
            *self.stopped.lock().unwrap() = Some(error);
        }
    }

    fn manifest() -> Manifest {
        Manifest::parse(r#"{"id":"test.plugin","name":"Test","version":"1","author":"me","api":1,"permissions":["player:control","ui"]}"#).unwrap()
    }

    fn wait_for(cond: impl Fn() -> bool) {
        let end = Instant::now() + Duration::from_secs(5);
        while !cond() && Instant::now() < end {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(cond(), "timed out");
    }

    fn start(code: &str, granted: Vec<Permission>) -> (Running, Arc<Spy>) {
        let spy = Arc::new(Spy::default());
        let r = Running::start(manifest(), granted, code.into(), "1.2.3", spy.clone());
        (r, spy)
    }

    #[test]
    fn calls_go_out_and_answers_come_back() {
        let (r, spy) = start(
            "app.player.next().then((v) => console.log('next done', v)); app.library.tracks().catch((e) => console.log('refused:', e.message)); console.log(app.id, app.appVersion)",
            vec![Permission::PlayerControl],
        );
        wait_for(|| spy.calls.lock().unwrap().len() == 1);
        let call = spy.calls.lock().unwrap()[0].clone();
        assert_eq!((call.method.as_str(), call.route), ("player.next", Route::Ui));
        r.reply(call.id, Ok(json!(42)));
        wait_for(|| spy.logs.lock().unwrap().iter().any(|l| l == "info: next done 42"));
        let logs = spy.logs.lock().unwrap().join("\n");
        assert!(logs.contains("refused: Permission needed: library:read"), "{logs}");
        assert!(logs.contains("test.plugin 1.2.3"), "{logs}");
    }

    #[test]
    fn events_need_their_permission_and_commands_run() {
        let code = "app.on('track', (t) => console.log('track', t.title)); app.ui.addCommand({ id: 'hi', title: 'Hi', run: (c) => console.log('ran', c.trackId) })";
        let (r, spy) = start(code, vec![Permission::Ui]);
        r.event("track", json!({ "title": "Song" }));
        r.event("command", json!({ "id": "hi", "context": { "trackId": 7 } }));
        wait_for(|| spy.logs.lock().unwrap().iter().any(|l| l == "info: ran 7"));
        // No player:read: the track event never reached it.
        assert!(!spy.logs.lock().unwrap().iter().any(|l| l.contains("track Song")));
        assert_eq!(spy.calls.lock().unwrap()[0].method, "ui.addCommand");
    }

    #[test]
    fn timers_fire_and_clear() {
        let (_r, spy) = start("let n = 0; const id = setInterval(() => { n++; if (n === 3) { clearInterval(id); console.log('three') } }, 10); setTimeout(() => console.log('once'), 5)", vec![]);
        wait_for(|| spy.logs.lock().unwrap().iter().any(|l| l == "info: three"));
        assert!(spy.logs.lock().unwrap().contains(&"info: once".to_string()));
    }

    #[test]
    fn endless_code_is_interrupted_and_stopped() {
        let (_r, spy) = start("while (true) {}", vec![]);
        wait_for(|| spy.stopped.lock().unwrap().is_some());
        let e = spy.stopped.lock().unwrap().clone().unwrap().unwrap();
        assert!(e.contains("interrupted"), "{e}");
        let (r, spy) = start("app.on('playing', () => { for (;;) {} })", vec![Permission::PlayerRead]);
        for _ in 0..MAX_OVERRUNS {
            r.event("playing", json!(true));
        }
        wait_for(|| spy.stopped.lock().unwrap().is_some());
        assert!(spy.stopped.lock().unwrap().clone().unwrap().unwrap().contains("too long"));
    }

    #[test]
    fn memory_is_capped_and_nothing_else_is_there() {
        let (_r, spy) = start("const a = []; try { for (;;) a.push(new Array(100000).fill(1)) } catch (e) { console.log('capped') }", vec![]);
        wait_for(|| spy.logs.lock().unwrap().iter().any(|l| l.contains("capped")) || spy.stopped.lock().unwrap().is_some());
        let (_r, spy) = start("console.log(typeof fetch, typeof require, typeof std, typeof os, typeof __host, typeof XMLHttpRequest, typeof document)", vec![]);
        wait_for(|| !spy.logs.lock().unwrap().is_empty());
        assert_eq!(spy.logs.lock().unwrap()[0], "info: undefined undefined undefined undefined undefined undefined undefined");
    }

    #[test]
    fn the_example_plugin_starts_and_draws_its_panel() {
        let m = Manifest::parse(include_str!("../../../examples/plugins/sleep-timer/plugin.json")).unwrap();
        let spy = Arc::new(Spy::default());
        let granted = m.permissions();
        let _r = Running::start(m, granted, include_str!("../../../examples/plugins/sleep-timer/main.js").into(), "1.0.0", spy.clone());
        let find = |method: &str| spy.calls.lock().unwrap().iter().find(|c| c.method == method).cloned();
        wait_for(|| find("ui.addCommand").is_some() && find("storage.get").is_some());
        _r.reply(find("storage.get").unwrap().id, Ok(json!(45)));
        wait_for(|| find("ui.setPanel").is_some());
        let tree = find("ui.setPanel").unwrap().args["tree"].clone();
        assert_eq!(tree[2]["value"], 45);
        assert!(spy.stopped.lock().unwrap().is_none(), "{:?}", spy.logs.lock().unwrap());
    }

    #[test]
    fn a_broken_plugin_reports_why() {
        let (_r, spy) = start("throw new Error('boom')", vec![]);
        wait_for(|| spy.stopped.lock().unwrap().is_some());
        assert!(spy.stopped.lock().unwrap().clone().unwrap().unwrap().contains("boom"));
    }
}
