//! Lyrics for Now Playing: the library's own, then LRCLIB and YouTube Music's, the choices, a pick kept, a phrase searched.

use super::*;

/// The song Now Playing wants lyrics for.
#[derive(Debug, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LyricsAsk {
    title: String,
    artist: String,
    album: Option<String>,
    duration_ms: Option<u32>,
    /// Its YouTube video: YouTube Music's own lyrics when LRCLIB has none.
    youtube: Option<String>,
    /// Its library row when its local file or its music server's copy plays: the song's own lyrics first.
    track_id: Option<i64>,
}

impl LyricsAsk {
    /// Trust boundary: text from the UI.
    fn fair(&self) -> bool {
        !self.title.trim().is_empty() && self.title.len() <= 400 && self.artist.len() <= 400
    }
}

/// The video's id when it looks like one.
pub fn youtube_of(ask: &LyricsAsk) -> Option<&str> {
    ask.youtube.as_deref().filter(|v| v.len() == 11 && v.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'))
}

/// YouTube Music's lyrics → what Now Playing shows. Another speed: plain only (its timings are the original's).
pub fn from_ytm(l: YtLyrics, speed: bool) -> Lyrics {
    let source = |s: String| if s.is_empty() { "YouTube Music".to_string() } else { format!("YouTube Music · {s}") };
    match l {
        YtLyrics::Timed(lines, s) => {
            let plain = lines.iter().map(|l| l.text.as_str()).filter(|t| !t.is_empty()).collect::<Vec<_>>().join("\n");
            Lyrics { lines: if speed { Vec::new() } else { lines }, plain: Some(plain), instrumental: false, source: source(s), own: false }
        }
        YtLyrics::Plain(text, s) => Lyrics { lines: Vec::new(), plain: Some(text), instrumental: false, source: source(s), own: false },
    }
}

/// The song's own lyrics: its local file's (its tag, or the LRC beside it), else its music server's (OpenSubsonic,
/// Jellyfin). Not cached: they may change. A server out of reach: None, the other sources come.
pub async fn own_lyrics(state: &AppState, ask: &LyricsAsk) -> CmdResult<Option<Lyrics>> {
    let Some(id) = ask.track_id else { return Ok(None) };
    let file = state.lib().local_path(id).map_err(err)?;
    if let Some(path) = file {
        let own = tauri::async_runtime::spawn_blocking(move || music_core::local::lyrics(std::path::Path::new(&path))).await.map_err(err)?;
        if let Some(l) = own.as_deref().and_then(lyrics::from_file) {
            return Ok(Some(l));
        }
    }
    let server = state.lib().track(id).map_err(err)?.and_then(|t| t.track.ids.get(&Source::Server).cloned());
    let Some(sid) = server else { return Ok(None) };
    Ok(servers::lyrics(&sid, &ask.artist, &ask.title).await.map(|(r, name)| lyrics::build(r, Some(1.0), &name)))
}

/// Nothing found: asked again after a week (LRCLIB fills gaps over time).
pub const LYRICS_RETRY_S: i64 = 7 * 86_400;

/// Now Playing › Lyrics: the ones picked by hand for the song, then the song's own (its local file, its music server),
/// then the cache, then YouTube Music's timed lyrics when signed in, then LRCLIB (exact match, then search, timings
/// fitted to slowed / sped up versions), then YouTube Music's plain text. Network failures are not cached.
#[tauri::command]
pub async fn lyrics(state: State<'_, AppState>, ask: LyricsAsk) -> CmdResult<Option<Lyrics>> {
    if !ask.fair() {
        return Ok(None);
    }
    let key = lyrics::key(&ask.artist, &ask.title, ask.duration_ms);
    let picked = state.lib().cached_lyrics(&lyrics::pick_key(&key)).map_err(err)?;
    if let Some((Some(body), _)) = picked
        && let Ok(l) = serde_json::from_str::<Lyrics>(&body)
    {
        return Ok(Some(l));
    }
    if let Some(l) = own_lyrics(&state, &ask).await? {
        return Ok(Some(l));
    }
    let now = unix_now();
    let cached = state.lib().cached_lyrics(&key).map_err(err)?;
    // Plain text older than a day: asked again, shown still if nothing better comes.
    let stale = match cached {
        Some((Some(body), at)) => match serde_json::from_str::<Lyrics>(&body) {
            Ok(l) if lyrics::keep_cached(&l, now - at) => return Ok(Some(l)),
            Ok(l) => Some(l),
            Err(_) => None,
        },
        Some((None, at)) if now - at < LYRICS_RETRY_S => return Ok(None),
        _ => None,
    };
    let speed = lyrics::speed_changed(&ask.title);
    let playing_s = ask.duration_ms.map(|d| d as f32 / 1000.0);
    let lrclib = Lrclib::with_urls(hosts::get().lrclib);
    let mut found = None;
    let mut failed = None;
    // Signed in: YouTube Music's own first. Its timed lines (start and end) win; plain text waits behind LRCLIB.
    // A speed-changed version keeps LRCLIB's stretch (YouTube's timings are the original's).
    let mut yt_plain = None;
    if let Some(id) = youtube_of(&ask)
        && let Some(yt) = state.ytm()
    {
        match yt.lyrics(id).await {
            Ok(Some(l)) => {
                let l = from_ytm(l, speed);
                if l.lines.is_empty() { yt_plain = Some(l) } else { found = Some(l) }
            }
            Ok(None) => {}
            Err(e) => failed = Some(e),
        }
    }
    // Plain-only (or unfitting) answer: kept while other queries may still give synced lines (user's report
    // 2026-10-22: lyrics that stay white).
    let mut plain = None;
    let take = |l: Lyrics, plain: &mut Option<Lyrics>| {
        if lyrics::too_thin(&l, playing_s) {
            return None;
        }
        if !l.lines.is_empty() || l.instrumental {
            return Some(l);
        }
        plain.get_or_insert(l);
        None
    };
    for (artist, title) in lyrics::queries(&ask.artist, &ask.title) {
        if found.is_some() {
            break;
        }
        // Exact first; another speed never matches its duration.
        if !speed {
            match lrclib.get(&title, &artist, ask.album.as_deref(), ask.duration_ms.map(|d| (d + 500) / 1000)).await {
                Ok(Some(r)) => found = take(lyrics::build(r, Some(1.0), "LRCLIB"), &mut plain),
                Ok(None) => {}
                Err(e) => failed = Some(e),
            }
            if found.is_some() {
                break;
            }
        }
        match lrclib.search(&title, &artist).await {
            Ok(records) => {
                let records = records.into_iter().filter(|r| lyrics::same_title(&r.title, &title)).collect();
                if let Some((r, fit)) = lyrics::pick(records, playing_s, speed) {
                    found = take(lyrics::build(r, fit, "LRCLIB"), &mut plain);
                }
            }
            Err(e) => failed = Some(e),
        }
        if found.is_some() {
            break;
        }
    }
    found = found.or(plain).or(yt_plain);
    match (found, failed) {
        (Some(l), failed) => {
            // Plain while a lookup failed: not kept, the next play asks again for synced lines.
            if failed.is_none() || !l.lines.is_empty() || l.instrumental {
                state.lib().save_lyrics(&key, serde_json::to_string(&l).ok().as_deref(), now).map_err(err)?;
            }
            Ok(Some(l))
        }
        (None, _) if stale.is_some() => Ok(stale),
        (None, Some(e)) => Err(err(e)),
        (None, None) => {
            state.lib().save_lyrics(&key, None, now).map_err(err)?;
            Ok(None)
        }
    }
}

/// Now Playing's source picker: every lyrics found for the song, best match first (Against Liner 14). The song's own
/// and YouTube Music's (the video's own) count 100; LRCLIB's records (exact, then each search) by `lyrics::score`.
/// Asked on the user's click only; nothing cached.
#[tauri::command]
pub async fn lyrics_choices(state: State<'_, AppState>, ask: LyricsAsk) -> CmdResult<Vec<lyrics::Choice>> {
    if !ask.fair() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    if let Some(l) = own_lyrics(&state, &ask).await? {
        out.push(lyrics::Choice { lyrics: l, score: 100 });
    }
    let speed = lyrics::speed_changed(&ask.title);
    let playing_s = ask.duration_ms.map(|d| d as f32 / 1000.0);
    let mut failed = None;
    if let Some(id) = youtube_of(&ask)
        && let Some(yt) = state.ytm()
    {
        match yt.lyrics(id).await {
            Ok(Some(l)) => out.push(lyrics::Choice { lyrics: from_ytm(l, speed), score: 100 }),
            Ok(None) => {}
            Err(e) => failed = Some(e),
        }
    }
    let lrclib = Lrclib::with_urls(hosts::get().lrclib);
    let queries = lyrics::queries(&ask.artist, &ask.title);
    let mut records = Vec::new();
    for (artist, title) in &queries {
        if !speed && records.is_empty() {
            match lrclib.get(title, artist, ask.album.as_deref(), ask.duration_ms.map(|d| (d + 500) / 1000)).await {
                Ok(r) => records.extend(r),
                Err(e) => failed = Some(e),
            }
        }
        match lrclib.search(title, artist).await {
            Ok(found) => records.extend(found.into_iter().filter(|r| lyrics::same_title(&r.title, title))),
            Err(e) => failed = Some(e),
        }
    }
    for r in records {
        let score = queries.iter().map(|(a, t)| lyrics::score(&r, t, a, playing_s, speed)).max().unwrap_or(0);
        let fit = lyrics::stretch(r.duration_s, playing_s, speed);
        let l = lyrics::build(r, fit, "LRCLIB");
        if !lyrics::too_thin(&l, playing_s) && !out.iter().any(|c: &lyrics::Choice| c.lyrics == l) {
            out.push(lyrics::Choice { lyrics: l, score });
        }
    }
    if let (true, Some(e)) = (out.is_empty(), failed) {
        return Err(err(e));
    }
    // Best match first; at equal match, synced lines first.
    out.sort_by_key(|c| (std::cmp::Reverse(c.score), c.lyrics.lines.is_empty()));
    out.truncate(12);
    Ok(out)
}

/// A pick's text at most (a long song's Lyricsfile with its words is ~100 KB).
pub const PICK_MAX: usize = 512 * 1024;

/// Lyrics picked in the source picker: kept for this song (this PC) and shown before any other. None, or the song's
/// own, goes back to the usual order.
#[tauri::command]
pub async fn lyrics_pick(state: State<'_, AppState>, ask: LyricsAsk, picked: Option<Lyrics>) -> CmdResult<()> {
    if !ask.fair() {
        return Err("Not a song".into());
    }
    let body = picked.filter(|l| !l.own).map(|l| serde_json::to_string(&l)).transpose().map_err(err)?;
    // Trust boundary: lyrics from the UI.
    if body.as_ref().is_some_and(|b| b.len() > PICK_MAX) {
        return Err("These lyrics are too long".into());
    }
    let key = lyrics::pick_key(&lyrics::key(&ask.artist, &ask.title, ask.duration_ms));
    state.lib().save_lyrics(&key, body.as_deref(), unix_now()).map_err(err)
}

/// Library songs whose lyrics hold a typed line (the search page's "In the lyrics"): the lyrics cached when they were
/// shown, nothing asked online.
#[tauri::command]
pub async fn search_lyrics(state: State<'_, AppState>, q: String) -> CmdResult<Vec<lyrics::LyricHit>> {
    // Trust boundary: text from the UI.
    let phrase = lyrics::fold(&q.chars().take(400).collect::<String>());
    if phrase.chars().count() < lyrics::MIN_PHRASE {
        return Ok(Vec::new());
    }
    state.lib().lyrics_search(&phrase, 50).map_err(err)
}
