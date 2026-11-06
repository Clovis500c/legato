//! Songs over HTTP (personal servers): a seekable reader for symphonia over range requests, so the native chain
//! (Live Editor, fades, gapless, levelling, visualizer) applies as for local files.
//!
//! A worker thread reads ahead into a bounded buffer; the decoder reads from it (in the audio thread: never a
//! network wait there unless the buffer ran dry). Seek inside the buffer = free, elsewhere = a new range request.
//! Dropped connection = a new request from where it stopped, short backoff. Server without ranges (200 to a
//! `Range`): plays from the start, a seek reads again from 0 and skips. Memory: `AHEAD` + `BEHIND` per stream.

use std::collections::VecDeque;
use std::io::{self, Read, Seek, SeekFrom};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

/// Engine paths of server songs start so (`server:<server>:<item>`); the rest is the fetcher's key.
pub const PREFIX: &str = "server:";

/// Read ahead of the decoder, at most.
const AHEAD: usize = 4 << 20;
/// Kept behind the decoder: a probe's or a small seek's step back needs no request.
const BEHIND: usize = 1 << 20;
/// A forward seek this close to what's buffered waits for the worker instead of a new request.
const NEAR: u64 = 256 << 10;
/// Worker's read size.
const CHUNK: usize = 64 << 10;
/// Decoder waits this long for bytes before the song fails (a stalled server).
const STALL: Duration = Duration::from_secs(20);
/// Requests in a row without a byte before giving up (backoff 250 ms, doubling).
const TRIES: u32 = 4;

/// Is this engine path a server song's?
pub fn is_remote(path: &std::path::Path) -> bool {
    path.to_str().is_some_and(|p| p.starts_with(PREFIX))
}

/// One HTTP answer, as the fetcher got it. Status and headers are judged here (one place, tested).
pub struct Reply {
    pub status: u16,
    pub content_length: Option<u64>,
    /// `Content-Range` as sent ("bytes 100-999/1000").
    pub content_range: Option<String>,
    pub content_type: Option<String>,
    pub body: Box<dyn Read + Send>,
}

/// Opens a song's bytes. The shell's fetcher builds each request (fresh auth per request: tokens never leave Rust)
/// with the app's client (`music_connectors::Noted`); tests use a local server. Always sends `Range: bytes=<from>-`.
/// `transcode`: the server's own conversion to a format the engine reads (MP3), when its file isn't one.
pub trait Fetch: Send + Sync {
    fn get(&self, key: &str, from: u64, transcode: bool) -> io::Result<Reply>;
}

/// The fetcher, for `Command::Remote`.
#[derive(Clone)]
pub struct Remote(pub Arc<dyn Fetch>);

impl std::fmt::Debug for Remote {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Remote")
    }
}

/// What the first answer said: length and type for the decoder.
#[derive(Debug, Clone, Default)]
pub struct Info {
    pub len: Option<u64>,
    pub mime: Option<String>,
    /// Server honours ranges (206).
    pub ranged: bool,
}

/// Server answer in words (English, mapped in `shared/errors.ts`).
fn refused(status: u16) -> io::Error {
    match status {
        401 | 403 => io::Error::new(io::ErrorKind::PermissionDenied, format!("Your music server refused the sign-in (HTTP {status})")),
        404 | 410 => io::Error::new(io::ErrorKind::NotFound, format!("Your music server no longer has this song (HTTP {status})")),
        500..=599 => io::Error::other(format!("Your music server failed (HTTP {status})")),
        _ => io::Error::other(format!("Your music server answered HTTP {status}")),
    }
}

/// "bytes 100-999/1000" → (100, Some(1000)); "*" total = unknown.
fn parse_range(v: &str) -> Option<(u64, Option<u64>)> {
    let rest = v.trim().strip_prefix("bytes")?.trim();
    let (span, total) = rest.split_once('/')?;
    let start = span.split_once('-')?.0.trim().parse().ok()?;
    Some((start, total.trim().parse().ok()))
}

/// The server itself can't be reached or refuses (off, address wrong, sign-in refused, signed out): every song of it
/// would fail the same way, so the engine stops the run there instead of trying the next ones one by one.
pub fn unreachable(e: &io::Error) -> bool {
    use io::ErrorKind::*;
    matches!(e.kind(), PermissionDenied | NotConnected | TimedOut | ConnectionRefused | ConnectionReset | ConnectionAborted | HostUnreachable | NetworkUnreachable)
}

/// An answer judged: where its body starts, the total length, ranged or not.
fn judge(r: &Reply, from: u64) -> io::Result<(u64, Option<u64>, bool)> {
    match r.status {
        206 => {
            let (start, total) = r.content_range.as_deref().and_then(parse_range).ok_or_else(|| io::Error::other("Your music server sent a range without Content-Range"))?;
            // Earlier than asked (a server rounding to a block): the worker skips up to `from`. Later: bytes missing.
            if start > from {
                return Err(io::Error::other("Your music server sent the wrong range"));
            }
            Ok((start, total.or(r.content_length.map(|l| l + start)), true))
        }
        // Range ignored: the whole file from byte 0.
        200 => Ok((0, r.content_length, false)),
        s => Err(refused(s)),
    }
}

#[derive(Default)]
struct State {
    /// Offset of `buf[0]`.
    start: u64,
    buf: VecDeque<u8>,
    /// Decoder's position (the worker trims behind it, waits when far enough ahead).
    pos: u64,
    /// Bumped by a seek outside the buffer: the worker drops its request and starts at `start`.
    generation: u64,
    eof: bool,
    error: Option<(io::ErrorKind, String)>,
    closed: bool,
}

struct Shared {
    state: Mutex<State>,
    moved: Condvar,
    fetch: Arc<dyn Fetch>,
    key: String,
    transcode: bool,
    len: Option<u64>,
    /// Last failure for the engine's status (the decoder only sees a short read).
    failed: Arc<Mutex<Option<String>>>,
}

/// A song's bytes over HTTP, `Read + Seek` for the decoder. The worker ends when it's dropped.
pub struct Stream {
    shared: Arc<Shared>,
    pos: u64,
}

impl Stream {
    /// First request now (length, type), then the worker reads on. `failed` gets a later failure, in words.
    pub fn open(fetch: Arc<dyn Fetch>, key: &str, transcode: bool, failed: Arc<Mutex<Option<String>>>) -> io::Result<(Self, Info)> {
        let first = fetch.get(key, 0, transcode)?;
        let (_, len, ranged) = judge(&first, 0)?;
        let mime = first.content_type.as_deref().map(|m| m.split(';').next().unwrap_or(m).trim().to_string()).filter(|m| !m.is_empty());
        let shared = Arc::new(Shared { state: Mutex::new(State::default()), moved: Condvar::new(), fetch, key: key.to_string(), transcode, len, failed });
        let worker = shared.clone();
        std::thread::Builder::new().name("http-stream".into()).spawn(move || work(&worker, Some(first)))?;
        Ok((Self { shared, pos: 0 }, Info { len, mime, ranged }))
    }
}

impl Drop for Stream {
    fn drop(&mut self) {
        self.shared.state.lock().unwrap().closed = true;
        self.shared.moved.notify_all();
    }
}

impl Read for Stream {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        if out.is_empty() {
            return Ok(0);
        }
        let deadline = Instant::now() + STALL;
        if self.shared.len.is_some_and(|l| self.pos >= l) {
            return Ok(0);
        }
        let mut st = self.shared.state.lock().unwrap();
        loop {
            let end = st.start + st.buf.len() as u64;
            if self.pos >= st.start && self.pos < end {
                let at = (self.pos - st.start) as usize;
                let n = out.len().min(st.buf.len() - at);
                let (a, b) = st.buf.as_slices();
                for (i, byte) in out[..n].iter_mut().enumerate() {
                    let j = at + i;
                    *byte = if j < a.len() { a[j] } else { b[j - a.len()] };
                }
                self.pos += n as u64;
                st.pos = self.pos;
                self.shared.moved.notify_all();
                return Ok(n);
            }
            if st.eof && self.pos >= end {
                return Ok(0);
            }
            if let Some((kind, said)) = &st.error {
                return Err(io::Error::new(*kind, said.clone()));
            }
            let now = Instant::now();
            if now >= deadline {
                let e = "Your music server stopped sending this song (timed out)";
                *self.shared.failed.lock().unwrap() = Some(e.into());
                return Err(io::Error::new(io::ErrorKind::TimedOut, e));
            }
            st = self.shared.moved.wait_timeout(st, deadline - now).unwrap().0;
        }
    }
}

impl Seek for Stream {
    fn seek(&mut self, to: SeekFrom) -> io::Result<u64> {
        let target = match to {
            SeekFrom::Start(n) => n as i128,
            SeekFrom::Current(d) => self.pos as i128 + d as i128,
            SeekFrom::End(d) => match self.shared.len {
                Some(len) => len as i128 + d as i128,
                None => return Err(io::Error::new(io::ErrorKind::Unsupported, "length unknown")),
            },
        };
        let target = u64::try_from(target).map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "seek before start"))?;
        let mut st = self.shared.state.lock().unwrap();
        let end = st.start + st.buf.len() as u64;
        // Inside what's kept, or just ahead of it (the worker gets there): no new request.
        let near = target >= st.start && (target <= end || (target - end <= NEAR && !st.eof && st.error.is_none()));
        let past_end = self.shared.len.is_some_and(|l| target >= l);
        if !near && !past_end {
            st.start = target;
            st.buf.clear();
            st.eof = false;
            st.error = None;
            st.generation += 1;
        }
        self.pos = target;
        st.pos = target;
        self.shared.moved.notify_all();
        Ok(target)
    }
}

/// Worker: fetch from where the buffer ends, keep `AHEAD` in front of the decoder, start over on a seek.
fn work(sh: &Shared, mut first: Option<Reply>) {
    let mut fails = 0u32;
    loop {
        let (generation, from) = {
            let st = sh.state.lock().unwrap();
            if st.closed {
                return;
            }
            (st.generation, st.start + st.buf.len() as u64)
        };
        let opened = match first.take() {
            Some(r) => Ok(r),
            None => sh.fetch.get(&sh.key, from, sh.transcode),
        };
        let got = opened.and_then(|r| {
            let (at, _, _) = judge(&r, from)?;
            Ok((r.body, at))
        });
        // Range ignored (200) or started early (206): `at` < `from`, the bytes before are skipped below.
        let (mut body, mut at) = match got {
            Ok(b) => b,
            Err(e) => {
                // Refused (sign-in, gone): no retry helps. Else a few tries, then fail.
                fails = if matches!(e.kind(), io::ErrorKind::PermissionDenied | io::ErrorKind::NotFound) { TRIES } else { fails + 1 };
                if !retry(sh, generation, &mut fails, e) {
                    return;
                }
                continue;
            }
        };
        // Range ignored: read and drop up to where the buffer ends.
        let mut skip = vec![0u8; CHUNK];
        while at < from {
            if sh.state.lock().unwrap().generation != generation {
                break;
            }
            match body.read(&mut skip[..CHUNK.min((from - at) as usize)]) {
                Ok(0) | Err(_) => break,
                Ok(n) => at += n as u64,
            }
        }
        if at < from {
            // Cut while skipping (a seek moved on: no harm, a new start at once).
            if sh.state.lock().unwrap().generation == generation {
                fails += 1;
                if !retry(sh, generation, &mut fails, io::Error::new(io::ErrorKind::UnexpectedEof, "Your music server cut the connection")) {
                    return;
                }
            }
            continue;
        }
        let mut chunk = vec![0u8; CHUNK];
        loop {
            // Room ahead, or a seek / close.
            {
                let mut st = sh.state.lock().unwrap();
                while !st.closed && st.generation == generation && (st.start + st.buf.len() as u64).saturating_sub(st.pos) >= AHEAD as u64 {
                    st = sh.moved.wait(st).unwrap();
                }
                if st.closed {
                    return;
                }
                if st.generation != generation {
                    break;
                }
            }
            match body.read(&mut chunk) {
                Ok(0) => {
                    let mut st = sh.state.lock().unwrap();
                    if st.generation != generation {
                        break;
                    }
                    let end = st.start + st.buf.len() as u64;
                    // Short of the length the server gave: the connection dropped.
                    if sh.len.is_some_and(|l| end < l) {
                        drop(st);
                        fails += 1;
                        if !retry(sh, generation, &mut fails, io::Error::new(io::ErrorKind::UnexpectedEof, "Your music server cut the connection")) {
                            return;
                        }
                        break;
                    }
                    st.eof = true;
                    sh.moved.notify_all();
                    drop(st);
                    if !wait_for_seek(sh, generation) {
                        return;
                    }
                    break;
                }
                Ok(n) => {
                    fails = 0;
                    let mut st = sh.state.lock().unwrap();
                    if st.generation != generation {
                        break;
                    }
                    st.buf.extend(&chunk[..n]);
                    // Trim behind the decoder.
                    let behind = st.pos.saturating_sub(st.start) as usize;
                    if behind > BEHIND {
                        let drop_n = (behind - BEHIND).min(st.buf.len());
                        st.buf.drain(..drop_n);
                        st.start += drop_n as u64;
                    }
                    sh.moved.notify_all();
                }
                Err(_) => {
                    // Dropped mid-body: a new request from here, after a short wait.
                    fails += 1;
                    if !retry(sh, generation, &mut fails, io::Error::new(io::ErrorKind::UnexpectedEof, "Your music server cut the connection")) {
                        return;
                    }
                    break;
                }
            }
        }
    }
}

/// After `fails` failures in a row: a short wait, or from `TRIES` on the failure told and a wait for a seek. False = closed.
fn retry(sh: &Shared, generation: u64, fails: &mut u32, e: io::Error) -> bool {
    if *fails < TRIES {
        return backoff(sh, generation, *fails);
    }
    fail(sh, generation, e);
    *fails = 0;
    wait_for_seek(sh, generation)
}

/// The decoder learns the failure (its next read), the engine too.
fn fail(sh: &Shared, generation: u64, e: io::Error) {
    let mut st = sh.state.lock().unwrap();
    if st.generation == generation {
        *sh.failed.lock().unwrap() = Some(e.to_string());
        st.error = Some((e.kind(), e.to_string()));
        sh.moved.notify_all();
    }
}

/// Sleeps 250 ms × 2^(n-1), woken early by a seek or close. False = closed.
fn backoff(sh: &Shared, generation: u64, n: u32) -> bool {
    let until = Instant::now() + Duration::from_millis(250 << (n - 1).min(4));
    let mut st = sh.state.lock().unwrap();
    while !st.closed && st.generation == generation {
        let now = Instant::now();
        if now >= until {
            break;
        }
        st = sh.moved.wait_timeout(st, until - now).unwrap().0;
    }
    !st.closed
}

/// Done or failed: idle until a seek asks for other bytes. False = closed.
fn wait_for_seek(sh: &Shared, generation: u64) -> bool {
    let mut st = sh.state.lock().unwrap();
    while !st.closed && st.generation == generation {
        st = sh.moved.wait(st).unwrap();
    }
    !st.closed
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    /// A local server for one file: ranges or not, and the first answer cut after `cut` bytes.
    pub(crate) struct Server {
        pub port: u16,
        pub requests: Arc<AtomicUsize>,
        pub ranges: Arc<Mutex<Vec<u64>>>,
    }

    pub(crate) fn serve(data: Vec<u8>, ranges: bool, cut: Option<usize>) -> Server {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let requests = Arc::new(AtomicUsize::new(0));
        let seen = Arc::new(Mutex::new(Vec::new()));
        let (count, log) = (requests.clone(), seen.clone());
        let data = Arc::new(data);
        let cut_once = Arc::new(AtomicBool::new(cut.is_some()));
        std::thread::spawn(move || {
            for conn in listener.incoming() {
                let Ok(mut conn) = conn else { return };
                let (data, count, log, cut_once) = (data.clone(), count.clone(), log.clone(), cut_once.clone());
                std::thread::spawn(move || {
                    let mut reader = BufReader::new(conn.try_clone().unwrap());
                    let mut from = 0u64;
                    loop {
                        let mut line = String::new();
                        if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                            break;
                        }
                        if let Some(v) = line.to_ascii_lowercase().strip_prefix("range: bytes=") {
                            from = v.trim().trim_end_matches('-').parse().unwrap_or(0);
                        }
                    }
                    count.fetch_add(1, Ordering::SeqCst);
                    log.lock().unwrap().push(from);
                    let total = data.len() as u64;
                    let (head, body) = if ranges {
                        let from = from.min(total);
                        (format!("HTTP/1.1 206 Partial Content\r\nContent-Type: audio/wav\r\nContent-Length: {}\r\nContent-Range: bytes {from}-{}/{total}\r\nConnection: close\r\n\r\n", total - from, total.saturating_sub(1)), &data[from as usize..])
                    } else {
                        (format!("HTTP/1.1 200 OK\r\nContent-Type: audio/wav\r\nContent-Length: {total}\r\nConnection: close\r\n\r\n"), &data[..])
                    };
                    let _ = conn.write_all(head.as_bytes());
                    let body = match cut {
                        Some(n) if cut_once.swap(false, Ordering::SeqCst) => &body[..n.min(body.len())],
                        _ => body,
                    };
                    let _ = conn.write_all(body);
                    let _ = conn.flush();
                });
            }
        });
        Server { port, requests, ranges: seen }
    }

    /// Plain HTTP/1.1 client over std (the app's fetcher is reqwest with `Noted`, in the shell).
    pub(crate) struct Plain(pub u16);

    impl Fetch for Plain {
        fn get(&self, _key: &str, from: u64, _: bool) -> io::Result<Reply> {
            let mut s = TcpStream::connect(("127.0.0.1", self.0))?;
            s.set_read_timeout(Some(Duration::from_secs(5)))?;
            write!(s, "GET /song HTTP/1.1\r\nHost: localhost\r\nRange: bytes={from}-\r\nConnection: close\r\n\r\n")?;
            let mut r = BufReader::new(s);
            let mut line = String::new();
            r.read_line(&mut line)?;
            let status = line.split_whitespace().nth(1).and_then(|s| s.parse().ok()).unwrap_or(0);
            let (mut content_length, mut content_range, mut content_type) = (None, None, None);
            loop {
                let mut h = String::new();
                if r.read_line(&mut h)? == 0 || h == "\r\n" {
                    break;
                }
                let (k, v) = h.split_once(':').unwrap_or((&h, ""));
                match k.to_ascii_lowercase().as_str() {
                    "content-length" => content_length = v.trim().parse().ok(),
                    "content-range" => content_range = Some(v.trim().to_string()),
                    "content-type" => content_type = Some(v.trim().to_string()),
                    _ => {}
                }
            }
            Ok(Reply { status, content_length, content_range, content_type, body: Box::new(r) })
        }
    }

    fn bytes(n: usize) -> Vec<u8> {
        (0..n).map(|i| (i * 7 % 251) as u8).collect()
    }

    fn open(port: u16) -> (Stream, Info, Arc<Mutex<Option<String>>>) {
        let failed = Arc::new(Mutex::new(None));
        let (s, info) = Stream::open(Arc::new(Plain(port)), "k", false, failed.clone()).unwrap();
        (s, info, failed)
    }

    #[test]
    fn ranges_read_the_whole_file_and_seek_with_a_new_range() {
        let data = bytes(6 << 20);
        let srv = serve(data.clone(), true, None);
        let (mut s, info, _) = open(srv.port);
        assert!(info.ranged && info.len == Some(data.len() as u64) && info.mime.as_deref() == Some("audio/wav"));
        let mut head = vec![0; 1000];
        s.read_exact(&mut head).unwrap();
        assert_eq!(head, data[..1000]);
        // Far ahead: a new range from there.
        s.seek(SeekFrom::Start(5 << 20)).unwrap();
        let mut mid = vec![0; 4096];
        s.read_exact(&mut mid).unwrap();
        assert_eq!(mid, data[5 << 20..(5 << 20) + 4096]);
        assert!(srv.ranges.lock().unwrap().contains(&(5 << 20)), "{:?}", srv.ranges.lock().unwrap());
        // From the end, to the end.
        s.seek(SeekFrom::End(-10)).unwrap();
        let mut tail = Vec::new();
        s.read_to_end(&mut tail).unwrap();
        assert_eq!(tail, data[data.len() - 10..]);
    }

    #[test]
    fn a_small_step_back_needs_no_request() {
        let data = bytes(200_000);
        let srv = serve(data.clone(), true, None);
        let (mut s, _, _) = open(srv.port);
        let mut b = vec![0; 100_000];
        s.read_exact(&mut b).unwrap();
        s.seek(SeekFrom::Start(10)).unwrap();
        let mut again = vec![0; 50];
        s.read_exact(&mut again).unwrap();
        assert_eq!(again, data[10..60]);
        assert_eq!(srv.requests.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_server_ignoring_ranges_still_plays_and_seeks_by_reading_again() {
        let data = bytes(3 << 20);
        let srv = serve(data.clone(), false, None);
        let (mut s, info, _) = open(srv.port);
        assert!(!info.ranged && info.len == Some(data.len() as u64));
        let mut all = Vec::new();
        s.read_to_end(&mut all).unwrap();
        assert_eq!(all, data);
        // Back to the start after the whole song: read again from byte 0, the bytes right.
        s.seek(SeekFrom::Start(100)).unwrap();
        let mut b = vec![0; 100];
        s.read_exact(&mut b).unwrap();
        assert_eq!(b, data[100..200]);
    }

    #[test]
    fn a_dropped_connection_goes_on_from_where_it_stopped() {
        let data = bytes(500_000);
        let srv = serve(data.clone(), true, Some(123_457));
        let (mut s, _, failed) = open(srv.port);
        let mut all = Vec::new();
        s.read_to_end(&mut all).unwrap();
        assert_eq!(all.len(), data.len());
        assert_eq!(all, data);
        assert!(srv.ranges.lock().unwrap().contains(&123_457), "{:?}", srv.ranges.lock().unwrap());
        assert!(failed.lock().unwrap().is_none());
    }

    #[test]
    fn a_refused_sign_in_fails_at_once_in_words() {
        struct No;
        impl Fetch for No {
            fn get(&self, _: &str, _: u64, _: bool) -> io::Result<Reply> {
                Ok(Reply { status: 401, content_length: None, content_range: None, content_type: None, body: Box::new(io::empty()) })
            }
        }
        let e = Stream::open(Arc::new(No), "k", false, Arc::default()).err().unwrap();
        assert!(e.to_string().starts_with("Your music server refused the sign-in"), "{e}");
    }

    #[test]
    fn a_server_gone_mid_song_fails_after_a_few_tries() {
        // Answers once (cut), then nobody listens.
        struct Once(Mutex<Option<Reply>>);
        impl Fetch for Once {
            fn get(&self, _: &str, _: u64, _: bool) -> io::Result<Reply> {
                self.0.lock().unwrap().take().ok_or_else(|| io::Error::new(io::ErrorKind::ConnectionRefused, "connection refused"))
            }
        }
        let body: Box<dyn Read + Send> = Box::new(io::Cursor::new(vec![1u8; 1000]));
        let first = Reply { status: 206, content_length: Some(1000), content_range: Some("bytes 0-9999/10000".into()), content_type: None, body };
        let failed = Arc::new(Mutex::new(None));
        let (mut s, _) = Stream::open(Arc::new(Once(Mutex::new(Some(first)))), "k", false, failed.clone()).unwrap();
        let mut all = Vec::new();
        let e = s.read_to_end(&mut all).unwrap_err();
        assert_eq!(all.len(), 1000);
        assert!(e.to_string().contains("connection refused"), "{e}");
        assert!(failed.lock().unwrap().is_some());
    }

    #[test]
    fn a_range_that_starts_early_is_skipped_up_to_the_byte_asked() {
        // Answers from the 4 KB block before what was asked.
        struct Blocks(Vec<u8>);
        impl Fetch for Blocks {
            fn get(&self, _: &str, from: u64, _: bool) -> io::Result<Reply> {
                let start = from / 4096 * 4096;
                let total = self.0.len() as u64;
                let body = self.0[start as usize..].to_vec();
                Ok(Reply { status: 206, content_length: Some(body.len() as u64), content_range: Some(format!("bytes {start}-{}/{total}", total - 1)), content_type: None, body: Box::new(io::Cursor::new(body)) })
            }
        }
        let data = bytes(8 << 20);
        let (mut s, info) = Stream::open(Arc::new(Blocks(data.clone())), "k", false, Arc::default()).unwrap();
        assert!(info.ranged);
        let at = (6 << 20) + 1234;
        s.seek(SeekFrom::Start(at)).unwrap();
        let mut b = vec![0; 100];
        s.read_exact(&mut b).unwrap();
        assert_eq!(b, data[at as usize..at as usize + 100]);
    }

    #[test]
    fn a_server_that_cant_be_reached_is_told_from_a_song_it_lacks() {
        for kind in [io::ErrorKind::NotConnected, io::ErrorKind::PermissionDenied, io::ErrorKind::TimedOut, io::ErrorKind::ConnectionRefused] {
            assert!(unreachable(&io::Error::new(kind, "x")), "{kind:?}");
        }
        assert!(!unreachable(&io::Error::new(io::ErrorKind::NotFound, "gone")));
        assert!(!unreachable(&io::Error::other("Your music server failed (HTTP 500)")));
    }

    #[test]
    fn no_worker_is_left_once_the_stream_is_dropped() {
        // The worker holds the fetcher: back to one holder = it has ended. Waiting with the buffer full, and idle at the end.
        let srv = serve(bytes(6 << 20), true, None);
        let fetch: Arc<dyn Fetch> = Arc::new(Plain(srv.port));
        for read in [1_000usize, 6 << 20] {
            let (mut s, _) = Stream::open(fetch.clone(), "k", false, Arc::default()).unwrap();
            let mut b = vec![0; read];
            s.read_exact(&mut b).unwrap();
            // Let the worker fill up to its limit (or reach the end) and wait there.
            std::thread::sleep(Duration::from_millis(300));
            assert_eq!(Arc::strong_count(&fetch), 2);
            drop(s);
            let until = Instant::now() + Duration::from_secs(5);
            while Arc::strong_count(&fetch) > 1 && Instant::now() < until {
                std::thread::sleep(Duration::from_millis(10));
            }
            assert_eq!(Arc::strong_count(&fetch), 1, "worker still there after Stop ({read} bytes read)");
        }
    }

    #[test]
    fn the_buffer_stays_bounded_however_far_the_song_goes() {
        let srv = serve(bytes(12 << 20), true, None);
        let (mut s, _, _) = open(srv.port);
        let mut b = vec![0; 64 << 10];
        let mut most = 0;
        for _ in 0..((12 << 20) / (64 << 10)) {
            s.read_exact(&mut b).unwrap();
            most = most.max(s.shared.state.lock().unwrap().buf.len());
        }
        assert!(most <= AHEAD + BEHIND + CHUNK, "{most}");
    }

    #[test]
    fn ranges_are_read_from_their_header() {
        assert_eq!(parse_range("bytes 100-999/1000"), Some((100, Some(1000))));
        assert_eq!(parse_range("bytes 0-9/*"), Some((0, None)));
        assert_eq!(parse_range("junk"), None);
    }
}
