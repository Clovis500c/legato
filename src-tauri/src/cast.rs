//! Cast a local song to a DLNA / UPnP speaker or TV (Settings › Playback › Cast to speakers, off by default). The renderers
//! on this network are found by SSDP (`music_connectors::dlna`); to play one, this PC serves that single file on a private
//! address and port, behind a random token in the path, and hands the renderer the address. Private peers only, GET and
//! HEAD with byte ranges, one file at a time (a new cast stops the one before), nothing is ever served that is not the file
//! asked for, and nothing leaves the local network.

use crate::{AppState, CmdResult, err};
use music_connectors::dlna::{self, Renderer};
use music_core::remote;
use serde::Serialize;
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::State;
use url::Url;

/// How long the search listens for answers.
const SEARCH: Duration = Duration::from_millis(2500);
const CHUNK: usize = 64 * 1024;
/// The file server closes when nothing has been connected to it for this long (a renderer holds its connection while it
/// plays; a paused one that buffered the whole song needs none), so no listener lingers after a song or a forgotten cast.
const IDLE: Duration = Duration::from_secs(300);
/// Descriptions opened at once during a search, and the whole search's limit.
const PARALLEL: usize = 8;
const SCAN_LIMIT: Duration = Duration::from_secs(8);

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CastDevice {
    /// Where its description is (the id the other commands take).
    pub id: String,
    pub name: String,
}

struct Serving {
    at: SocketAddr,
    stop: Arc<AtomicBool>,
}

static SERVING: Mutex<Option<Serving>> = Mutex::new(None);

/// The audio type a renderer is told for a file, by its extension; None for anything else (not served).
fn mime_of(path: &Path) -> Option<&'static str> {
    Some(match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "m4a" | "aac" | "mp4" => "audio/mp4",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "wav" => "audio/wav",
        _ => return None,
    })
}

/// A request head → (is HEAD, its Range header) when it asks for exactly `/<token>/file` by GET or HEAD.
fn asked(head: &str, token: &str) -> Option<(bool, Option<String>)> {
    let mut lines = head.lines();
    let mut first = lines.next()?.split_whitespace();
    let (method, path) = (first.next()?, first.next()?);
    if !matches!(method, "GET" | "HEAD") || path != format!("/{token}/file") {
        return None;
    }
    let range = lines.find_map(|l| l.split_once(':').filter(|(k, _)| k.trim().eq_ignore_ascii_case("range")).map(|(_, v)| v.trim().to_string()));
    Some((method == "HEAD", range))
}

fn answer(mut stream: TcpStream, path: &Path, mime: &str, token: &str) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    stream.set_write_timeout(Some(Duration::from_secs(30)))?;
    let mut head = Vec::new();
    let mut buf = [0u8; 1024];
    while !head.windows(4).any(|w| w == b"\r\n\r\n") && head.len() < 8192 {
        let n = stream.read(&mut buf)?;
        if n == 0 {
            break;
        }
        head.extend_from_slice(&buf[..n]);
    }
    let text = String::from_utf8_lossy(&head);
    let Some((is_head, range)) = asked(&text, token) else { return stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n") };
    let mut file = std::fs::File::open(path)?;
    let len = file.metadata()?.len();
    let Some((first, last)) = crate::art::byte_range(range.as_deref(), len) else {
        return stream.write_all(format!("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{len}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes());
    };
    let partial = range.is_some();
    let status = if partial { "206 Partial Content" } else { "200 OK" };
    let mut out = format!("HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\ntransferMode.dlna.org: Streaming\r\ncontentFeatures.dlna.org: DLNA.ORG_OP=01;DLNA.ORG_CI=0\r\nConnection: close\r\n", last - first + 1);
    if partial {
        out.push_str(&format!("Content-Range: bytes {first}-{last}/{len}\r\n"));
    }
    out.push_str("\r\n");
    stream.write_all(out.as_bytes())?;
    if is_head {
        return Ok(());
    }
    file.seek(SeekFrom::Start(first))?;
    let mut left = last - first + 1;
    let mut chunk = vec![0u8; CHUNK];
    while left > 0 {
        let n = file.read(&mut chunk[..CHUNK.min(left as usize)])?;
        if n == 0 {
            break;
        }
        stream.write_all(&chunk[..n])?;
        left -= n as u64;
    }
    Ok(())
}

/// Connections open now and when the last one closed: what the idle watch looks at.
struct Busy {
    open: AtomicUsize,
    last: Mutex<Instant>,
}

impl Busy {
    fn done(&self) {
        *self.last.lock().unwrap() = Instant::now();
        self.open.fetch_sub(1, Ordering::Relaxed);
    }

    fn idle_for(&self) -> Option<Duration> {
        (self.open.load(Ordering::Relaxed) == 0).then(|| self.last.lock().unwrap().elapsed())
    }
}

/// Serves `path` on `listener` until `stop`: private peers only, the token in the path.
fn serve(listener: TcpListener, path: PathBuf, mime: &'static str, token: String, stop: Arc<AtomicBool>, busy: Arc<Busy>) {
    for conn in listener.incoming() {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        let Ok(stream) = conn else { continue };
        if !stream.peer_addr().is_ok_and(|a| remote::private(a.ip())) {
            continue;
        }
        let (path, token, busy) = (path.clone(), token.clone(), busy.clone());
        busy.open.fetch_add(1, Ordering::Relaxed);
        let spawned = std::thread::Builder::new().name("cast-file".into()).spawn({
            let busy = busy.clone();
            move || {
                let _ = answer(stream, &path, mime, &token);
                busy.done();
            }
        });
        if spawned.is_err() {
            busy.done();
        }
    }
}

fn stop_serving() {
    let Some(s) = SERVING.lock().unwrap().take() else { return };
    s.stop.store(true, Ordering::Relaxed);
    // Wakes the waiting accept, which then sees the flag (on the address it is bound to: 127.0.0.1 is not it).
    let _ = TcpStream::connect_timeout(&s.at, Duration::from_millis(300));
}

/// Whether a renderer doing `state` may still come for the file: a pause can last, and a seek after it opens a new
/// connection. Stopped, empty or out of reach (None): it will not.
fn still_wanted(state: Option<&str>) -> bool {
    matches!(state, Some("PLAYING" | "PAUSED_PLAYBACK" | "TRANSITIONING"))
}

/// Starts serving `path` on `ip`; its address for the renderer. Once nothing has been connected for `idle`, the server
/// closes unless `renderer` (the one it was handed to) still plays or holds it paused.
fn serve_file(ip: Ipv4Addr, path: PathBuf, mime: &'static str, idle: Duration, renderer: Option<Renderer>) -> Result<Url, String> {
    stop_serving();
    let listener = TcpListener::bind((ip, 0)).map_err(err)?;
    let at = listener.local_addr().map_err(err)?;
    let port = at.port();
    let token = remote::new_token();
    let stop = Arc::new(AtomicBool::new(false));
    let (stop_in, token_in) = (stop.clone(), token.clone());
    let busy = Arc::new(Busy { open: AtomicUsize::new(0), last: Mutex::new(Instant::now()) });
    let busy_in = busy.clone();
    std::thread::Builder::new().name("cast".into()).spawn(move || serve(listener, path, mime, token_in, stop_in, busy_in)).map_err(err)?;
    *SERVING.lock().unwrap() = Some(Serving { at, stop: stop.clone() });
    // The idle watch: closes this server (and only this one) once nothing has been connected to it for `idle`.
    let tick = (idle / 4).clamp(Duration::from_millis(50), Duration::from_secs(15));
    std::thread::Builder::new()
        .name("cast-idle".into())
        .spawn(move || {
            loop {
                std::thread::sleep(tick);
                if stop.load(Ordering::Relaxed) {
                    break;
                }
                if busy.idle_for().is_some_and(|d| d >= idle) {
                    if let Some(r) = &renderer
                        && still_wanted(tauri::async_runtime::block_on(r.transport_state()).ok().as_deref())
                    {
                        continue;
                    }
                    let mut serving = SERVING.lock().unwrap();
                    if serving.as_ref().is_some_and(|s| Arc::ptr_eq(&s.stop, &stop))
                        && let Some(s) = serving.take()
                    {
                        s.stop.store(true, Ordering::Relaxed);
                        let _ = TcpStream::connect_timeout(&s.at, Duration::from_millis(300));
                    }
                    break;
                }
            }
        })
        .map_err(err)?;
    Url::parse(&format!("http://{ip}:{port}/{token}/file")).map_err(err)
}

/// Speakers and TVs on this network that can play from an address.
#[tauri::command]
pub async fn cast_scan() -> CmdResult<Vec<CastDevice>> {
    let found = dlna::discover(dlna::SSDP, SEARCH).await.map_err(err)?;
    // Their descriptions are opened together (a few at a time) under one limit, not one after the other.
    let gate = Arc::new(tokio::sync::Semaphore::new(PARALLEL));
    let mut set = tokio::task::JoinSet::new();
    for f in found {
        let gate = gate.clone();
        set.spawn(async move {
            let _slot = gate.acquire().await.ok()?;
            let r = Renderer::open(&f.location).await.ok()?;
            Some(CastDevice { id: f.location.to_string(), name: r.name })
        });
    }
    let mut out = Vec::new();
    let _ = tokio::time::timeout(SCAN_LIMIT, async {
        while let Some(done) = set.join_next().await {
            if let Ok(Some(d)) = done {
                out.push(d);
            }
        }
    })
    .await;
    // Past the limit the ones still waiting are dropped with the set.
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

async fn device(id: &str) -> Result<Renderer, String> {
    let url = Url::parse(id).map_err(err)?;
    Renderer::open(&url).await.map_err(err)
}

/// Plays a song of this PC's library on a device found by `cast_scan`, from `position_ms`.
#[tauri::command]
pub async fn cast_play(state: State<'_, AppState>, device_id: String, track_id: i64, title: String, position_ms: u64) -> CmdResult<()> {
    let path = state.lib().local_path(track_id).map_err(err)?.map(PathBuf::from).ok_or("Only your own music files can be cast")?;
    let mime = mime_of(&path).ok_or("This kind of file cannot be cast")?;
    let ip = match crate::remote::lan_ip() {
        Some(std::net::IpAddr::V4(ip)) => ip,
        _ => return Err("This PC has no address on a local network".into()),
    };
    let renderer = device(&device_id).await?;
    let url = serve_file(ip, path, mime, IDLE, Some(renderer.clone()))?;
    renderer.play_uri(url.as_str(), &title.chars().take(200).collect::<String>(), mime).await.map_err(err)?;
    if position_ms > 0 {
        // Some devices need a moment before they take a seek.
        tokio::time::sleep(Duration::from_millis(800)).await;
        let _ = renderer.seek(position_ms).await;
    }
    Ok(())
}

/// `pause`, `play`, `stop` or `seek` (with `ms`) on a device.
#[tauri::command]
pub async fn cast_control(device_id: String, action: String, ms: u64) -> CmdResult<()> {
    let renderer = device(&device_id).await?;
    match action.as_str() {
        "pause" => renderer.pause().await,
        "play" => renderer.play().await,
        "seek" => renderer.seek(ms).await,
        "stop" => {
            let r = renderer.stop().await;
            stop_serving();
            r
        }
        _ => return Err("Not an action".into()),
    }
    .map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_file_under_the_token_is_asked_for() {
        assert_eq!(asked("GET /tok/file HTTP/1.1\r\nHost: x\r\nRange: bytes=5-\r\n\r\n", "tok"), Some((false, Some("bytes=5-".into()))));
        assert_eq!(asked("HEAD /tok/file HTTP/1.1\r\n\r\n", "tok"), Some((true, None)));
        for bad in ["GET /other/file HTTP/1.1\r\n\r\n", "GET /tok/file/../x HTTP/1.1\r\n\r\n", "POST /tok/file HTTP/1.1\r\n\r\n", "GET / HTTP/1.1\r\n\r\n", ""] {
            assert!(asked(bad, "tok").is_none(), "{bad}");
        }
        assert_eq!(mime_of(Path::new("a/b.FLAC")), Some("audio/flac"));
        assert_eq!(mime_of(Path::new("a/b.exe")), None);
    }

    // Not 127.0.0.1: the server is bound to one address (the LAN's in the app), and its stop must reach that one.
    const AT: Ipv4Addr = Ipv4Addr::new(127, 0, 0, 2);
    /// One server at a time exists (a new one stops the other): the tests that start one take turns.
    static TURN: Mutex<()> = Mutex::new(());

    fn get(port: u16, request: &str) -> Vec<u8> {
        let mut s = TcpStream::connect((AT, port)).unwrap();
        s.write_all(request.as_bytes()).unwrap();
        let mut out = Vec::new();
        s.read_to_end(&mut out).unwrap();
        out
    }

    #[test]
    fn a_file_is_served_whole_or_by_range_and_nothing_else() {
        let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.mp3");
        std::fs::write(&path, b"0123456789").unwrap();
        let url = serve_file(AT, path, "audio/mpeg", Duration::from_secs(300), None).unwrap();
        let (port, token) = (url.port().unwrap(), url.path().split('/').nth(1).unwrap().to_string());
        let whole = String::from_utf8(get(port, &format!("GET /{token}/file HTTP/1.1\r\n\r\n"))).unwrap();
        assert!(whole.starts_with("HTTP/1.1 200 OK") && whole.contains("Content-Length: 10") && whole.ends_with("0123456789"), "{whole}");
        let part = String::from_utf8(get(port, &format!("GET /{token}/file HTTP/1.1\r\nRange: bytes=2-4\r\n\r\n"))).unwrap();
        assert!(part.starts_with("HTTP/1.1 206") && part.contains("Content-Range: bytes 2-4/10") && part.ends_with("234"), "{part}");
        let head = String::from_utf8(get(port, &format!("HEAD /{token}/file HTTP/1.1\r\n\r\n"))).unwrap();
        assert!(head.contains("Content-Length: 10") && !head.contains("0123"), "{head}");
        let beyond = String::from_utf8(get(port, &format!("GET /{token}/file HTTP/1.1\r\nRange: bytes=50-60\r\n\r\n"))).unwrap();
        assert!(beyond.starts_with("HTTP/1.1 416"), "{beyond}");
        assert!(String::from_utf8(get(port, "GET /wrong/file HTTP/1.1\r\n\r\n")).unwrap().starts_with("HTTP/1.1 404"));
        stop_serving();
        std::thread::sleep(Duration::from_millis(200));
        assert!(TcpStream::connect_timeout(&SocketAddr::from((AT, port)), Duration::from_millis(500)).is_err(), "stopped");
    }

    #[test]
    fn a_server_nobody_uses_closes_itself_and_a_used_one_stays() {
        let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.mp3");
        std::fs::write(&path, b"0123456789").unwrap();
        let url = serve_file(AT, path, "audio/mpeg", Duration::from_millis(400), None).unwrap();
        let (port, token) = (url.port().unwrap(), url.path().split('/').nth(1).unwrap().to_string());
        std::thread::sleep(Duration::from_millis(250));
        assert!(get(port, &format!("GET /{token}/file HTTP/1.1\r\n\r\n")).starts_with(b"HTTP/1.1 200"), "a request keeps it open");
        std::thread::sleep(Duration::from_millis(250));
        assert!(get(port, &format!("GET /{token}/file HTTP/1.1\r\n\r\n")).starts_with(b"HTTP/1.1 200"), "its idle time counts from the last request");
        std::thread::sleep(Duration::from_millis(1200));
        assert!(TcpStream::connect_timeout(&SocketAddr::from((AT, port)), Duration::from_millis(500)).is_err(), "closed when idle");
        assert!(SERVING.lock().unwrap().is_none());
    }

    #[test]
    fn a_paused_renderer_keeps_its_server_and_a_stopped_one_lets_it_close() {
        let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
        let mut s = mockito::Server::new();
        let answer = |state: &str| format!("<s:Envelope><s:Body><CurrentTransportState>{state}</CurrentTransportState></s:Body></s:Envelope>");
        let paused = s.mock("POST", "/ctl").with_body(answer("PAUSED_PLAYBACK")).create();
        let renderer = Renderer { name: "TV".into(), control: Url::parse(&format!("{}/ctl", s.url())).unwrap() };
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.mp3");
        std::fs::write(&path, b"0123456789").unwrap();
        let url = serve_file(AT, path, "audio/mpeg", Duration::from_millis(200), Some(renderer)).unwrap();
        let port = url.port().unwrap();
        std::thread::sleep(Duration::from_millis(900));
        assert!(TcpStream::connect_timeout(&SocketAddr::from((AT, port)), Duration::from_millis(500)).is_ok(), "a long pause keeps it open");
        paused.remove();
        s.mock("POST", "/ctl").with_body(answer("STOPPED")).create();
        std::thread::sleep(Duration::from_millis(900));
        assert!(TcpStream::connect_timeout(&SocketAddr::from((AT, port)), Duration::from_millis(500)).is_err(), "closed once it stopped");
    }

    #[test]
    fn only_playing_or_paused_wants_the_file() {
        for s in ["PLAYING", "PAUSED_PLAYBACK", "TRANSITIONING"] {
            assert!(still_wanted(Some(s)), "{s}");
        }
        for s in [Some("STOPPED"), Some("NO_MEDIA_PRESENT"), None] {
            assert!(!still_wanted(s), "{s:?}");
        }
    }
}
