//! Lyrics translation through MyMemory (api.mymemory.translated.net): a free public translation memory, no key. Checked
//! 2026-11-13 from its docs: `GET /get?q=…&langpair=<from>|<to>` (`Autodetect` for the source), 500 bytes of text per
//! request, about 5 000 characters a day per address without an email; a quota answer is HTTP 429 or a body status of 429.
//! Only ever asked after the user said yes to sending this song's words; never cached or kept here; one request per chunk
//! of lines, no retry on a refusal.

use anyhow::{Result, bail};
use serde::Deserialize;
use std::time::Duration;
use url::Url;

pub const API: &str = "https://api.mymemory.translated.net";
/// Bytes of text one request may carry (the service's own limit is 500).
const CHUNK: usize = 450;
/// Most lines sent for a song, and the longest a line may be.
const MAX_LINES: usize = 200;
const MAX_LINE: usize = 200;

#[derive(Deserialize)]
struct Answer {
    #[serde(rename = "responseData")]
    data: Option<Data>,
    #[serde(rename = "responseStatus")]
    status: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct Data {
    #[serde(rename = "translatedText")]
    text: Option<String>,
}

pub struct MyMemory {
    api: String,
    http: reqwest::Client,
}

impl Default for MyMemory {
    fn default() -> Self {
        Self::with_urls(API)
    }
}

/// Lines cut into runs that fit one request each (a run is a start and an end in `lines`).
fn chunks(lines: &[String]) -> Vec<std::ops::Range<usize>> {
    let (mut out, mut start, mut size) = (Vec::new(), 0, 0);
    for (i, l) in lines.iter().enumerate() {
        let n = l.len() + 1;
        if size + n > CHUNK && i > start {
            out.push(start..i);
            (start, size) = (i, 0);
        }
        size += n;
    }
    if start < lines.len() {
        out.push(start..lines.len());
    }
    out
}

/// A language code the service takes: letters, at most two parts ("fr", "pt-BR").
fn code(c: &str) -> bool {
    !c.is_empty() && c.len() <= 8 && c.split('-').all(|p| !p.is_empty() && p.chars().all(|ch| ch.is_ascii_alphabetic()))
}

impl MyMemory {
    pub fn with_urls(api: &str) -> Self {
        Self { api: api.trim_end_matches('/').to_string(), http: crate::http() }
    }

    /// `lines` translated into `to`, line for line (an empty line stays empty). `from` None = the service guesses.
    pub async fn translate(&self, lines: &[String], from: Option<&str>, to: &str) -> Result<Vec<String>> {
        if !code(to) || from.is_some_and(|f| !code(f)) {
            bail!("Not a language code");
        }
        if lines.len() > MAX_LINES {
            bail!("Too many lines to translate");
        }
        let lines: Vec<String> = lines.iter().map(|l| l.trim().chars().take(MAX_LINE).collect()).collect();
        let pair = format!("{}|{to}", from.unwrap_or("Autodetect"));
        let mut out: Vec<String> = Vec::with_capacity(lines.len());
        for run in chunks(&lines) {
            let wanted = lines[run.clone()].join("\n");
            if wanted.trim().is_empty() {
                out.extend(run.map(|_| String::new()));
                continue;
            }
            let url = Url::parse_with_params(&format!("{}/get", self.api), [("q", wanted.as_str()), ("langpair", pair.as_str())])?;
            let r = self.http.get(url).timeout(Duration::from_secs(15)).send().await?;
            if r.status().as_u16() == 429 {
                bail!("The translation service has had enough for today, try again later");
            }
            let a: Answer = r.error_for_status()?.json().await?;
            // The body carries its own status (a number or a string): 200 is an answer, 429 a quota, anything else a refusal.
            let status = a.status.as_ref().and_then(|s| s.as_u64().or_else(|| s.as_str().and_then(|t| t.parse().ok()))).unwrap_or(200);
            if status == 429 {
                bail!("The translation service has had enough for today, try again later");
            }
            let Some(text) = a.data.and_then(|d| d.text).filter(|_| status == 200) else { bail!("The translation service refused this text") };
            let back: Vec<&str> = text.split('\n').collect();
            if back.len() != run.len() {
                bail!("The translation came back in a different shape");
            }
            out.extend(back.into_iter().map(|t| t.trim().to_string()));
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::{Matcher, Server};

    fn v(l: &[&str]) -> Vec<String> {
        l.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn lines_are_cut_into_runs_of_450_bytes() {
        let lines: Vec<String> = (0..10).map(|_| "x".repeat(99)).collect();
        let runs = chunks(&lines);
        assert_eq!(runs, [0..4, 4..8, 8..10]);
        assert_eq!(chunks(&[]), Vec::<std::ops::Range<usize>>::new());
        assert_eq!(chunks(&["y".repeat(900)]), vec![0..1]);
    }

    #[tokio::test]
    async fn lines_come_back_one_for_one() {
        let mut s = Server::new_async().await;
        let m = s
            .mock("GET", "/get")
            .match_query(Matcher::AllOf(vec![Matcher::UrlEncoded("langpair".into(), "Autodetect|fr".into()), Matcher::UrlEncoded("q".into(), "Hello\nGood night".into())]))
            .with_body(r#"{"responseData":{"translatedText":"Bonjour\nBonne nuit"},"responseStatus":200}"#)
            .expect(1)
            .create_async()
            .await;
        let got = MyMemory::with_urls(&s.url()).translate(&v(&["Hello", " Good night "]), None, "fr").await.unwrap();
        assert_eq!(got, ["Bonjour", "Bonne nuit"]);
        m.assert_async().await;
    }

    #[tokio::test]
    async fn a_quota_a_refusal_and_a_misshapen_answer_are_errors_and_blank_lines_cost_nothing() {
        let mut s = Server::new_async().await;
        let quota = s.mock("GET", "/get").match_query(Matcher::UrlEncoded("q".into(), "a".into())).with_status(429).create_async().await;
        let body = s.mock("GET", "/get").match_query(Matcher::UrlEncoded("q".into(), "b".into())).with_body(r#"{"responseData":{"translatedText":"QUERY LENGTH LIMIT"},"responseStatus":"429"}"#).create_async().await;
        let refused = s.mock("GET", "/get").match_query(Matcher::UrlEncoded("q".into(), "c".into())).with_body(r#"{"responseData":{"translatedText":"x"},"responseStatus":403}"#).create_async().await;
        let shape = s.mock("GET", "/get").match_query(Matcher::UrlEncoded("q".into(), "d\ne".into())).with_body(r#"{"responseData":{"translatedText":"one line"},"responseStatus":200}"#).create_async().await;
        let t = MyMemory::with_urls(&s.url());
        for (line, expect) in [(&["a"][..], "enough"), (&["b"], "enough"), (&["c"], "refused"), (&["d", "e"], "shape")] {
            let e = t.translate(&v(line), Some("en"), "fr").await.unwrap_err().to_string();
            assert!(e.contains(expect), "{e}");
        }
        assert_eq!(t.translate(&v(&["", "  "]), None, "fr").await.unwrap(), ["", ""]);
        assert!(t.translate(&v(&["a"]), None, "fr; drop").await.is_err());
        assert!(t.translate(&v(&["a"]), Some(""), "fr").await.is_err());
        for m in [quota, body, refused, shape] {
            m.assert_async().await;
        }
    }
}
