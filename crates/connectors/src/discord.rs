//! Discord Rich Presence through the Discord app's local IPC (named pipe on Windows, socket elsewhere). No network, no
//! token: the Discord app shows what we send under the user's own Discord application (its name = "Listening to …").
use anyhow::{Context, Result, bail};
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{Read, Write};

const HANDSHAKE: u32 = 0;
const FRAME: u32 = 1;
const CLOSE: u32 = 2;
const PING: u32 = 3;
const PONG: u32 = 4;

/// What the member list shows after "Listening to": the Discord app's name, the artist or the song.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StatusShows {
    Name,
    Artist,
    Song,
}

/// Current track, from the player.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Presence {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    /// https cover (Discord fetches it itself).
    pub art: Option<String>,
    /// Buttons (label, https url): the song's page, the app's. Discord takes 2.
    #[serde(default)]
    pub buttons: Vec<(String, String)>,
    pub playing: bool,
    pub position_ms: u64,
    pub duration_ms: Option<u64>,
    pub status: StatusShows,
}

/// Discord field: 2 to 128 characters.
fn field(s: &str) -> String {
    let s = s.trim();
    let mut out: String = if s.chars().count() > 128 { s.chars().take(127).chain(['…']).collect() } else { s.to_string() };
    while out.chars().count() < 2 {
        out.push('\u{2800}');
    }
    out
}

/// Activity JSON (type Listening). Playing: start/end times, Discord draws the progress bar. now_ms = Unix time.
pub fn activity(p: &Presence, now_ms: u64) -> Value {
    let mut a = json!({
        "type": 2,
        "details": field(&p.title),
        "state": field(&p.artist),
        "status_display_type": match p.status { StatusShows::Name => 0, StatusShows::Artist => 1, StatusShows::Song => 2 },
    });
    if p.playing {
        let start = now_ms.saturating_sub(p.position_ms) / 1000;
        a["timestamps"] = match p.duration_ms {
            Some(d) if d > 0 => json!({ "start": start, "end": start + d / 1000 }),
            _ => json!({ "start": start }),
        };
    }
    if let Some(art) = p.art.as_deref().filter(|u| u.starts_with("https://") && u.len() <= 256) {
        a["assets"] = json!({ "large_image": art, "large_text": field(p.album.as_deref().unwrap_or(&p.title)) });
    }
    let buttons: Vec<Value> = p
        .buttons
        .iter()
        .filter(|(l, u)| !l.trim().is_empty() && u.starts_with("https://") && u.len() <= 512)
        .take(2)
        .map(|(l, u)| json!({ "label": l.trim().chars().take(32).collect::<String>(), "url": u }))
        .collect();
    if !buttons.is_empty() {
        a["buttons"] = Value::Array(buttons);
    }
    a
}

fn write_frame(s: &mut impl Write, op: u32, body: &Value) -> Result<()> {
    let body = serde_json::to_vec(body)?;
    let mut buf = Vec::with_capacity(8 + body.len());
    buf.extend(op.to_le_bytes());
    buf.extend(u32::try_from(body.len())?.to_le_bytes());
    buf.extend(body);
    s.write_all(&buf)?;
    s.flush()?;
    Ok(())
}

fn read_frame(s: &mut impl Read) -> Result<(u32, Value)> {
    let mut head = [0u8; 8];
    s.read_exact(&mut head).context("Discord closed the connection")?;
    let op = u32::from_le_bytes(head[..4].try_into()?);
    let len = u32::from_le_bytes(head[4..].try_into()?) as usize;
    anyhow::ensure!(len <= 1 << 20, "Discord sent too much");
    let mut body = vec![0u8; len];
    s.read_exact(&mut body)?;
    Ok((op, serde_json::from_slice(&body)?))
}

fn closed(body: &Value) -> anyhow::Error {
    anyhow::anyhow!("Discord refused: {}", body["message"].as_str().unwrap_or("connection closed"))
}

/// One connection to the Discord app, for one Discord application.
pub struct Ipc<S: Read + Write> {
    s: S,
    nonce: u64,
}

impl<S: Read + Write> Ipc<S> {
    pub fn handshake(mut s: S, client_id: &str) -> Result<Self> {
        write_frame(&mut s, HANDSHAKE, &json!({ "v": 1, "client_id": client_id }))?;
        loop {
            match read_frame(&mut s)? {
                (FRAME, b) if b["evt"] == "READY" => return Ok(Self { s, nonce: 0 }),
                (CLOSE, b) => return Err(closed(&b)),
                (PING, b) => write_frame(&mut s, PONG, &b)?,
                _ => {}
            }
        }
    }

    /// None = clear (nothing shown).
    pub fn set_activity(&mut self, pid: u32, activity: Option<Value>) -> Result<()> {
        self.nonce += 1;
        let nonce = self.nonce.to_string();
        write_frame(&mut self.s, FRAME, &json!({ "cmd": "SET_ACTIVITY", "args": { "pid": pid, "activity": activity }, "nonce": nonce }))?;
        loop {
            match read_frame(&mut self.s)? {
                (FRAME, b) if b["nonce"] == nonce.as_str() => {
                    if b["evt"] == "ERROR" {
                        bail!("Discord refused: {}", b["data"]["message"].as_str().unwrap_or("unknown error"));
                    }
                    return Ok(());
                }
                (CLOSE, b) => return Err(closed(&b)),
                (PING, b) => write_frame(&mut self.s, PONG, &b)?,
                _ => {}
            }
        }
    }
}

#[cfg(windows)]
pub type Pipe = std::fs::File;
#[cfg(unix)]
pub type Pipe = std::os::unix::net::UnixStream;

#[cfg(windows)]
fn open(i: u8) -> std::io::Result<Pipe> {
    std::fs::OpenOptions::new().read(true).write(true).open(format!(r"\\.\pipe\discord-ipc-{i}"))
}

#[cfg(unix)]
fn open(i: u8) -> std::io::Result<Pipe> {
    let dir = ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"].iter().find_map(|k| std::env::var(k).ok()).unwrap_or_else(|| "/tmp".into());
    Pipe::connect(format!("{dir}/discord-ipc-{i}"))
}

/// First Discord app found (stable, PTB and Canary each take a slot).
pub fn connect(client_id: &str) -> Result<Ipc<Pipe>> {
    anyhow::ensure!(!client_id.is_empty() && client_id.len() <= 32 && client_id.bytes().all(|b| b.is_ascii_digit()), "Add your Discord application ID");
    for i in 0..10 {
        if let Ok(pipe) = open(i) {
            return Ipc::handshake(pipe, client_id);
        }
    }
    bail!("Discord isn't open")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// Discord's side: frames it will send, what we wrote.
    struct Fake {
        input: Cursor<Vec<u8>>,
        out: Vec<u8>,
    }

    impl Read for Fake {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            self.input.read(buf)
        }
    }

    impl Write for Fake {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.out.write(buf)
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn fake(frames: &[(u32, Value)]) -> Fake {
        let mut input = Vec::new();
        for (op, b) in frames {
            write_frame(&mut input, *op, b).unwrap();
        }
        Fake { input: Cursor::new(input), out: Vec::new() }
    }

    fn sent(out: &[u8]) -> Vec<(u32, Value)> {
        let mut c = Cursor::new(out.to_vec());
        std::iter::from_fn(|| read_frame(&mut c).ok()).collect()
    }

    fn song() -> Presence {
        Presence {
            title: "jinx".into(),
            artist: "lexycat".into(),
            album: None,
            art: Some("https://i.ytimg.com/vi/abc/hqdefault.jpg".into()),
            buttons: vec![
                ("Listen on YouTube".into(), "https://www.youtube.com/watch?v=abc".into()),
                ("Get App On GitHub".into(), "https://github.com/Clovis500c/music-app".into()),
                ("Third one".into(), "https://example.com".into()),
            ],
            playing: true,
            position_ms: 30_000,
            duration_ms: Some(197_000),
            status: StatusShows::Song,
        }
    }

    #[test]
    fn handshake_then_activity_answers_pings() -> Result<()> {
        let s = fake(&[(PING, json!({ "x": 1 })), (FRAME, json!({ "cmd": "DISPATCH", "evt": "READY" })), (FRAME, json!({ "cmd": "SET_ACTIVITY", "nonce": "1", "evt": null }))]);
        let mut ipc = Ipc::handshake(s, "123")?;
        ipc.set_activity(42, Some(activity(&song(), 1_000_000)))?;
        let out = sent(&ipc.s.out);
        assert_eq!(out[0], (HANDSHAKE, json!({ "v": 1, "client_id": "123" })));
        assert_eq!(out[1], (PONG, json!({ "x": 1 })));
        assert_eq!(out[2].1["cmd"], "SET_ACTIVITY");
        assert_eq!(out[2].1["args"]["pid"], 42);
        assert_eq!(out[2].1["args"]["activity"]["details"], "jinx");
        Ok(())
    }

    #[test]
    fn bad_client_id_and_errors_surface() {
        let e = Ipc::handshake(fake(&[(CLOSE, json!({ "code": 4000, "message": "Invalid Client ID" }))]), "1").err().unwrap();
        assert!(e.to_string().contains("Invalid Client ID"));
        let s = fake(&[(FRAME, json!({ "evt": "READY" })), (FRAME, json!({ "nonce": "1", "evt": "ERROR", "data": { "message": "child \"activity\" fails" } }))]);
        let e = Ipc::handshake(s, "1").unwrap().set_activity(1, None).err().unwrap();
        assert!(e.to_string().contains("activity"));
        assert!(connect("not-an-id").is_err());
    }

    #[test]
    fn activity_listening_with_progress_cover_and_button() {
        let a = activity(&song(), 1_000_000);
        assert_eq!(a["type"], 2);
        assert_eq!(a["status_display_type"], 2);
        assert_eq!(a["timestamps"], json!({ "start": 970, "end": 1167 }));
        assert_eq!(a["assets"]["large_image"], "https://i.ytimg.com/vi/abc/hqdefault.jpg");
        assert_eq!(a["assets"]["large_text"], "jinx");
        assert_eq!(a["buttons"][0]["url"], "https://www.youtube.com/watch?v=abc");
        assert_eq!(a["buttons"][1]["label"], "Get App On GitHub");
        assert_eq!(a["buttons"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn paused_short_long_and_unsafe_fields() {
        let p = Presence { title: "x".into(), artist: "a".repeat(300), art: Some("http://x/y.jpg".into()), buttons: vec![("Bad".into(), "http://x".into()), (" ".into(), "https://x".into())], playing: false, status: StatusShows::Artist, ..song() };
        let a = activity(&p, 1_000_000);
        assert!(a.get("timestamps").is_none());
        assert!(a.get("assets").is_none());
        assert!(a.get("buttons").is_none());
        assert_eq!(a["details"].as_str().unwrap().chars().count(), 2);
        assert_eq!(a["state"].as_str().unwrap().chars().count(), 128);
        assert_eq!(a["status_display_type"], 1);
    }
}
