use crate::library::Library;
use crate::matching::merge_tracks;
use crate::model::Connector;
use serde::Serialize;
use std::sync::Mutex;

#[derive(Debug, Default, PartialEq, Serialize)]
pub struct SyncReport {
    pub playlists: usize,
    pub matched: usize,
    pub errors: Vec<String>,
}

/// Import every playlist of connected services, then link tracks missing on `target` (e.g. YouTube → Spotify).
/// Library lock held only for writes, never across network await.
pub async fn sync(lib: &Mutex<Library>, connectors: &[&dyn Connector], target: Option<&dyn Connector>) -> SyncReport {
    let mut report = SyncReport::default();
    for c in connectors.iter().filter(|c| c.is_connected()) {
        let source = c.source();
        let playlists = match c.list_playlists().await {
            Ok(p) => p,
            Err(e) => {
                report.errors.push(format!("{} : {e:#}", source.as_str()));
                continue;
            }
        };
        for p in playlists {
            let saved = match c.playlist_tracks(&p.id).await {
                Ok(tracks) => lib.lock().unwrap().save_playlist(source, &p.id, &p.name, &tracks),
                Err(e) => Err(e),
            };
            match saved {
                Ok(_) => report.playlists += 1,
                Err(e) => report.errors.push(format!("{} « {} » : {e:#}", source.as_str(), p.name)),
            }
        }
    }

    let Some(target) = target.filter(|t| t.is_connected()) else { return report };
    let pending = match lib.lock().unwrap().tracks() {
        Ok(all) => all.into_iter().filter(|t| !t.track.ids.contains_key(&target.source())).collect::<Vec<_>>(),
        Err(e) => {
            report.errors.push(format!("library : {e:#}"));
            return report;
        }
    };
    // shortcut: unmatched tracks re-searched every sync. Add "last tried" column if rate limits bite.
    for t in pending {
        match target.resolve(&t.track).await {
            Ok(Some(hit)) => match lib.lock().unwrap().upsert_track(&merge_tracks(&t.track, &hit)) {
                Ok(_) => report.matched += 1,
                Err(e) => report.errors.push(format!("match « {} » : {e:#}", t.track.title)),
            },
            Ok(None) => {}
            Err(e) => report.errors.push(format!("match « {} » : {e:#}", t.track.title)),
        }
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::matching::best_match;
    use crate::model::{PlaylistRef, Source, Track};
    use anyhow::{Result, bail};
    use async_trait::async_trait;
    use std::collections::BTreeMap;

    struct Fake {
        source: Source,
        connected: bool,
        playlists: Vec<(&'static str, Vec<Track>)>,
        catalog: Vec<Track>,
    }

    #[async_trait]
    impl Connector for Fake {
        fn source(&self) -> Source {
            self.source
        }
        fn is_connected(&self) -> bool {
            self.connected
        }
        async fn connect(&self) -> Result<()> {
            Ok(())
        }
        fn disconnect(&self) -> Result<()> {
            Ok(())
        }
        async fn list_playlists(&self) -> Result<Vec<PlaylistRef>> {
            Ok(self.playlists.iter().map(|(id, _)| PlaylistRef { id: id.to_string(), name: format!("{} {id}", self.source.as_str()) }).collect())
        }
        async fn playlist_tracks(&self, id: &str) -> Result<Vec<Track>> {
            if id == "broken" {
                bail!("403");
            }
            Ok(self.playlists.iter().find(|(p, _)| *p == id).unwrap().1.clone())
        }
        async fn search(&self, _: &str) -> Result<Vec<Track>> {
            Ok(self.catalog.clone())
        }
        async fn resolve(&self, t: &Track) -> Result<Option<Track>> {
            Ok(best_match(t, &self.catalog).cloned())
        }
        async fn write_playlist(&self, _: &str, _: &[Track]) -> Result<String> {
            Ok("x".into())
        }
    }

    fn track(title: &str, artist: &str, ms: Option<u32>, source: Source, id: &str) -> Track {
        Track { title: title.into(), artist: artist.into(), duration_ms: ms, ids: BTreeMap::from([(source, id.into())]), ..Default::default() }
    }

    #[tokio::test]
    async fn imports_youtube_and_links_to_spotify() {
        let lib = Mutex::new(Library::in_memory().unwrap());
        let get_lucky = Track { isrc: Some("USQX91300108".into()), ..track("Get Lucky", "Daft Punk", Some(248_000), Source::Spotify, "s1") };
        let youtube = Fake {
            source: Source::Youtube,
            connected: true,
            playlists: vec![
                (
                    "PL1",
                    vec![
                        track("Get Lucky (Official Audio)", "Daft Punk", Some(250_000), Source::Youtube, "v1"),
                        track("Hello", "Adele", Some(367_000), Source::Youtube, "v2"),
                        track("Unknown Demo", "Nobody", None, Source::Youtube, "v3"),
                    ],
                ),
                ("broken", vec![]),
            ],
            catalog: vec![],
        };
        let spotify = Fake {
            source: Source::Spotify,
            connected: true,
            playlists: vec![("p1", vec![get_lucky.clone()])],
            catalog: vec![get_lucky, track("Hello", "Adele", Some(365_000), Source::Spotify, "s2")],
        };

        let report = sync(&lib, &[&spotify, &youtube], Some(&spotify)).await;

        assert_eq!(report.playlists, 2);
        assert_eq!(report.errors, vec!["youtube « youtube broken » : 403"]);
        assert_eq!(report.matched, 1);
        let by_title: BTreeMap<_, _> = lib.lock().unwrap().tracks().unwrap().into_iter().map(|t| (t.track.title, t.track.ids.len())).collect();
        assert_eq!(by_title, BTreeMap::from([("Get Lucky".into(), 2), ("Hello".into(), 2), ("Unknown Demo".into(), 1)]));
    }

    #[tokio::test]
    async fn skips_disconnected() {
        let lib = Mutex::new(Library::in_memory().unwrap());
        let off = Fake { source: Source::Youtube, connected: false, playlists: vec![("PL1", vec![])], catalog: vec![] };
        let target = Fake { source: Source::Spotify, connected: false, playlists: vec![], catalog: vec![] };
        assert_eq!(sync(&lib, &[&off], Some(&target)).await, SyncReport::default());
    }
}
