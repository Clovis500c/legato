//! MusicBrainz's open catalogue (musicbrainz.org), for Home's "New from your artists" (off until the user turns the
//! section on): an artist's albums, EPs and singles first released since a date. Checked 2026-11-11
//! (musicbrainz.org/doc/MusicBrainz_API/Search and /Rate_Limiting): `GET /ws/2/release-group/?query=<Lucene>&fmt=json
//! &limit=1..100` answers `{"release-groups":[{id, score, title, "first-release-date", "primary-type",
//! "secondary-types", "artist-credit":[{name, artist:{id, name}}]}]}`; no key; a User-Agent naming the app and a
//! contact address is required; one request a second per address at most, 503 when over (never retried here: the
//! caller spaces the artists and stops at the first refusal). Only the artist's name and a date leave the PC.
//! The date range in the query is Lucene's own syntax, which the docs don't show: the answer is filtered by date
//! here too, so a range that were ignored would only bring fewer new releases, never old ones.

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};

pub const API: &str = "https://musicbrainz.org/ws/2";
const AGENT: &str = concat!("Legato/", env!("CARGO_PKG_VERSION"), " ( https://github.com/Clovis500c/legato )");
/// Under this score the search matched something else than the artist's name.
const MIN_SCORE: u32 = 90;

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
}

impl Default for MusicBrainz {
    fn default() -> Self {
        Self::with_urls(API)
    }
}

impl MusicBrainz {
    pub fn with_urls(api: &str) -> Self {
        Self { api: api.trim_end_matches('/').to_string(), http: crate::http() }
    }

    /// One request. A 503 is MusicBrainz's "too fast": the caller stops asking.
    pub async fn new_releases(&self, artist: &str, since: &str) -> Result<Vec<Release>> {
        if !is_day(since) || artist.trim().is_empty() {
            bail!("Bad release search");
        }
        let url = url::Url::parse_with_params(&format!("{}/release-group/", self.api), [("query", query(artist, since).as_str()), ("fmt", "json"), ("limit", "50")])?;
        let r = self.http.get(url).header(reqwest::header::USER_AGENT, AGENT).timeout(crate::linklist::REQUEST_TIMEOUT).send().await?;
        if r.status() == reqwest::StatusCode::SERVICE_UNAVAILABLE || r.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            bail!("MusicBrainz is busy: try again later");
        }
        if !r.status().is_success() {
            bail!("MusicBrainz answered {}", r.status().as_u16());
        }
        pick(&r.text().await?, artist, since)
    }
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
}
