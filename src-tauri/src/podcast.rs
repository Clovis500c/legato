//! Podcasts (the Podcasts page, Settings › Playback › Podcasts): shows from the open RSS feed addresses the user types, kept
//! on this PC (library settings, `podcastShows`). Only a feed the user typed or kept is asked for; an episode's audio plays
//! through the engine like a server song (`server:podcast:<audio address>`, `Fetch` in servers.rs).

use crate::{AppState, CmdResult, err};
use music_connectors::podcast::Feed;
use tauri::State;

const KEY: &str = "podcastShows";
const MAX_KEPT: usize = 100;

fn kept(state: &AppState) -> Vec<Feed> {
    state.lib().setting(KEY).ok().flatten().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
}

fn icons(shows: &[Feed]) {
    music_connectors::art::allow_favicons(shows.iter().map(|s| s.image.as_str()));
}

/// A show's page: the feed read now.
#[tauri::command]
pub async fn podcast_feed(url: String) -> CmdResult<Feed> {
    let feed = music_connectors::podcast::fetch(&url).await.map_err(err)?;
    icons(std::slice::from_ref(&feed));
    Ok(feed)
}

#[tauri::command]
pub async fn podcast_kept(state: State<'_, AppState>) -> CmdResult<Vec<Feed>> {
    let all = kept(&state);
    icons(&all);
    Ok(all)
}

/// Trust boundary: a kept show is its address and its looks, never episodes (they are asked again).
fn clean(f: Feed) -> Option<Feed> {
    let ok = f.url.len() <= 2_000 && (f.url.starts_with("https://") || f.url.starts_with("http://")) && !f.url.chars().any(char::is_control);
    let title = f.title.trim().chars().take(300).collect::<String>();
    (ok && !title.is_empty()).then(|| Feed { title, author: f.author.chars().take(200).collect(), image: Some(f.image).filter(|i| music_connectors::art::favicon_ok(i)).unwrap_or_default(), episodes: Vec::new(), ..f })
}

#[tauri::command]
pub async fn podcast_keep(state: State<'_, AppState>, show: Feed, keep: bool) -> CmdResult<Vec<Feed>> {
    let mut all = kept(&state);
    all.retain(|s| s.url != show.url);
    if keep {
        let s = clean(show).ok_or("Not a podcast feed")?;
        if all.len() >= MAX_KEPT {
            return Err("You keep 100 podcasts already".into());
        }
        all.insert(0, s);
    }
    state.lib().set_setting(KEY, &serde_json::to_value(&all).map_err(err)?).map_err(err)?;
    Ok(all)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(url: &str, title: &str) -> Feed {
        Feed { url: url.into(), title: title.into(), author: "a".repeat(500), image: "http://192.168.1.2/x.jpg".into(), episodes: vec![music_connectors::podcast::Episode { id: "1".into(), title: "t".into(), url: "https://x/1.mp3".into(), duration_ms: None, published: String::new() }] }
    }

    #[test]
    fn a_kept_show_is_an_http_address_with_bounded_text_and_no_episodes() {
        let f = clean(feed("https://x.example/rss", " Show ")).unwrap();
        assert_eq!((f.title.as_str(), f.author.len(), f.image.as_str(), f.episodes.len()), ("Show", 200, "", 0));
        assert!(clean(feed("file:///C:/x", "Show")).is_none());
        assert!(clean(feed("https://x.example/a\nb", "Show")).is_none());
        assert!(clean(feed("https://x.example/rss", "  ")).is_none());
    }
}
