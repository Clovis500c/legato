//! MusicBrainz's open catalogue (musicbrainz.org), for Home's "New from your artists" (off until the user turns the
//! section on): an artist's albums, EPs and singles first released since a date. Checked 2026-11-11
//! (musicbrainz.org/doc/MusicBrainz_API/Search and /Rate_Limiting): `GET /ws/2/release-group/?query=<Lucene>&fmt=json
//! &limit=1..100` answers `{"release-groups":[{id, score, title, "first-release-date", "primary-type",
//! "secondary-types", "artist-credit":[{name, artist:{id, name}}]}]}`; no key; a User-Agent naming the app and a
//! contact address is required; one request a second per address at most, 503 when over (never retried here: the
//! caller spaces the artists and stops at the first refusal). Only the artist's name and a date leave the PC.
//! The date range in the query is Lucene's own syntax, which the docs don't show: the answer is filtered by date
//! here too, so a range that were ignored would only bring fewer new releases, never old ones.
//!
//! Edit song info's lookup (a click, one request): `GET /ws/2/recording/?query=recording:"<title>" AND
//! artist:"<artist>"` answers `{"recordings":[{score, length, "artist-credit", releases:[{title, status, date, country,
//! "artist-credit"?, "release-group":{"primary-type", "secondary-types"}, media:[{position, "track-count",
//! "track-offset", track:[{number}]}]}]}]}` (their search docs; a release's own credit only when it differs). Only the
//! song's title and artist leave the PC.

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use std::time::Duration;

pub const API: &str = "https://musicbrainz.org/ws/2";
pub(crate) const AGENT: &str = concat!("Legato/", env!("CARGO_PKG_VERSION"), " ( https://github.com/Clovis500c/legato )");
/// Under this score the search matched something else than the artist's name.
const MIN_SCORE: u32 = 90;
/// Releases offered to pick from in Edit song info.
const MAX_RELEASES: usize = 8;

/// An album, EP or single of an artist, by its first release.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "NewRelease")]
pub struct Release {
    /// MusicBrainz's release group id.
    pub id: String,
    pub title: String,
    pub artist: String,
    /// "Album", "EP" or "Single".
    pub kind: String,
    /// `YYYY-MM-DD`.
    pub date: String,
}

#[derive(Deserialize)]
struct Answer {
    #[serde(rename = "release-groups", default)]
    groups: Vec<Group>,
}

#[derive(Deserialize)]
struct Group {
    id: String,
    /// A number, or a number in a string (both seen in their docs).
    score: serde_json::Value,
    title: String,
    #[serde(rename = "first-release-date", default)]
    date: String,
    #[serde(rename = "primary-type", default)]
    kind: String,
    #[serde(rename = "secondary-types", default)]
    secondary: Vec<String>,
    #[serde(rename = "artist-credit", default)]
    credit: Vec<Credit>,
}

#[derive(Deserialize)]
struct Credit {
    name: String,
}

fn is_day(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10 && b.iter().enumerate().all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() })
}

/// A release a song is on, to fill Edit song info's album, album artist, year and numbers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "SongRelease")]
pub struct SongRelease {
    pub album: String,
    pub album_artist: String,
    pub year: Option<u32>,
    pub track: Option<u32>,
    pub disc: Option<u32>,
    /// Tracks on that disc.
    pub tracks: Option<u32>,
    /// "Album", "EP", "Single", "Compilation"…, as MusicBrainz says.
    pub kind: String,
    /// Two letters ("GB", "XW" for worldwide), or empty.
    pub country: String,
}

#[derive(Deserialize)]
struct Recordings {
    #[serde(default)]
    recordings: Vec<Recording>,
}

#[derive(Deserialize)]
struct Recording {
    score: serde_json::Value,
    /// ms.
    length: Option<u64>,
    #[serde(rename = "artist-credit", default)]
    credit: Vec<Credit>,
    #[serde(default)]
    releases: Vec<OnRelease>,
}

#[derive(Deserialize)]
struct OnRelease {
    title: String,
    status: Option<String>,
    date: Option<String>,
    country: Option<String>,
    #[serde(rename = "artist-credit", default)]
    credit: Vec<Credit>,
    #[serde(rename = "release-group")]
    group: Option<OnGroup>,
    #[serde(default)]
    media: Vec<Medium>,
}

#[derive(Deserialize)]
struct OnGroup {
    #[serde(rename = "primary-type")]
    kind: Option<String>,
    #[serde(rename = "secondary-types", default)]
    secondary: Vec<String>,
}

#[derive(Deserialize)]
struct Medium {
    position: Option<u32>,
    #[serde(rename = "track-count")]
    count: Option<u32>,
    #[serde(rename = "track-offset")]
    offset: Option<u32>,
    #[serde(default)]
    track: Vec<OnTrack>,
}

#[derive(Deserialize)]
struct OnTrack {
    #[serde(default)]
    number: String,
}

/// A number, or a number in a string (both seen in their docs).
fn score(v: &serde_json::Value) -> u64 {
    v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok())).unwrap_or(0)
}

fn names(credit: &[Credit]) -> String {
    credit.iter().map(|c| c.name.trim()).filter(|n| !n.is_empty()).collect::<Vec<_>>().join(", ")
}

/// The search for a song by its title and artist.
pub fn recording_query(title: &str, artist: &str) -> String {
    format!("recording:\"{}\" AND artist:\"{}\"", quoted(title), quoted(artist))
}

/// The releases the matching recordings are on, at most `MAX_RELEASES`: recordings that scored `MIN_SCORE` and, when
/// both lengths are known, within 10 s of the song's; official releases first, then a plain album, then the one named
/// `album`, then the earliest. The same album, year and numbers once.
pub fn pick_releases(body: &str, album: &str, duration_ms: Option<u64>) -> Result<Vec<SongRelease>> {
    let album = album.trim().to_lowercase();
    let mut found: Vec<(u8, String, SongRelease)> = Vec::new();
    for r in serde_json::from_str::<Recordings>(body)?.recordings {
        if score(&r.score) < u64::from(MIN_SCORE) || matches!((r.length, duration_ms), (Some(a), Some(b)) if a.abs_diff(b) > 10_000) {
            continue;
        }
        let artist = names(&r.credit);
        for rel in r.releases {
            let medium = rel.media.first();
            // A vinyl side's "A1" isn't a number: the place on the disc then.
            let track = medium.and_then(|m| m.track.first().and_then(|t| t.number.trim().parse().ok()).or(m.offset.map(|o| o + 1)));
            let (kind, secondary) = rel.group.map_or((String::new(), Vec::new()), |g| (g.kind.unwrap_or_default(), g.secondary));
            let date = rel.date.unwrap_or_default();
            let official = rel.status.as_deref().is_none_or(|s| s == "Official");
            // 0 = the best: official, a plain album, the name already typed.
            let rank = u8::from(!official) * 4 + u8::from(!(kind == "Album" && secondary.is_empty())) * 2 + u8::from(rel.title.trim().to_lowercase() != album);
            let release = SongRelease {
                album: rel.title.trim().to_string(),
                album_artist: if rel.credit.is_empty() { artist.clone() } else { names(&rel.credit) },
                year: date.get(..4).and_then(|y| y.parse().ok()),
                track,
                disc: medium.and_then(|m| m.position),
                tracks: medium.and_then(|m| m.count),
                kind: secondary.first().cloned().unwrap_or(kind),
                country: rel.country.unwrap_or_default(),
            };
            found.push((rank, if date.is_empty() { "9999".into() } else { date }, release));
        }
    }
    found.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    let mut out: Vec<SongRelease> = Vec::new();
    for (_, _, r) in found {
        if out.len() == MAX_RELEASES {
            break;
        }
        if !out.iter().any(|o| o.album.to_lowercase() == r.album.to_lowercase() && o.year == r.year && o.track == r.track && o.disc == r.disc) {
            out.push(r);
        }
    }
    Ok(out)
}

/// Lucene's special characters and quotes taken out of a name put between quotes.
fn quoted(name: &str) -> String {
    name.chars().map(|c| if c == '"' || c == '\\' { ' ' } else { c }).collect()
}

/// The search for `artist`'s release groups first released on `since` (`YYYY-MM-DD`) or later.
pub fn query(artist: &str, since: &str) -> String {
    format!("artistname:\"{}\" AND firstreleasedate:[{since} TO *] AND primarytype:(album OR single OR ep)", quoted(artist))
}

/// The releases of `artist` in a search answer: theirs by name (another artist of a close name dropped), dated to the
/// day, on `since` or later, no compilation, live or remix group; newest first.
pub fn pick(body: &str, artist: &str, since: &str) -> Result<Vec<Release>> {
    let wanted = artist.trim().to_lowercase();
    let mut out: Vec<Release> = serde_json::from_str::<Answer>(body)?
        .groups
        .into_iter()
        .filter(|g| g.score.as_u64().or_else(|| g.score.as_str().and_then(|s| s.parse().ok())).is_some_and(|s| s >= u64::from(MIN_SCORE)))
        .filter(|g| g.secondary.is_empty() && ["Album", "EP", "Single"].contains(&g.kind.as_str()))
        .filter(|g| is_day(&g.date) && g.date.as_str() >= since)
        .filter(|g| g.credit.iter().any(|c| c.name.trim().to_lowercase() == wanted))
        .map(|g| Release { id: g.id, title: g.title, artist: artist.trim().to_string(), kind: g.kind, date: g.date })
        .collect();
    out.sort_by(|a, b| b.date.cmp(&a.date).then_with(|| a.title.cmp(&b.title)));
    Ok(out)
}

pub struct MusicBrainz {
    api: String,
    http: reqwest::Client,
    /// Between two requests (their rule: one a second).
    gap: Duration,
}

/// Waits for this request's turn: one a second for every caller together (their rule is per address), since Home's
/// round, a song lookup and an artist's links can overlap.
async fn pace(gap: Duration) {
    static NEXT: tokio::sync::Mutex<Option<tokio::time::Instant>> = tokio::sync::Mutex::const_new(None);
    let mut next = NEXT.lock().await;
    if let Some(at) = *next {
        tokio::time::sleep_until(at).await;
    }
    *next = Some(tokio::time::Instant::now() + gap);
}

impl Default for MusicBrainz {
    fn default() -> Self {
        Self::with_urls(API)
    }
}

impl MusicBrainz {
    pub fn with_urls(api: &str) -> Self {
        Self { api: api.trim_end_matches('/').to_string(), http: crate::http(), gap: Duration::from_millis(1_100) }
    }

    /// One request. A 503 is MusicBrainz's "too fast": the caller stops asking.
    pub async fn new_releases(&self, artist: &str, since: &str) -> Result<Vec<Release>> {
        if !is_day(since) || artist.trim().is_empty() {
            bail!("Bad release search");
        }
        let url = url::Url::parse_with_params(&format!("{}/release-group/", self.api), [("query", query(artist, since).as_str()), ("fmt", "json"), ("limit", "50")])?;
        pace(self.gap).await;
        let r = self.http.get(url).header(reqwest::header::USER_AGENT, AGENT).timeout(crate::linklist::REQUEST_TIMEOUT).send().await?;
        if r.status() == reqwest::StatusCode::SERVICE_UNAVAILABLE || r.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            bail!("MusicBrainz is busy: try again later");
        }
        if !r.status().is_success() {
            bail!("MusicBrainz answered {}", r.status().as_u16());
        }
        pick(&r.text().await?, artist, since)
    }
    /// One request: the releases a song is on (Edit song info's lookup).
    pub async fn song_releases(&self, title: &str, artist: &str, album: &str, duration_ms: Option<u64>) -> Result<Vec<SongRelease>> {
        if title.trim().is_empty() || artist.trim().is_empty() {
            bail!("A title and an artist are needed");
        }
        let url = url::Url::parse_with_params(&format!("{}/recording/", self.api), [("query", recording_query(title, artist).as_str()), ("fmt", "json"), ("limit", "10")])?;
        pace(self.gap).await;
        let r = self.http.get(url).header(reqwest::header::USER_AGENT, AGENT).timeout(crate::linklist::REQUEST_TIMEOUT).send().await?;
        if r.status() == reqwest::StatusCode::SERVICE_UNAVAILABLE || r.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            bail!("MusicBrainz is busy: try again later");
        }
        if !r.status().is_success() {
            bail!("MusicBrainz answered {}", r.status().as_u16());
        }
        pick_releases(&r.text().await?, album, duration_ms)
    }

    /// Two requests, a second apart (their rule): the artist by name, then its links. Empty when no artist has that name.
    pub async fn artist_links(&self, name: &str) -> Result<Vec<ArtistLink>> {
        if name.trim().is_empty() || name.chars().count() > 200 {
            bail!("An artist's name is needed");
        }
        let url = url::Url::parse_with_params(&format!("{}/artist/", self.api), [("query", format!("artist:\"{}\"", quoted(name)).as_str()), ("fmt", "json"), ("limit", "5")])?;
        let Some(id) = pick_artist(&self.get(url).await?, name)? else { return Ok(Vec::new()) };
        let url = url::Url::parse_with_params(&format!("{}/artist/{id}", self.api), [("inc", "url-rels"), ("fmt", "json")])?;
        pick_links(&self.get(url).await?)
    }

    /// Two requests (the recording by title and artist, then its relations): who wrote, produced and played on a song.
    /// Empty when no recording matches well.
    pub async fn song_credits(&self, title: &str, artist: &str, duration_ms: Option<u64>) -> Result<Vec<SongCredit>> {
        if title.trim().is_empty() || artist.trim().is_empty() {
            bail!("A title and an artist are needed");
        }
        let url = url::Url::parse_with_params(&format!("{}/recording/", self.api), [("query", recording_query(title, artist).as_str()), ("fmt", "json"), ("limit", "5")])?;
        let Some(id) = pick_recording(&self.get(url).await?, duration_ms)? else { return Ok(Vec::new()) };
        let url = url::Url::parse_with_params(&format!("{}/recording/{id}", self.api), [("inc", "artist-rels work-rels work-level-rels"), ("fmt", "json")])?;
        pick_credits(&self.get(url).await?)
    }

    async fn get(&self, url: url::Url) -> Result<String> {
        pace(self.gap).await;
        let r = self.http.get(url).header(reqwest::header::USER_AGENT, AGENT).timeout(crate::linklist::REQUEST_TIMEOUT).send().await?;
        if r.status() == reqwest::StatusCode::SERVICE_UNAVAILABLE || r.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            bail!("MusicBrainz is busy: try again later");
        }
        if !r.status().is_success() {
            bail!("MusicBrainz answered {}", r.status().as_u16());
        }
        Ok(r.text().await?)
    }
}

/// One person's part in a song.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "SongCredit")]
pub struct SongCredit {
    /// "producer", "composer", "lyricist", "writer", "arranger", "mix", "engineer", "mastering", "conductor", an
    /// instrument, "vocal"…
    pub role: String,
    pub name: String,
}

/// Roles shown, in the order shown (MusicBrainz's relation types).
const CREDIT_ROLES: [&str; 12] = ["producer", "composer", "lyricist", "writer", "arranger", "mix", "engineer", "mastering", "conductor", "vocal", "instrument", "performer"];
const MAX_CREDITS: usize = 40;

/// The id of the first recording that scored `MIN_SCORE` and, when both lengths are known, is within 10 s of the song's.
fn pick_recording(body: &str, duration_ms: Option<u64>) -> Result<Option<String>> {
    #[derive(Deserialize)]
    struct R {
        id: String,
        score: serde_json::Value,
        length: Option<u64>,
    }
    #[derive(Deserialize)]
    struct All {
        #[serde(default)]
        recordings: Vec<R>,
    }
    Ok(serde_json::from_str::<All>(body)?
        .recordings
        .into_iter()
        .filter(|r| r.score.as_u64().or_else(|| r.score.as_str().and_then(|s| s.parse().ok())).is_some_and(|s| s >= u64::from(MIN_SCORE)))
        .filter(|r| match (r.length, duration_ms) {
            (Some(a), Some(b)) => a.abs_diff(b) <= 10_000,
            _ => true,
        })
        .filter(|r| r.id.len() == 36 && r.id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-'))
        .map(|r| r.id)
        .next())
}

/// The credits of a recording: its own artist relations (producer, mix, instruments…) and its work's (composer, lyricist,
/// writer), each person once per role, in the order of `CREDIT_ROLES`.
fn pick_credits(body: &str) -> Result<Vec<SongCredit>> {
    #[derive(Deserialize)]
    struct Named {
        name: String,
    }
    #[derive(Deserialize)]
    struct Rel {
        #[serde(rename = "type", default)]
        kind: String,
        artist: Option<Named>,
        work: Option<Work>,
        #[serde(default)]
        attributes: Vec<String>,
    }
    #[derive(Deserialize)]
    struct Work {
        #[serde(default)]
        relations: Vec<Rel>,
    }
    #[derive(Deserialize)]
    struct Rec {
        #[serde(default)]
        relations: Vec<Rel>,
    }
    let rec: Rec = serde_json::from_str(body)?;
    let mut out: Vec<SongCredit> = Vec::new();
    let mut add = |r: &Rel| {
        let Some(a) = &r.artist else { return };
        // An instrument or a voice is named by what it is ("guitar", "lead vocals"), not by the relation.
        let role = if matches!(r.kind.as_str(), "instrument" | "vocal") { r.attributes.first().cloned().unwrap_or_else(|| r.kind.clone()) } else { r.kind.clone() };
        let name = a.name.trim();
        let ok = CREDIT_ROLES.contains(&r.kind.as_str()) && !name.is_empty() && name.chars().count() <= 200 && role.chars().count() <= 60 && !out.iter().any(|c| c.role == role && c.name == name);
        if ok {
            out.push(SongCredit { role, name: name.to_string() });
        }
    };
    for r in &rec.relations {
        add(r);
        if let Some(w) = &r.work {
            w.relations.iter().for_each(&mut add);
        }
    }
    out.sort_by_key(|c| CREDIT_ROLES.iter().position(|k| *k == c.role).unwrap_or(CREDIT_ROLES.len()));
    out.truncate(MAX_CREDITS);
    Ok(out)
}

/// A link of an artist's page on MusicBrainz, to open in the browser.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "ArtistLink")]
pub struct ArtistLink {
    /// MusicBrainz's relation: "official homepage", "wikipedia", "bandcamp", "discogs"…
    pub kind: String,
    pub url: String,
}

/// Relations worth showing, in the order shown.
const LINK_KINDS: [&str; 8] = ["official homepage", "wikipedia", "bandcamp", "discogs", "allmusic", "social network", "streaming", "youtube"];
const MAX_LINKS: usize = 12;

/// The id of the artist named `name` (exactly, any case) among a search's answers, best score first.
fn pick_artist(body: &str, name: &str) -> Result<Option<String>> {
    #[derive(Deserialize)]
    struct A {
        id: String,
        name: String,
        score: serde_json::Value,
    }
    #[derive(Deserialize)]
    struct R {
        #[serde(default)]
        artists: Vec<A>,
    }
    let wanted = name.trim().to_lowercase();
    Ok(serde_json::from_str::<R>(body)?
        .artists
        .into_iter()
        .filter(|a| a.name.trim().to_lowercase() == wanted && a.score.as_u64().or_else(|| a.score.as_str().and_then(|s| s.parse().ok())).is_some_and(|s| s >= 90) && a.id.len() == 36 && a.id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-'))
        .map(|a| a.id)
        .next())
}

/// An artist's url relations kept: http(s) addresses of the kinds above, once each, at most `MAX_LINKS`.
fn pick_links(body: &str) -> Result<Vec<ArtistLink>> {
    #[derive(Deserialize)]
    struct U {
        resource: String,
    }
    #[derive(Deserialize)]
    struct Rel {
        #[serde(rename = "type", default)]
        kind: String,
        url: Option<U>,
    }
    #[derive(Deserialize)]
    struct A {
        #[serde(default)]
        relations: Vec<Rel>,
    }
    let mut out: Vec<ArtistLink> = serde_json::from_str::<A>(body)?
        .relations
        .into_iter()
        .filter_map(|r| {
            let url = r.url?.resource;
            let ok = (url.starts_with("https://") || url.starts_with("http://")) && url.len() <= 300 && !url.chars().any(|c| c.is_control() || c.is_whitespace());
            (ok && LINK_KINDS.contains(&r.kind.as_str())).then_some(ArtistLink { kind: r.kind, url })
        })
        .collect();
    out.sort_by_key(|l| LINK_KINDS.iter().position(|k| *k == l.kind));
    let mut seen = std::collections::HashSet::new();
    out.retain(|l| seen.insert(l.url.clone()));
    out.truncate(MAX_LINKS);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    // The shape of a real answer (their docs), cut to what is read.
    const BODY: &str = r#"{"created":"2026-11-11T08:00:00.000Z","count":5,"offset":0,"release-groups":[
      {"id":"a1","score":"100","title":"Night Drive","first-release-date":"2026-10-03","primary-type":"Album","artist-credit":[{"name":"Velvet Cartographers","artist":{"id":"x","name":"Velvet Cartographers"}}]},
      {"id":"a2","score":100,"title":"Old One","first-release-date":"2019-02-01","primary-type":"Album","artist-credit":[{"name":"Velvet Cartographers"}]},
      {"id":"a3","score":"100","title":"Live at Home","first-release-date":"2026-10-20","primary-type":"Album","secondary-types":["Live"],"artist-credit":[{"name":"Velvet Cartographers"}]},
      {"id":"a4","score":"95","title":"Single Thing","first-release-date":"2026-11-01","primary-type":"Single","artist-credit":[{"name":"velvet cartographers"},{"name":"Someone"}]},
      {"id":"a5","score":"100","title":"Not Theirs","first-release-date":"2026-11-02","primary-type":"Album","artist-credit":[{"name":"Velvet Cartographers Tribute Band"}]},
      {"id":"a6","score":"100","title":"Year Only","first-release-date":"2026","primary-type":"EP","artist-credit":[{"name":"Velvet Cartographers"}]},
      {"id":"a7","score":"40","title":"Weak Match","first-release-date":"2026-11-03","primary-type":"Album","artist-credit":[{"name":"Velvet Cartographers"}]}
    ]}"#;

    #[test]
    fn the_query_quotes_the_name_and_bounds_the_date() {
        assert_eq!(query("AC\"DC\\", "2026-09-12"), "artistname:\"AC DC \" AND firstreleasedate:[2026-09-12 TO *] AND primarytype:(album OR single OR ep)");
    }

    #[test]
    fn picks_their_dated_new_releases_newest_first() {
        let got = pick(BODY, " Velvet Cartographers ", "2026-09-12").unwrap();
        assert_eq!(got.iter().map(|r| (r.id.as_str(), r.kind.as_str(), r.date.as_str())).collect::<Vec<_>>(), [("a4", "Single", "2026-11-01"), ("a1", "Album", "2026-10-03")]);
        assert_eq!(got[0].artist, "Velvet Cartographers");
        assert!(pick("{}", "A", "2026-01-01").unwrap().is_empty());
        assert!(pick("<html>", "A", "2026-01-01").is_err());
    }

    #[tokio::test]
    async fn asks_once_with_the_app_named() {
        let mut server = mockito::Server::new_async().await;
        let m = server
            .mock("GET", "/release-group/")
            .match_query(mockito::Matcher::AllOf(vec![mockito::Matcher::UrlEncoded("fmt".into(), "json".into()), mockito::Matcher::UrlEncoded("query".into(), query("Velvet Cartographers", "2026-09-12"))]))
            .match_header("user-agent", mockito::Matcher::Regex(r"^Legato/\S+ \( https://github\.com/Clovis500c/legato \)$".into()))
            .with_body(BODY)
            .expect(1)
            .create_async()
            .await;
        let got = MusicBrainz::with_urls(&server.url()).new_releases("Velvet Cartographers", "2026-09-12").await.unwrap();
        assert_eq!(got.len(), 2);
        m.assert_async().await;
    }

    // A recording search's shape (their docs), cut to what is read.
    const SONG: &str = r#"{"recordings":[
      {"id":"r1","score":100,"title":"Glass Harbour","length":241000,"artist-credit":[{"name":"Velvet Cartographers"}],"releases":[
        {"title":"Best Of the Coast","status":"Official","date":"2015-03-02","country":"GB","release-group":{"primary-type":"Album","secondary-types":["Compilation"]},"media":[{"position":1,"track-count":18,"track-offset":4,"track":[{"number":"5"}]}]},
        {"title":"Tidelines","status":"Official","date":"2009-06-01","country":"XW","release-group":{"primary-type":"Album"},"media":[{"position":2,"track-count":11,"track-offset":2,"track":[{"number":"3"}]}]},
        {"title":"Tidelines","status":"Official","date":"2009-06-01","country":"US","release-group":{"primary-type":"Album"},"media":[{"position":2,"track-count":11,"track-offset":2,"track":[{"number":"3"}]}]},
        {"title":"Glass Harbour","status":"Promotion","date":"2009","artist-credit":[{"name":"VC"},{"name":"Guest"}],"release-group":{"primary-type":"Single"},"media":[{"position":1,"track-count":2,"track-offset":0,"track":[{"number":"A1"}]}]}
      ]},
      {"id":"r2","score":"100","title":"Glass Harbour (live)","length":300000,"artist-credit":[{"name":"Velvet Cartographers"}],"releases":[{"title":"Live","status":"Official","date":"2011","release-group":{"primary-type":"Album","secondary-types":["Live"]},"media":[]}]},
      {"id":"r3","score":50,"title":"Other","artist-credit":[{"name":"Someone"}],"releases":[{"title":"Nope","status":"Official"}]}
    ]}"#;

    #[test]
    fn a_song_s_releases_official_albums_first_once_each() {
        let got = pick_releases(SONG, "", Some(240_000)).unwrap();
        assert_eq!(got.iter().map(|r| (r.album.as_str(), r.year, r.track, r.disc)).collect::<Vec<_>>(), [("Tidelines", Some(2009), Some(3), Some(2)), ("Best Of the Coast", Some(2015), Some(5), Some(1)), ("Glass Harbour", Some(2009), Some(1), Some(1))]);
        assert_eq!((got[0].album_artist.as_str(), got[0].tracks, got[0].kind.as_str(), got[0].country.as_str()), ("Velvet Cartographers", Some(11), "Album", "XW"));
        assert_eq!((got[1].kind.as_str(), got[2].album_artist.as_str(), got[2].kind.as_str()), ("Compilation", "VC, Guest", "Single"));
        // The live take is a minute longer: left out; without a length, kept.
        assert!(pick_releases(SONG, "", None).unwrap().iter().any(|r| r.album == "Live"));
        // The album already typed comes first among its kind.
        let typed = pick_releases(SONG, " best of the coast", None).unwrap();
        assert_eq!(typed[0].album, "Tidelines");
        assert_eq!(recording_query("Say \"Hi\"", "A\\B"), "recording:\"Say  Hi \" AND artist:\"A B\"");
        assert!(pick_releases("{}", "", None).unwrap().is_empty());
    }

    #[tokio::test]
    async fn looks_a_song_up_once() {
        let mut server = mockito::Server::new_async().await;
        let m = server
            .mock("GET", "/recording/")
            .match_query(mockito::Matcher::UrlEncoded("query".into(), recording_query("Glass Harbour", "Velvet Cartographers")))
            .match_header("user-agent", mockito::Matcher::Regex(r"^Legato/".into()))
            .with_body(SONG)
            .expect(1)
            .create_async()
            .await;
        let mb = MusicBrainz::with_urls(&server.url());
        assert_eq!(mb.song_releases("Glass Harbour", "Velvet Cartographers", "", Some(241_000)).await.unwrap().len(), 3);
        m.assert_async().await;
        assert!(mb.song_releases(" ", "A", "", None).await.is_err());
    }

    #[tokio::test]
    async fn a_refusal_and_a_bad_answer_are_errors() {
        let mut server = mockito::Server::new_async().await;
        let busy = server.mock("GET", mockito::Matcher::Any).with_status(503).create_async().await;
        let mb = MusicBrainz::with_urls(&server.url());
        assert!(mb.new_releases("A", "2026-01-01").await.unwrap_err().to_string().contains("busy"));
        busy.remove_async().await;
        server.mock("GET", mockito::Matcher::Any).with_status(404).create_async().await;
        assert!(mb.new_releases("A", "2026-01-01").await.unwrap_err().to_string().contains("404"));
        assert!(mb.new_releases("A", "last week").await.is_err());
        assert!(mb.new_releases(" ", "2026-01-01").await.is_err());
    }

    const SEARCH: &str = r#"{"artists":[{"id":"11111111-2222-3333-4444-555555555555","name":"Kavinsky","score":100},{"id":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","name":"Kavinsky Tribute","score":"95"},{"id":"bad","name":"kavinsky","score":100}]}"#;
    const LINKS: &str = r#"{"relations":[
      {"type":"discogs","url":{"resource":"https://www.discogs.com/artist/1"}},
      {"type":"official homepage","url":{"resource":"https://kavinsky.example/"}},
      {"type":"official homepage","url":{"resource":"https://kavinsky.example/"}},
      {"type":"wikipedia","url":{"resource":"https://en.wikipedia.org/wiki/Kavinsky"}},
      {"type":"lyrics","url":{"resource":"https://lyrics.example/k"}},
      {"type":"bandcamp","url":{"resource":"javascript:alert(1)"}},
      {"type":"social network","url":{"resource":"https://x.example/a b"}},
      {"type":"streaming"}]}"#;

    #[test]
    fn the_artist_is_the_exact_name_with_a_good_score_and_links_are_filtered_and_ordered() {
        assert_eq!(pick_artist(SEARCH, " KAVINSKY ").unwrap().as_deref(), Some("11111111-2222-3333-4444-555555555555"));
        assert_eq!(pick_artist(SEARCH, "Nobody").unwrap(), None);
        assert!(pick_artist("nonsense", "x").is_err());
        let got = pick_links(LINKS).unwrap();
        assert_eq!(got.iter().map(|l| l.kind.as_str()).collect::<Vec<_>>(), ["official homepage", "wikipedia", "discogs"]);
        assert!(pick_links(r#"{"relations":[]}"#).unwrap().is_empty() && pick_links("nonsense").is_err());
    }

    #[tokio::test]
    async fn callers_together_ask_one_at_a_time_a_gap_apart() {
        let mut s = mockito::Server::new_async().await;
        s.mock("GET", "/artist/").match_query(mockito::Matcher::Any).with_body(r#"{"artists":[]}"#).expect(3).create_async().await;
        let mb = MusicBrainz { gap: Duration::from_millis(300), ..MusicBrainz::with_urls(&s.url()) };
        let start = std::time::Instant::now();
        let (a, b, c) = tokio::join!(mb.artist_links("A"), mb.artist_links("B"), mb.artist_links("C"));
        assert!(a.is_ok() && b.is_ok() && c.is_ok());
        assert!(start.elapsed() >= Duration::from_millis(600), "{:?}", start.elapsed());
    }

    #[tokio::test]
    async fn artist_links_asks_twice_and_stops_when_the_name_is_unknown() {
        let mut s = mockito::Server::new_async().await;
        let search = s.mock("GET", "/artist/").match_query(mockito::Matcher::UrlEncoded("fmt".into(), "json".into())).match_header("user-agent", mockito::Matcher::Regex("^Legato/".into())).with_body(SEARCH).expect(2).create_async().await;
        let lookup = s.mock("GET", "/artist/11111111-2222-3333-4444-555555555555").match_query(mockito::Matcher::UrlEncoded("inc".into(), "url-rels".into())).with_body(LINKS).expect(1).create_async().await;
        let mb = MusicBrainz { gap: Duration::ZERO, ..MusicBrainz::with_urls(&s.url()) };
        assert_eq!(mb.artist_links("Kavinsky").await.unwrap().len(), 3);
        assert!(mb.artist_links("Nobody").await.unwrap().is_empty());
        search.assert_async().await;
        lookup.assert_async().await;
        s.mock("GET", "/other/artist/").match_query(mockito::Matcher::Any).with_status(503).create_async().await;
        let busy = MusicBrainz { gap: Duration::ZERO, ..MusicBrainz::with_urls(&format!("{}/other", s.url())) };
        assert!(busy.artist_links("x").await.is_err());
    }

    #[test]
    fn credits_come_from_the_recording_and_its_work_each_person_once_per_role() {
        let search = r#"{"recordings":[{"id":"11111111-2222-3333-4444-555555555555","score":"60","length":200000},{"id":"22222222-2222-3333-4444-555555555555","score":100,"length":420000},{"id":"33333333-2222-3333-4444-555555555555","score":98,"length":201500}]}"#;
        assert_eq!(pick_recording(search, Some(200_000)).unwrap().as_deref(), Some("33333333-2222-3333-4444-555555555555"));
        assert_eq!(pick_recording(search, None).unwrap().as_deref(), Some("22222222-2222-3333-4444-555555555555"));
        assert_eq!(pick_recording(r#"{"recordings":[]}"#, None).unwrap(), None);
        let rec = r#"{"relations":[
          {"type":"producer","artist":{"name":"Vincent Belorgey"}},
          {"type":"instrument","attributes":["guitar"],"artist":{"name":"A Player"}},
          {"type":"producer","artist":{"name":"Vincent Belorgey"}},
          {"type":"remixer","artist":{"name":"Someone"}},
          {"type":"performance","work":{"relations":[{"type":"composer","artist":{"name":"Guillaume Brière"}},{"type":"lyricist","artist":{"name":"Lovefoxxx"}}]}},
          {"type":"url","url":{"resource":"https://x.example"}}]}"#;
        let got: Vec<(String, String)> = pick_credits(rec).unwrap().into_iter().map(|c| (c.role, c.name)).collect();
        assert_eq!(got, [("producer", "Vincent Belorgey"), ("composer", "Guillaume Brière"), ("lyricist", "Lovefoxxx"), ("guitar", "A Player")].map(|(a, b)| (a.to_string(), b.to_string())));
        assert!(pick_credits("nonsense").is_err());
    }

    #[tokio::test]
    async fn song_credits_asks_the_recording_then_its_relations() {
        let mut s = mockito::Server::new_async().await;
        let search = s.mock("GET", "/recording/").match_query(mockito::Matcher::UrlEncoded("fmt".into(), "json".into())).with_body(r#"{"recordings":[{"id":"11111111-2222-3333-4444-555555555555","score":100}]}"#).create_async().await;
        let rels = s.mock("GET", "/recording/11111111-2222-3333-4444-555555555555").match_query(mockito::Matcher::UrlEncoded("inc".into(), "artist-rels work-rels work-level-rels".into())).with_body(r#"{"relations":[{"type":"producer","artist":{"name":"P"}}]}"#).create_async().await;
        let mb = MusicBrainz { gap: Duration::ZERO, ..MusicBrainz::with_urls(&s.url()) };
        assert_eq!(mb.song_credits("Nightcall", "Kavinsky", None).await.unwrap(), [SongCredit { role: "producer".into(), name: "P".into() }]);
        search.assert_async().await;
        rels.assert_async().await;
        assert!(mb.song_credits(" ", "Kavinsky", None).await.is_err());
    }
}
