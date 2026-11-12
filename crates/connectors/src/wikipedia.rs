//! A short bio from Wikipedia (wikipedia.org's REST summary: `GET /api/rest_v1/page/summary/{title}` answers `{type,
//! title, extract, content_urls}`; no key, a User-Agent naming the app is asked). Only for a page MusicBrainz named as the
//! artist's Wikipedia page, on a click: the page address is checked (https, `xx.wikipedia.org`, `/wiki/<title>`) before
//! anything is asked. The text is Wikipedia's, under CC BY-SA: the interface shows where it comes from.

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use url::Url;

const AGENT: &str = concat!("Legato v", env!("CARGO_PKG_VERSION"), " (https://github.com/Clovis500c/legato)");
const TIMEOUT: Duration = Duration::from_secs(10);
/// Longest bio kept, in characters (the summary is a paragraph or two).
const MAX_CHARS: usize = 1_200;

/// A page's opening paragraph.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "Bio")]
pub struct Bio {
    pub title: String,
    pub text: String,
    /// The Wikipedia page the text comes from.
    pub page: String,
}

/// `(host, title)` of a Wikipedia article address: https, a language subdomain, `/wiki/<title>`.
fn parse_page(page: &str) -> Option<(String, String)> {
    let u = Url::parse(page).ok().filter(|u| u.scheme() == "https" && u.port().is_none() && u.username().is_empty())?;
    let host = u.host_str()?;
    let lang = host.strip_suffix(".wikipedia.org")?;
    let lang_ok = (2..=12).contains(&lang.len()) && lang.bytes().all(|b| b.is_ascii_lowercase() || b == b'-');
    let title = u.path().strip_prefix("/wiki/").filter(|t| !t.is_empty() && t.len() <= 200 && !t.contains('/'))?;
    lang_ok.then(|| (host.to_string(), title.to_string()))
}

pub struct Wikipedia {
    /// Where the API lives; the article's own host, unless a test points elsewhere.
    origin: Option<String>,
    http: reqwest::Client,
}

impl Default for Wikipedia {
    fn default() -> Self {
        Self { origin: None, http: crate::http() }
    }
}

#[derive(Deserialize)]
struct Summary {
    #[serde(rename = "type", default)]
    kind: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    extract: String,
}

impl Wikipedia {
    /// Tests: the API of a local server in place of the article's host.
    pub fn at(origin: &str) -> Self {
        Self { origin: Some(origin.trim_end_matches('/').to_string()), http: crate::http() }
    }

    /// The opening paragraph of the Wikipedia article at `page`. A disambiguation page or an empty one is no bio.
    pub async fn bio(&self, page: &str) -> Result<Bio> {
        let Some((host, title)) = parse_page(page) else { bail!("Not a Wikipedia article") };
        let origin = self.origin.clone().unwrap_or_else(|| format!("https://{host}"));
        let r = self.http.get(format!("{origin}/api/rest_v1/page/summary/{title}")).header(reqwest::header::USER_AGENT, AGENT).timeout(TIMEOUT).send().await.map_err(|_| anyhow::anyhow!("Wikipedia doesn't answer"))?;
        match r.status().as_u16() {
            404 => bail!("Wikipedia has no such article"),
            429 | 503 => bail!("Wikipedia is busy, try again in a moment"),
            s if s >= 400 => bail!("Wikipedia answered {s}"),
            _ => {}
        }
        let s: Summary = serde_json::from_str(&r.text().await?)?;
        let text: String = s.extract.split_whitespace().collect::<Vec<_>>().join(" ");
        if s.kind != "standard" || text.is_empty() {
            bail!("Wikipedia has no short text for this page");
        }
        let text = if text.chars().count() > MAX_CHARS { format!("{}…", text.chars().take(MAX_CHARS).collect::<String>().trim_end()) } else { text };
        Ok(Bio { title: s.title.chars().take(200).collect(), text, page: format!("https://{host}/wiki/{title}") })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_wikipedia_article_address_passes() {
        assert_eq!(parse_page("https://en.wikipedia.org/wiki/Kavinsky"), Some(("en.wikipedia.org".into(), "Kavinsky".into())));
        assert_eq!(parse_page("https://zh-yue.wikipedia.org/wiki/%E9%9F%B3"), Some(("zh-yue.wikipedia.org".into(), "%E9%9F%B3".into())));
        for bad in ["http://en.wikipedia.org/wiki/X", "https://wikipedia.org/wiki/X", "https://en.wikipedia.org.evil.example/wiki/X", "https://evil.example/en.wikipedia.org/wiki/X", "https://en.wikipedia.org:8443/wiki/X", "https://me@en.wikipedia.org/wiki/X", "https://en.wikipedia.org/w/index.php?title=X", "https://en.wikipedia.org/wiki/", "https://en.wikipedia.org/wiki/a/b", "https://EN1.wikipedia.org/wiki/X", "nonsense"] {
            assert_eq!(parse_page(bad), None, "{bad}");
        }
    }

    #[tokio::test]
    async fn a_bio_is_the_summary_text_cut_short_and_a_disambiguation_is_none() {
        let mut s = mockito::Server::new_async().await;
        let long = format!("{{\"type\":\"standard\",\"title\":\"Kavinsky\",\"extract\":\"{}\"}}", "Word  and\\nmore. ".repeat(200));
        let ok = s.mock("GET", "/api/rest_v1/page/summary/Kavinsky").match_header("user-agent", mockito::Matcher::Regex("^Legato v".into())).with_body(long).create_async().await;
        s.mock("GET", "/api/rest_v1/page/summary/Kavinsky_(disambiguation)").with_body(r#"{"type":"disambiguation","title":"K","extract":"K may refer to"}"#).create_async().await;
        s.mock("GET", "/api/rest_v1/page/summary/Gone").with_status(404).create_async().await;
        let w = Wikipedia::at(&s.url());
        let bio = w.bio("https://en.wikipedia.org/wiki/Kavinsky").await.unwrap();
        ok.assert_async().await;
        assert!(bio.text.chars().count() <= MAX_CHARS + 1 && bio.text.ends_with('…') && !bio.text.contains("  ") && !bio.text.contains('\n'));
        assert_eq!((bio.title.as_str(), bio.page.as_str()), ("Kavinsky", "https://en.wikipedia.org/wiki/Kavinsky"));
        assert!(w.bio("https://en.wikipedia.org/wiki/Kavinsky_(disambiguation)").await.is_err());
        assert!(w.bio("https://en.wikipedia.org/wiki/Gone").await.unwrap_err().to_string().contains("no such article"));
        assert!(w.bio("https://evil.example/wiki/Kavinsky").await.is_err());
    }
}
