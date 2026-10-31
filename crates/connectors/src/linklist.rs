//! What a pasted Deezer or Apple Music link gives back: a name, a cover and a track list. Metadata only; the shell
//! finds each song on YouTube like it does for a Spotify link.

use music_core::model::Track;

#[derive(Debug, PartialEq)]
pub struct LinkList {
    /// "playlist" or "album".
    pub kind: &'static str,
    pub name: String,
    pub cover: Option<String>,
    pub tracks: Vec<Track>,
    /// Songs the service says the list has (more than `tracks` when its page showed only the first ones).
    pub total: usize,
}

/// Most songs one link brings in (a list is matched song by song).
pub const MAX_TRACKS: usize = 3000;

/// A link's requests stop here, body included: a server that stalls must not hold an import for ever.
pub const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

/// Longest page read (Apple's playlist pages are about 1 MB).
const MAX_PAGE: usize = 8 << 20;

/// The body as text, refused past `MAX_PAGE`.
pub async fn capped_text(mut res: reqwest::Response) -> anyhow::Result<String> {
    anyhow::ensure!(res.content_length().is_none_or(|n| n <= MAX_PAGE as u64), "That page is too large");
    let mut body = Vec::new();
    while let Some(chunk) = res.chunk().await? {
        anyhow::ensure!(body.len() + chunk.len() <= MAX_PAGE, "That page is too large");
        body.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&body).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_page_past_the_cap_is_refused() {
        let mut s = mockito::Server::new_async().await;
        s.mock("GET", "/ok").with_body("hello").create_async().await;
        s.mock("GET", "/big").with_body(vec![b'a'; MAX_PAGE + 1]).create_async().await;
        let get = |p: &str| reqwest::get(format!("{}{p}", s.url()));
        assert_eq!(capped_text(get("/ok").await.unwrap()).await.unwrap(), "hello");
        assert!(capped_text(get("/big").await.unwrap()).await.is_err());
    }
}
