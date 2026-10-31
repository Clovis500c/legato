//! Apple Music catalog via the public iTunes Search API: no key, about 20 calls/min.

use crate::linklist::{LinkList, MAX_TRACKS};
use anyhow::{Context, Result};
use music_core::musicness::Musicness;
use music_core::model::{Source, Track};
use regex::Regex;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::sync::LazyLock;
use url::Url;

pub const API: &str = "https://itunes.apple.com/search";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Hit {
    track_id: Option<u64>,
    track_name: Option<String>,
    artist_name: Option<String>,
    collection_name: Option<String>,
    track_time_millis: Option<u32>,
    artwork_url100: Option<String>,
}

#[derive(Deserialize)]
struct Page {
    results: Vec<Hit>,
}

pub const LOOKUP: &str = "https://itunes.apple.com/lookup";

/// Official 30 s preview (AAC) + store page. Apple terms: previews promote the store, so page link shown next to them.
#[derive(Debug, PartialEq)]
pub struct Preview {
    pub audio: String,
    pub page: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LookupHit {
    preview_url: Option<String>,
    track_view_url: Option<String>,
}

/// Apple hosts only: preview bytes and page links come from Apple, never from arbitrary URLs.
pub fn apple_url(url: &str) -> bool {
    Url::parse(url).is_ok_and(|u| u.scheme() == "https" && u.host_str().is_some_and(|h| [".apple.com", ".mzstatic.com"].iter().any(|d| h.ends_with(d))))
}

pub async fn preview(api: &str, id: &str, country: &str) -> Result<Preview> {
    anyhow::ensure!(!id.is_empty() && id.len() <= 20 && id.bytes().all(|b| b.is_ascii_digit()), "Bad Apple Music id");
    let url = Url::parse_with_params(api, &[("id", id), ("country", country)])?;
    let page: serde_json::Value = crate::http().get(url).send().await?.error_for_status()?.json().await?;
    let hit: LookupHit = serde_json::from_value(page["results"][0].clone()).unwrap_or(LookupHit { preview_url: None, track_view_url: None });
    match (hit.preview_url, hit.track_view_url) {
        (Some(audio), Some(page)) if apple_url(&audio) && apple_url(&page) => Ok(Preview { audio, page }),
        _ => anyhow::bail!("No preview for this track in the {country} store"),
    }
}

/// Preview bytes, kept in memory only (never written to disk).
pub async fn preview_audio(p: &Preview) -> Result<Vec<u8>> {
    const MAX: usize = 8 << 20;
    anyhow::ensure!(apple_url(&p.audio), "Not an Apple preview URL");
    let bytes = crate::http().get(&p.audio).send().await?.error_for_status()?.bytes().await?;
    anyhow::ensure!(bytes.len() <= MAX, "Preview too large");
    Ok(bytes.to_vec())
}

/// Songs for `term` in store `country` (ISO 3166, e.g. "FR"). Id = iTunes track id.
pub async fn search(api: &str, term: &str, country: &str) -> Result<Vec<Track>> {
    let url = Url::parse_with_params(api, &[("term", term), ("entity", "song"), ("limit", "15"), ("country", country)])?;
    songs(url).await
}

async fn songs(url: Url) -> Result<Vec<Track>> {
    let page: Page = crate::http().get(url).send().await?.error_for_status()?.json().await?;
    Ok(page
        .results
        .into_iter()
        .filter_map(song)
        .collect())
}

/// Songs by iTunes id, batched (lookup takes a comma list). Ids missing from the store are just absent.
pub async fn lookup(api: &str, ids: &[u64], country: &str) -> Result<Vec<Track>> {
    let mut out = Vec::new();
    for chunk in ids.chunks(150) {
        let list = chunk.iter().map(u64::to_string).collect::<Vec<_>>().join(",");
        out.extend(songs(Url::parse_with_params(api, &[("id", list.as_str()), ("country", country)])?).await?);
    }
    Ok(out)
}

/// An album from the catalog: release year and every song in order (disc, then track number).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Album {
    pub name: String,
    pub artist: String,
    pub year: Option<u16>,
    pub songs: Vec<AlbumSong>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumSong {
    pub disc: u8,
    pub number: u16,
    pub track: Track,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AlbumHit {
    wrapper_type: Option<String>,
    collection_id: Option<u64>,
    collection_name: Option<String>,
    artist_name: Option<String>,
    release_date: Option<String>,
    track_id: Option<u64>,
    track_name: Option<String>,
    track_time_millis: Option<u32>,
    track_number: Option<u16>,
    disc_number: Option<u8>,
    artwork_url100: Option<String>,
}

#[derive(Deserialize)]
struct AlbumPage {
    results: Vec<AlbumHit>,
}

/// Album name without store suffixes: "Cola - Single", "Discovery (Deluxe Edition)" → "cola", "discovery".
fn album_key(name: &str) -> String {
    let base = name.split(" - ").next().unwrap_or(name);
    let base = base.split(" (").next().unwrap_or(base);
    music_core::matching::normalize(base)
}

/// Best catalog album for (artist, album): same name (suffixes aside) and an artist in common.
fn pick_album(hits: &[AlbumHit], artist: &str, album: &str) -> Option<u64> {
    let (want, who) = (album_key(album), music_core::matching::primary_artist(artist));
    let ours = |h: &&AlbumHit| h.artist_name.as_deref().is_some_and(|a| music_core::matching::normalize(a).contains(&who) || who.contains(&music_core::matching::primary_artist(a)));
    let exact = music_core::matching::normalize(album);
    let same = |h: &&AlbumHit| h.collection_name.as_deref().is_some_and(|n| music_core::matching::normalize(n) == exact);
    let named = |h: &&AlbumHit| h.collection_name.as_deref().is_some_and(|n| album_key(n) == want);
    // Exact name first: "Discovery" isn't "Discovery (Live)", unless only that one exists.
    hits.iter().filter(ours).find(same).or_else(|| hits.iter().filter(ours).find(named)).and_then(|h| h.collection_id)
}

/// Year and songs of an album, found by name (search, then one lookup). None = not in the store.
pub async fn album(search_api: &str, lookup_api: &str, artist: &str, album: &str, country: &str) -> Result<Option<Album>> {
    let term = format!("{artist} {album}");
    let url = Url::parse_with_params(search_api, &[("term", term.as_str()), ("entity", "album"), ("limit", "10"), ("country", country)])?;
    let found: AlbumPage = crate::http().get(url).send().await?.error_for_status()?.json().await?;
    let Some(id) = pick_album(&found.results, artist, album) else { return Ok(None) };
    let url = Url::parse_with_params(lookup_api, &[("id", id.to_string().as_str()), ("entity", "song"), ("country", country)])?;
    let page: AlbumPage = crate::http().get(url).send().await?.error_for_status()?.json().await?;
    Ok(album_of(page.results))
}

fn album_of(results: Vec<AlbumHit>) -> Option<Album> {
    let mut it = results.into_iter();
    let head = it.find(|h| h.wrapper_type.as_deref() == Some("collection"))?;
    let art = head.artwork_url100.filter(|u| apple_url(u)).map(|u| u.replace("100x100bb", "600x600bb"));
    let name = head.collection_name?;
    let mut songs: Vec<AlbumSong> = it
        .filter(|h| h.wrapper_type.as_deref() == Some("track"))
        .filter_map(|h| {
            Some(AlbumSong {
                disc: h.disc_number.unwrap_or(1),
                number: h.track_number?,
                track: Track {
                    title: h.track_name?,
                    artist: h.artist_name?,
                    album: Some(name.clone()),
                    duration_ms: h.track_time_millis,
                    isrc: None,
                    ids: BTreeMap::from([(Source::Apple, h.track_id?.to_string())]),
                    art: art.clone(),
                    musicness: Some(Musicness::Music),
                },
            })
        })
        .collect();
    songs.sort_by_key(|s| (s.disc, s.number));
    Some(Album { name, artist: head.artist_name.unwrap_or_default(), year: head.release_date.and_then(|d| d.get(..4)?.parse().ok()), songs })
}

// Apple Music links: an album from the lookup (keyless), a playlist from its public page.

/// Apple Music's public web pages.
pub const PAGE: &str = "https://music.apple.com";

#[derive(Debug, PartialEq)]
pub enum AppleTarget {
    /// `storefront` = the country in the link (/fr/, /jp/): region-only albums are empty in the wrong store.
    Album { storefront: String, id: String },
    Playlist { storefront: String, id: String },
    /// A single song (`/song/…`, or `?i=` inside an album): not an import.
    Song,
}

/// What a pasted text is: a music.apple.com album or playlist link, nothing else (not even another Apple host).
pub fn apple_target(text: &str) -> Option<AppleTarget> {
    let text = text.trim();
    if text.is_empty() || text.len() > 2048 || text.contains(char::is_whitespace) {
        return None;
    }
    let url = Url::parse(text).ok().filter(|u| u.has_host()).or_else(|| Url::parse(&format!("https://{text}")).ok())?;
    if !matches!(url.scheme(), "http" | "https") || url.port().is_some() || !url.username().is_empty() || url.password().is_some() || !url.host_str()?.eq_ignore_ascii_case("music.apple.com") {
        return None;
    }
    let mut segs: Vec<&str> = url.path_segments()?.filter(|s| !s.is_empty()).collect();
    let storefront = match segs.first() {
        Some(s) if s.len() == 2 && s.bytes().all(|b| b.is_ascii_lowercase()) => segs.remove(0).to_string(),
        _ => "us".into(),
    };
    let (what, rest) = segs.split_first()?;
    let id = rest.last()?.to_string();
    let single = url.query_pairs().any(|(k, _)| k == "i");
    match *what {
        "song" => Some(AppleTarget::Song),
        "album" if single => Some(AppleTarget::Song),
        "album" => (id.len() <= 20 && id.bytes().all(|b| b.is_ascii_digit())).then_some(AppleTarget::Album { storefront, id }),
        "playlist" => (id.len() <= 64 && id.starts_with("pl.") && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')).then_some(AppleTarget::Playlist { storefront, id }),
        _ => None,
    }
}

const PAGE_CHANGED: &str = "Apple changed its page: paste the songs as text instead (Add music › Import a list of songs)";

/// The list behind a pasted Apple Music link: `lookup` (the iTunes lookup) for an album, `page` (music.apple.com) for a
/// playlist. Both URLs are ours; the pasted text only gives the store and the id.
pub async fn link_list(page: &str, lookup: &str, text: &str) -> Result<LinkList> {
    match apple_target(text) {
        Some(AppleTarget::Album { storefront, id }) => album_list(lookup, &storefront, &id).await,
        Some(AppleTarget::Playlist { storefront, id }) => {
            // Any slug works: Apple answers with a redirect to the real one.
            let res = crate::http().get(format!("{}/{storefront}/playlist/x/{id}", page.trim_end_matches('/'))).header("user-agent", crate::spotify_embed::UA).send().await?;
            anyhow::ensure!(res.status() != reqwest::StatusCode::NOT_FOUND, "This playlist is private or doesn't exist");
            playlist_page(&res.error_for_status()?.text().await?)
        }
        Some(AppleTarget::Song) => anyhow::bail!("That link is a single song: paste a playlist or album link"),
        None => anyhow::bail!("Not an Apple Music playlist or album link"),
    }
}

fn song(h: Hit) -> Option<Track> {
    Some(Track {
        title: h.track_name?,
        artist: h.artist_name?,
        album: h.collection_name,
        duration_ms: h.track_time_millis,
        isrc: None,
        ids: BTreeMap::from([(Source::Apple, h.track_id?.to_string())]),
        // 100 px by default; the CDN serves any size.
        art: h.artwork_url100.filter(|u| apple_url(u)).map(|u| u.replace("100x100bb", "600x600bb")),
        // Music catalog.
        musicness: Some(Musicness::Music),
    })
}

async fn album_list(lookup: &str, storefront: &str, id: &str) -> Result<LinkList> {
    let url = Url::parse_with_params(lookup, &[("id", id), ("entity", "song"), ("country", storefront), ("limit", "200")])?;
    let page: serde_json::Value = crate::http().get(url).send().await?.error_for_status()?.json().await?;
    let results = page["results"].as_array().map_or(&[][..], Vec::as_slice);
    let head = results.iter().find(|r| r["wrapperType"] == "collection");
    let name = head.and_then(|h| h["collectionName"].as_str()).context("This album was removed, or isn't available in its store")?.to_string();
    let hits = results.iter().filter(|r| r["wrapperType"] == "track" && r["kind"] == "song");
    let tracks: Vec<Track> = hits.filter_map(|r| song(serde_json::from_value(r.clone()).ok()?)).take(MAX_TRACKS).collect();
    anyhow::ensure!(!tracks.is_empty(), "This album was removed, or isn't available in its store");
    let cover = head.and_then(|h| h["artworkUrl100"].as_str()).filter(|u| apple_url(u)).map(|u| u.replace("100x100bb", "600x600bb"));
    // The lookup lists every song; its trackCount also counts music videos.
    let total = tracks.len();
    Ok(LinkList { kind: "album", name, cover, tracks, total })
}

static SERVER_DATA: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?s)<script[^>]*\bid="serialized-server-data"[^>]*>(.*?)</script>"#).unwrap());

/// The first `sections` list in the page data, wherever it sits.
fn sections(v: &serde_json::Value) -> Option<&Vec<serde_json::Value>> {
    match v {
        serde_json::Value::Object(m) => m.get("sections").and_then(|s| s.as_array()).or_else(|| m.values().find_map(sections)),
        serde_json::Value::Array(a) => a.iter().find_map(sections),
        _ => None,
    }
}

/// Artwork template ("…/{w}x{h}bb.{f}") → a 600 px jpg, Apple hosts only.
fn art_of(a: &serde_json::Value) -> Option<String> {
    let url = a.pointer("/dictionary/url")?.as_str()?;
    apple_url(url).then(|| url.replace("{w}", "600").replace("{h}", "600").replace("{f}", "jpg"))
}

/// Apple's public playlist page: the JSON in `serialized-server-data` (unofficial, it may change; every field but the
/// song's title and artist is optional). Editorial (`pl.<hex>`) and users' (`pl.u-…`) playlists share the layout.
pub fn playlist_page(html: &str) -> Result<LinkList> {
    let changed = || anyhow::anyhow!(PAGE_CHANGED);
    let json = SERVER_DATA.captures(html).ok_or_else(changed)?;
    let data: serde_json::Value = serde_json::from_str(&json[1]).map_err(|_| changed())?;
    let sections = sections(&data).ok_or_else(changed)?;
    let of = |kind: &str| sections.iter().find(|s| s["itemKind"] == kind);
    let list = of("trackLockup").ok_or_else(changed)?;
    let head = of("containerDetailHeaderLockup").and_then(|s| s["items"].get(0));
    let tracks: Vec<Track> = list["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|t| {
            Some(Track {
                title: t["title"].as_str().filter(|s| !s.is_empty())?.to_string(),
                artist: t["artistName"].as_str().filter(|s| !s.is_empty())?.to_string(),
                album: t.pointer("/tertiaryLinks/0/title").and_then(|a| a.as_str()).map(String::from),
                duration_ms: t["duration"].as_u64().filter(|d| *d > 0).map(|d| d as u32),
                isrc: None,
                ids: t.pointer("/contentDescriptor/identifiers/storeAdamID").and_then(|i| i.as_str()).filter(|i| i.bytes().all(|b| b.is_ascii_digit())).map(|i| BTreeMap::from([(Source::Apple, i.to_string())])).unwrap_or_default(),
                art: t.get("artwork").and_then(art_of),
                musicness: Some(Musicness::Music),
            })
        })
        .take(MAX_TRACKS)
        .collect();
    anyhow::ensure!(!tracks.is_empty(), "This playlist has no songs");
    let title = |t: &str| t.trim().trim_end_matches("- Apple Music").trim().trim_end_matches("- Playlist").trim().to_string();
    let name = head.and_then(|h| h["title"].as_str()).map(str::to_string).or_else(|| data.pointer("/data/0/data/seoData/pageTitle").and_then(|t| t.as_str()).map(title)).filter(|n| !n.is_empty()).unwrap_or_else(|| "Apple Music playlist".into());
    let cover = head.and_then(|h| h.get("artwork")).and_then(art_of).or_else(|| tracks.iter().find_map(|t| t.art.clone()));
    let total = head.and_then(|h| h["trackCount"].as_u64()).map_or(tracks.len(), |n| n as usize).max(tracks.len());
    Ok(LinkList { kind: "playlist", name, cover, tracks, total })
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::{Matcher, Server};

    #[tokio::test]
    async fn maps_songs_and_skips_incomplete_hits() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/search")
            .match_query(Matcher::AllOf(vec![Matcher::UrlEncoded("term".into(), "get lucky".into()), Matcher::UrlEncoded("country".into(), "FR".into())]))
            .with_body(r#"{"resultCount":2,"results":[{"trackId":617154366,"trackName":"Get Lucky","artistName":"Daft Punk","collectionName":"Random Access Memories","trackTimeMillis":369629,"artworkUrl100":"https://is1-ssl.mzstatic.com/image/thumb/a/100x100bb.jpg"},{"trackName":"No id"}]}"#)
            .create_async()
            .await;
        let found = search(&format!("{}/search", s.url()), "get lucky", "FR").await.unwrap();
        assert_eq!(found.len(), 1);
        let t = &found[0];
        assert_eq!((t.title.as_str(), t.artist.as_str(), t.duration_ms), ("Get Lucky", "Daft Punk", Some(369_629)));
        assert_eq!(t.ids[&Source::Apple], "617154366");
        assert_eq!(t.art.as_deref(), Some("https://is1-ssl.mzstatic.com/image/thumb/a/600x600bb.jpg"));
    }

    #[tokio::test]
    async fn looks_up_ids_in_one_call() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/lookup")
            .match_query(Matcher::UrlEncoded("id".into(), "617154366,1".into()))
            .with_body(r#"{"results":[{"trackId":617154366,"trackName":"Get Lucky","artistName":"Daft Punk"}]}"#)
            .expect(1)
            .create_async()
            .await;
        let found = lookup(&format!("{}/lookup", s.url()), &[617_154_366, 1], "US").await.unwrap();
        assert_eq!(found.iter().map(|t| t.ids[&Source::Apple].as_str()).collect::<Vec<_>>(), ["617154366"]);
    }

    #[tokio::test]
    async fn finds_an_album_with_year_and_numbered_songs() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/search")
            .match_query(Matcher::UrlEncoded("entity".into(), "album".into()))
            .with_body(r#"{"results":[{"collectionId":1,"collectionName":"Discovery (Live)","artistName":"Daft Punk"},{"collectionId":2,"collectionName":"Discovery","artistName":"Other"},{"collectionId":3,"collectionName":"Discovery","artistName":"Daft Punk"}]}"#)
            .create_async()
            .await;
        s.mock("GET", "/lookup")
            .match_query(Matcher::AllOf(vec![Matcher::UrlEncoded("id".into(), "3".into()), Matcher::UrlEncoded("entity".into(), "song".into())]))
            .with_body(r#"{"results":[{"wrapperType":"collection","collectionId":3,"collectionName":"Discovery","artistName":"Daft Punk","releaseDate":"2001-03-12T08:00:00Z","artworkUrl100":"https://is1-ssl.mzstatic.com/a/100x100bb.jpg"},{"wrapperType":"track","trackId":12,"trackName":"Aerodynamic","artistName":"Daft Punk","trackNumber":2,"discNumber":1,"trackTimeMillis":212000},{"wrapperType":"track","trackId":11,"trackName":"One More Time","artistName":"Daft Punk","trackNumber":1,"discNumber":1}]}"#)
            .create_async()
            .await;
        let a = album(&format!("{}/search", s.url()), &format!("{}/lookup", s.url()), "Daft Punk", "Discovery", "FR").await.unwrap().unwrap();
        assert_eq!((a.name.as_str(), a.year), ("Discovery", Some(2001)));
        assert_eq!(a.songs.iter().map(|s| (s.number, s.track.title.as_str())).collect::<Vec<_>>(), [(1, "One More Time"), (2, "Aerodynamic")]);
        assert_eq!(a.songs[0].track.art.as_deref(), Some("https://is1-ssl.mzstatic.com/a/600x600bb.jpg"));
        assert!(album(&format!("{}/search", s.url()), &format!("{}/lookup", s.url()), "Daft Punk", "Homework", "FR").await.unwrap().is_none());
    }

    /// The smoke test's mock (e2e/mock.mjs) answers with this file: it has to read the way the client expects.
    #[tokio::test]
    async fn smoke_test_fixture_reads() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/search").match_query(Matcher::Any).with_body(include_str!("../../../e2e/fixtures/itunes-search.json")).create_async().await;
        let found = search(&format!("{}/search", s.url()), "paper lanterns", "US").await.unwrap();
        assert_eq!(found.iter().map(|t| (t.title.as_str(), t.artist.as_str(), t.duration_ms)).collect::<Vec<_>>(), [("Paper Lanterns", "Glass Harbour", Some(201_000)), ("Night Bus", "Moss and Stone", Some(178_000))]);
    }

    #[tokio::test]
    async fn preview_needs_apple_hosts() {
        let mut s = Server::new_async().await;
        let body = |audio: &str| format!(r#"{{"results":[{{"previewUrl":"{audio}","trackViewUrl":"https://music.apple.com/fr/album/x/1?i=617154366"}}]}}"#);
        s.mock("GET", "/lookup").match_query(Matcher::UrlEncoded("id".into(), "1".into())).with_body(body("https://audio-ssl.itunes.apple.com/a.m4a")).create_async().await;
        s.mock("GET", "/lookup").match_query(Matcher::UrlEncoded("id".into(), "2".into())).with_body(body("https://evil.example/a.m4a")).create_async().await;
        s.mock("GET", "/lookup").match_query(Matcher::UrlEncoded("id".into(), "3".into())).with_body(r#"{"results":[]}"#).create_async().await;
        let api = format!("{}/lookup", s.url());
        assert_eq!(preview(&api, "1", "FR").await.unwrap().audio, "https://audio-ssl.itunes.apple.com/a.m4a");
        assert!(preview(&api, "2", "FR").await.is_err());
        assert!(preview(&api, "3", "FR").await.is_err());
        assert!(preview(&api, "1&x=y", "FR").await.is_err());
        assert!(!apple_url("http://music.apple.com/x") && !apple_url("https://apple.com.evil.example/x"));
    }

    // Fixtures recorded by hand on 2026-10-31 (public pages and the keyless lookup), cut down to what the parsers read:
    // Today's Hits (editorial, `pl.<hex>`), a user's public playlist (`pl.u-…`, renamed, no cover) and an album in the
    // French store.
    const EDITORIAL: &str = include_str!("../../../e2e/fixtures/apple-playlist-editorial.html");
    const PUBLIC: &str = include_str!("../../../e2e/fixtures/apple-playlist-public.html");
    const ALBUM_LOOKUP: &str = include_str!("../../../e2e/fixtures/itunes-lookup-album.json");

    #[test]
    fn reads_apple_music_links_only() {
        let album = |sf: &str, id: &str| Some(AppleTarget::Album { storefront: sf.into(), id: id.into() });
        let list = |sf: &str, id: &str| Some(AppleTarget::Playlist { storefront: sf.into(), id: id.into() });
        for (link, want) in [
            ("https://music.apple.com/fr/album/in-between-dreams/1440857781", album("fr", "1440857781")),
            ("https://music.apple.com/jp/album/1440857781", album("jp", "1440857781")),
            ("https://music.apple.com/album/in-between-dreams/1440857781", album("us", "1440857781")),
            ("music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb", list("us", "pl.f4d106fed2bd41149aaacabb233eb5eb")),
            ("https://music.apple.com/fr/playlist/a/pl.u-vxy6DBMtLY0gB?l=en", list("fr", "pl.u-vxy6DBMtLY0gB")),
            ("https://music.apple.com/us/album/better-together/1440857781?i=1440857786", Some(AppleTarget::Song)),
            ("https://music.apple.com/us/song/better-together/1440857786", Some(AppleTarget::Song)),
        ] {
            assert_eq!(apple_target(link), want, "{link}");
        }
        for bad in [
            "",
            "daft punk",
            "https://music.apple.com/us/artist/jack-johnson/909253",
            "https://music.apple.com/us/album/x/notanumber",
            "https://music.apple.com/us/playlist/x/12345",
            "https://itunes.apple.com/us/album/x/1440857781",
            "https://music.apple.com.evil.example/us/album/x/1440857781",
            "https://evil.example/music.apple.com/us/album/x/1440857781",
            "https://music.apple.com@evil.example/us/album/x/1",
            "https://music.apple.com:8080/us/album/x/1",
            "https://music.apple.com/us/album/x/1 and more",
        ] {
            assert_eq!(apple_target(bad), None, "{bad}");
        }
    }

    #[test]
    fn reads_an_editorial_playlist_page() {
        let l = playlist_page(EDITORIAL).unwrap();
        assert_eq!((l.kind, l.name.as_str(), l.tracks.len(), l.total), ("playlist", "Today’s Hits", 3, 50));
        let t = &l.tracks[0];
        assert_eq!((t.title.as_str(), t.artist.as_str(), t.album.as_deref(), t.duration_ms, t.ids[&Source::Apple].as_str()), ("Solar Eclipse", "Drake & Don Toliver", Some("HABIBTI (FOMO)"), Some(218_389), "6818209989"));
        assert!(t.art.as_deref().unwrap().ends_with("/600x600bb.jpg") && apple_url(t.art.as_deref().unwrap()));
        assert!(l.cover.as_deref().unwrap().ends_with("/600x600bb.png") || l.cover.as_deref().unwrap().ends_with("/600x600bb.jpg"));
    }

    #[test]
    fn reads_a_users_playlist_page_without_a_cover() {
        let l = playlist_page(PUBLIC).unwrap();
        assert_eq!((l.name.as_str(), l.tracks.len(), l.total), ("A public playlist", 3, 86));
        assert_eq!((l.tracks[0].title.as_str(), l.tracks[0].artist.as_str()), ("Sugar Mountain", "Neil Young"));
        // No cover on the header: the first song's.
        assert_eq!(l.cover, l.tracks[0].art);
    }

    #[test]
    fn a_changed_page_is_said_in_plain_words() {
        let said = |html: &str| playlist_page(html).unwrap_err().to_string();
        let wrap = |json: &str| format!(r#"<script type="application/json" id="serialized-server-data">{json}</script>"#);
        for html in ["<html>nothing</html>".to_string(), wrap("not json"), wrap(r#"{"data":[]}"#), wrap(r#"{"sections":[{"itemKind":"other","items":[]}]}"#)] {
            assert_eq!(said(&html), PAGE_CHANGED, "{html}");
        }
        // The layout is there but empty; a song without an artist is skipped, the rest of the fields may be missing.
        assert_eq!(said(&wrap(r#"{"sections":[{"itemKind":"trackLockup","items":[{"title":"No artist"}]}]}"#)), "This playlist has no songs");
        let l = playlist_page(&wrap(r#"{"sections":[{"itemKind":"trackLockup","items":[{"title":"A","artistName":"B"}]}]}"#)).unwrap();
        assert_eq!((l.name.as_str(), l.tracks.len(), l.total, l.tracks[0].duration_ms, l.cover), ("Apple Music playlist", 1, 1, None, None));
        // Artwork from another host is dropped.
        let l = playlist_page(&wrap(r#"{"sections":[{"itemKind":"trackLockup","items":[{"title":"A","artistName":"B","artwork":{"dictionary":{"url":"https://evil.example/{w}x{h}bb.{f}"}}}]}]}"#)).unwrap();
        assert_eq!(l.tracks[0].art, None);
    }

    #[tokio::test]
    async fn imports_a_playlist_by_link_and_says_why_not() {
        let mut s = Server::new_async().await;
        // The store in the link goes into the page's path; the slug is ours (Apple redirects to the real one).
        s.mock("GET", "/fr/playlist/x/pl.u-vxy6DBMtLY0gB").with_body(PUBLIC).create_async().await;
        s.mock("GET", "/us/playlist/x/pl.u-gone").with_status(404).create_async().await;
        s.mock("GET", "/us/playlist/x/pl.u-odd").with_body("<html>a new page</html>").create_async().await;
        let (page, lookup) = (s.url(), format!("{}/lookup", s.url()));
        let l = link_list(&page, &lookup, "https://music.apple.com/fr/playlist/mes-favoris/pl.u-vxy6DBMtLY0gB").await.unwrap();
        assert_eq!((l.name.as_str(), l.tracks.len()), ("A public playlist", 3));
        let said = |link: &str| {
            let (page, lookup, link) = (page.clone(), lookup.clone(), link.to_string());
            async move { link_list(&page, &lookup, &link).await.unwrap_err().to_string() }
        };
        assert_eq!(said("https://music.apple.com/us/playlist/x/pl.u-gone").await, "This playlist is private or doesn't exist");
        assert_eq!(said("https://music.apple.com/us/playlist/x/pl.u-odd").await, PAGE_CHANGED);
        assert_eq!(said("https://music.apple.com/us/album/x/1?i=2").await, "That link is a single song: paste a playlist or album link");
        assert_eq!(said("https://example.com/us/album/x/1").await, "Not an Apple Music playlist or album link");
    }

    #[tokio::test]
    async fn imports_an_album_from_its_own_store() {
        let mut s = Server::new_async().await;
        // fr store: the lookup is asked with the link's country, or region-only albums come back empty.
        s.mock("GET", "/lookup").match_query(Matcher::AllOf(vec![Matcher::UrlEncoded("id".into(), "1440857781".into()), Matcher::UrlEncoded("entity".into(), "song".into()), Matcher::UrlEncoded("country".into(), "fr".into())])).with_body(ALBUM_LOOKUP).create_async().await;
        s.mock("GET", "/lookup").match_query(Matcher::UrlEncoded("id".into(), "7".into())).with_body(r#"{"resultCount":0,"results":[]}"#).create_async().await;
        let lookup = format!("{}/lookup", s.url());
        let l = link_list(&s.url(), &lookup, "https://music.apple.com/fr/album/in-between-dreams/1440857781").await.unwrap();
        assert_eq!((l.kind, l.name.as_str(), l.tracks.len(), l.total), ("album", "In Between Dreams (Bonus Track Version)", 2, 2));
        let t = &l.tracks[0];
        assert_eq!((t.title.as_str(), t.artist.as_str(), t.duration_ms, t.ids[&Source::Apple].as_str(), t.isrc.as_deref()), ("Better Together", "Jack Johnson", Some(207_679), "1440857786", None));
        assert!(l.cover.as_deref().unwrap().ends_with("/600x600bb.jpg"));
        let e = link_list(&s.url(), &lookup, "https://music.apple.com/us/album/x/7").await.unwrap_err().to_string();
        assert_eq!(e, "This album was removed, or isn't available in its store");
    }
}
