//! Phone updates (Android has no Tauri updater): Beta's latest.json names the newest version, and its release holds
//! `Legato_<version>_android-arm64.apk` (`release.yml`), downloaded here for Android's installer
//! (`src-tauri/src/mobile/update.rs`). Only Betas carry an APK so far: the phone follows Beta.

use anyhow::{Result, bail};
use serde::Deserialize;
use std::io::Write;
use std::path::Path;

/// The rolling `beta` release's file (`release.yml` moves it at every release), as the PC's Beta reads it.
pub const BETA: &str = "https://github.com/Clovis500c/legato/releases/download/beta/latest.json";
const RELEASES: &str = "https://github.com/Clovis500c/legato/releases/download";

/// A newer version whose release has its APK.
#[derive(Debug, Clone, PartialEq)]
pub struct Found {
    pub version: String,
    pub notes: Option<String>,
    pub url: String,
}

#[derive(Deserialize)]
struct Latest {
    version: String,
    notes: Option<String>,
}

pub struct Apk {
    http: reqwest::Client,
    latest: String,
    releases: String,
}

impl Default for Apk {
    fn default() -> Self {
        Self::with_urls(BETA, RELEASES)
    }
}

impl Apk {
    /// Tests: a local server for both.
    pub fn with_urls(latest: &str, releases: &str) -> Self {
        Self { http: crate::http(), latest: latest.into(), releases: releases.trim_end_matches('/').into() }
    }

    /// A version newer than `current` whose APK is there; None: up to date, or its APK isn't up yet (built last).
    pub async fn check(&self, current: &str) -> Result<Option<Found>> {
        let r = self.http.get(&self.latest).send().await?;
        if !r.status().is_success() {
            bail!("latest.json: {}", r.status());
        }
        let latest: Latest = r.json().await?;
        let version = latest.version.trim_start_matches('v').to_string();
        if !newer(&version, current) {
            return Ok(None);
        }
        let url = format!("{}/v{version}/Legato_{version}_android-arm64.apk", self.releases);
        if !self.http.head(&url).send().await?.status().is_success() {
            return Ok(None);
        }
        Ok(Some(Found { version, notes: latest.notes.filter(|n| !n.trim().is_empty()), url }))
    }

    /// The APK into `to`, through `to`.part renamed once whole; `progress` in percent as it comes.
    pub async fn download(&self, found: &Found, to: &Path, progress: impl FnMut(u8)) -> Result<()> {
        let part = to.with_extension("part");
        let got = self.fetch(found, &part, progress).await.and_then(|()| Ok(std::fs::rename(&part, to)?));
        if got.is_err() {
            let _ = std::fs::remove_file(&part);
        }
        got
    }

    async fn fetch(&self, found: &Found, part: &Path, mut progress: impl FnMut(u8)) -> Result<()> {
        let mut r = self.http.get(&found.url).send().await?;
        if !r.status().is_success() {
            bail!("APK: {}", r.status());
        }
        let total = r.content_length().filter(|t| *t > 0);
        let mut file = std::fs::File::create(part)?;
        let (mut done, mut shown) = (0u64, None);
        while let Some(chunk) = r.chunk().await? {
            // An APK is a zip: anything else is a page of errors.
            if done == 0 && !chunk.starts_with(b"PK") {
                bail!("Not an APK");
            }
            file.write_all(&chunk)?;
            done += chunk.len() as u64;
            if let Some(total) = total {
                let p = (done * 100 / total).min(100) as u8;
                if shown != Some(p) {
                    shown = Some(p);
                    progress(p);
                }
            }
        }
        if done == 0 || total.is_some_and(|t| t != done) {
            bail!("APK cut short");
        }
        file.sync_all()?;
        Ok(())
    }
}

/// Is `a` later than `b` ("1.1.679" after "1.1.641")? Part by part as numbers; a missing or odd part counts 0.
fn newer(a: &str, b: &str) -> bool {
    let parts = |v: &str| -> Vec<u64> { v.split(['.', '-', '+']).take(3).map(|p| p.parse().unwrap_or(0)).collect() };
    let (a, b) = (parts(a), parts(b));
    (0..3).map(|i| (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0))).find(|(x, y)| x != y).is_some_and(|(x, y)| x > y)
}

#[cfg(test)]
mod tests {
    use super::*;

    const APK: &str = "/v1.1.700/Legato_1.1.700_android-arm64.apk";

    fn latest(s: &mut mockito::ServerGuard, version: &str) -> mockito::Mock {
        let body = serde_json::json!({ "version": version, "notes": "### New\n- Something", "platforms": {} });
        s.mock("GET", "/latest.json").with_body(body.to_string()).create()
    }

    #[test]
    fn newer_compares_numbers_part_by_part() {
        assert!(newer("1.1.679", "1.1.641"));
        assert!(newer("1.2.0", "1.1.999"));
        assert!(newer("1.1.10", "1.1.9"));
        assert!(!newer("1.1.641", "1.1.641"));
        assert!(!newer("1.1.600", "1.1.641"));
        assert!(newer("1.1.1", "1.1"));
    }

    #[tokio::test]
    async fn check_finds_a_newer_version_with_its_apk() {
        let mut s = mockito::Server::new_async().await;
        latest(&mut s, "v1.1.700");
        let head = s.mock("HEAD", APK).create();
        let found = Apk::with_urls(&format!("{}/latest.json", s.url()), &s.url()).check("1.1.679").await.unwrap().unwrap();
        head.assert();
        assert_eq!(found, Found { version: "1.1.700".into(), notes: Some("### New\n- Something".into()), url: format!("{}{APK}", s.url()) });
    }

    #[tokio::test]
    async fn check_is_quiet_when_up_to_date_or_the_apk_is_missing() {
        let mut s = mockito::Server::new_async().await;
        latest(&mut s, "1.1.700");
        let apk = Apk::with_urls(&format!("{}/latest.json", s.url()), &s.url());
        let head = s.mock("HEAD", APK).expect(0).create();
        assert_eq!(apk.check("1.1.700").await.unwrap(), None);
        head.assert();
        s.mock("HEAD", APK).with_status(404).create();
        assert_eq!(apk.check("1.1.679").await.unwrap(), None);
        s.mock("GET", "/broken.json").with_status(502).create();
        assert!(Apk::with_urls(&format!("{}/broken.json", s.url()), &s.url()).check("1.1.679").await.is_err());
    }

    #[tokio::test]
    async fn download_writes_the_apk_whole_or_nothing() {
        let mut s = mockito::Server::new_async().await;
        let body = [b"PK\x03\x04".as_slice(), &[7u8; 5000]].concat();
        s.mock("GET", APK).with_body(&body).create();
        s.mock("GET", "/page.apk").with_body("<html>Not found</html>").create();
        let dir = std::env::temp_dir().join(format!("legato-apk-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let apk = Apk::with_urls("unused", &s.url());
        let found = Found { version: "1.1.700".into(), notes: None, url: format!("{}{APK}", s.url()) };
        let to = dir.join("legato.apk");
        let mut seen = vec![];
        apk.download(&found, &to, |p| seen.push(p)).await.unwrap();
        assert_eq!(std::fs::read(&to).unwrap(), body);
        assert_eq!(seen.last(), Some(&100));
        assert!(!to.with_extension("part").exists());
        let page = Found { url: format!("{}/page.apk", s.url()), ..found };
        let bad = dir.join("bad.apk");
        assert!(apk.download(&page, &bad, |_| {}).await.is_err());
        assert!(!bad.exists() && !bad.with_extension("part").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
