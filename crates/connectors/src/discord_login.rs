//! Optional sign-in with Discord (Settings › Accounts, off by default): OAuth 2 code + PKCE, no client secret, the
//! `identify` scope only (no e-mail, no servers). It gives a name shown beside the playlists the user shares; nothing
//! else is asked of Discord. Tokens live in the keychain (`OAuthClient`), the profile is a plain library setting.
use crate::oauth::{OAuthClient, OAuthConfig, Opener};
use anyhow::{Result, bail};
use music_core::model::SecretStore;
use music_core::share::{DiscordCard, Profile};
use reqwest::Method;
use serde::Deserialize;
use std::sync::Arc;

/// Legato's Discord application (a public client id, not a secret).
pub const CLIENT_ID: &str = "1570179684937900052";
/// The sign-in comes back to `REDIRECT`, registered whole in the Discord developer portal (Discord matches it exactly).
pub const PORT: u16 = 47_819;
pub const REDIRECT: &str = "http://127.0.0.1:47819/callback";

pub struct DiscordLogin {
    oauth: OAuthClient,
    api: String,
    port: u16,
}

#[derive(Deserialize)]
struct Me {
    id: String,
    username: String,
    global_name: Option<String>,
    avatar: Option<String>,
    banner: Option<String>,
    accent_color: Option<u32>,
}

/// Discord's image host: the only one the card's pictures come from (`art.rs` lets the same host through).
const CDN: &str = "https://cdn.discordapp.com";

/// An image address from an id and a hash: Discord's hashes are lowercase hex, `a_` before an animated one (the still
/// PNG is asked for). Anything else is no picture. Trust boundary.
fn image(kind: &str, id: &str, hash: Option<String>, size: u32) -> Option<String> {
    let hex = |h: &str| (1..=64).contains(&h.len()) && h.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
    let hash = hash.filter(|h| hex(h.strip_prefix("a_").unwrap_or(h)))?;
    Some(format!("{CDN}/{kind}/{id}/{hash}.png?size={size}"))
}

impl DiscordLogin {
    pub fn new(store: Arc<dyn SecretStore>, open: Opener) -> Self {
        Self::with_urls(CLIENT_ID, store, open, "https://discord.com/api", "https://discord.com", PORT)
    }

    pub fn with_urls(client_id: &str, store: Arc<dyn SecretStore>, open: Opener, api: &str, site: &str, port: u16) -> Self {
        let cfg = OAuthConfig {
            key: "discord-login",
            auth_url: format!("{site}/oauth2/authorize"),
            token_url: format!("{api}/oauth2/token"),
            client_id: client_id.into(),
            client_secret: None,
            scope: "identify",
            extra_auth_params: &[("prompt", "consent")],
        };
        Self { oauth: OAuthClient::new(cfg, store, open), api: api.into(), port }
    }

    pub fn is_connected(&self) -> bool {
        self.oauth.is_connected()
    }

    pub fn disconnect(&self) -> Result<()> {
        self.oauth.disconnect()
    }

    /// The browser opens Discord's page; the user allows; the profile comes back (5 minutes to answer).
    pub async fn connect(&self) -> Result<(Profile, DiscordCard)> {
        self.oauth.connect_on(self.port).await?;
        self.identity().await
    }

    /// Who the signed-in account is. Trust boundary: Discord's answer is checked like any other input.
    pub async fn profile(&self) -> Result<Profile> {
        Ok(self.identity().await?.0)
    }

    /// The profile and the card, from one `users/@me`.
    pub async fn identity(&self) -> Result<(Profile, DiscordCard)> {
        let me: Me = self.oauth.json(Method::GET, &format!("{}/users/@me", self.api), None).await?;
        let name: String = me.global_name.filter(|n| !n.trim().is_empty()).unwrap_or(me.username).trim().chars().take(32).collect();
        let p = Profile { id: me.id, name };
        if !p.valid() {
            bail!("Discord sent a profile Legato cannot read");
        }
        let card = DiscordCard {
            name: p.name.clone(),
            avatar: image("avatars", &p.id, me.avatar, 256),
            banner: image("banners", &p.id, me.banner, 600),
            accent: me.accent_color.filter(|c| *c <= 0xFF_FFFF),
        };
        Ok((p, card))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::Matcher;
    use music_core::model::MemoryStore;
    use serde_json::json;
    use std::collections::HashMap;
    use std::sync::Mutex;
    use url::Url;

    type Seen = Arc<Mutex<Option<HashMap<String, String>>>>;

    /// A fake browser: the user allows (or refuses) and Discord redirects to the loopback address it was given.
    fn opener(code: Option<&'static str>, seen: Seen) -> Opener {
        Arc::new(move |url| {
            let q: HashMap<String, String> = Url::parse(url)?.query_pairs().into_owned().collect();
            let mut back = Url::parse(&q["redirect_uri"])?;
            match code {
                Some(c) => back.query_pairs_mut().append_pair("code", c).append_pair("state", &q["state"]),
                None => back.query_pairs_mut().append_pair("error", "access_denied"),
            };
            *seen.lock().unwrap() = Some(q);
            tokio::spawn(crate::http().get(back.to_string()).send());
            Ok(())
        })
    }

    #[tokio::test]
    async fn signs_in_with_pkce_and_no_secret_and_reads_the_profile() {
        let mut server = mockito::Server::new_async().await;
        let token = server
            .mock("POST", "/oauth2/token")
            .match_body(Matcher::AllOf(vec![
                Matcher::UrlEncoded("grant_type".into(), "authorization_code".into()),
                Matcher::UrlEncoded("code".into(), "CODE".into()),
                Matcher::UrlEncoded("client_id".into(), "CID".into()),
                Matcher::Regex("code_verifier=[\\w-]{43}".into()),
            ]))
            .match_request(|r| !r.utf8_lossy_body().unwrap_or_default().contains("client_secret"))
            .with_body(r#"{"access_token":"AT","refresh_token":"RT","expires_in":604800}"#)
            .create_async()
            .await;
        let me = server
            .mock("GET", "/users/@me")
            .match_header("authorization", "Bearer AT")
            .with_body(r#"{"id":"80351110224678912","username":"nelly","global_name":"Nelly","email":"never@read.me"}"#)
            .create_async()
            .await;
        let store: Arc<dyn SecretStore> = Arc::new(MemoryStore::default());
        let seen: Seen = Default::default();
        let login = DiscordLogin::with_urls("CID", store, opener(Some("CODE"), seen.clone()), &server.url(), &server.url(), 0);
        let (p, card) = login.connect().await.unwrap();
        assert_eq!(card, DiscordCard { name: "Nelly".into(), avatar: None, banner: None, accent: None });
        assert_eq!(p, Profile { id: "80351110224678912".into(), name: "Nelly".into() });
        token.assert_async().await;
        me.assert_async().await;
        let q = seen.lock().unwrap().clone().unwrap();
        assert_eq!((q["scope"].as_str(), q["code_challenge_method"].as_str(), q["response_type"].as_str()), ("identify", "S256", "code"));
        assert!(login.is_connected());
        login.disconnect().unwrap();
        assert!(!login.is_connected());
    }

    #[tokio::test]
    async fn a_refusal_signs_nobody_in() {
        let server = mockito::Server::new_async().await;
        let store: Arc<dyn SecretStore> = Arc::new(MemoryStore::default());
        let login = DiscordLogin::with_urls("CID", store, opener(None, Default::default()), &server.url(), &server.url(), 0);
        let err = login.connect().await.unwrap_err();
        assert!(err.to_string().contains("access_denied"));
        assert!(!login.is_connected());
    }

    #[tokio::test]
    async fn refreshes_an_expired_token_before_asking_who_it_is() {
        let mut server = mockito::Server::new_async().await;
        let refresh = server
            .mock("POST", "/oauth2/token")
            .match_body(Matcher::AllOf(vec![Matcher::UrlEncoded("grant_type".into(), "refresh_token".into()), Matcher::UrlEncoded("refresh_token".into(), "RT".into())]))
            .with_body(r#"{"access_token":"NEW","refresh_token":"RT2","expires_in":604800}"#)
            .create_async()
            .await;
        server.mock("GET", "/users/@me").match_header("authorization", "Bearer NEW").with_body(r#"{"id":"1","username":"nelly","global_name":null}"#).create_async().await;
        let store: Arc<dyn SecretStore> = Arc::new(MemoryStore::with("discord-login", json!({ "accessToken": "OLD", "refreshToken": "RT", "expiresAt": 0 })));
        let login = DiscordLogin::with_urls("CID", store, crate::oauth::tests::no_open(), &server.url(), &server.url(), 0);
        assert_eq!(login.profile().await.unwrap().name, "nelly");
        refresh.assert_async().await;
    }

    #[tokio::test]
    async fn a_profile_that_is_not_one_is_refused() {
        let mut server = mockito::Server::new_async().await;
        server.mock("GET", "/users/@me").with_body(r#"{"id":"../x","username":"nelly"}"#).create_async().await;
        let login = DiscordLogin::with_urls("CID", crate::oauth::tests::valid_store("discord-login"), crate::oauth::tests::no_open(), &server.url(), &server.url(), 0);
        assert!(login.profile().await.is_err());
    }

    #[tokio::test]
    async fn the_card_carries_the_avatar_banner_and_accent_and_nothing_a_picture_cannot_be() {
        let mut server = mockito::Server::new_async().await;
        server
            .mock("GET", "/users/@me")
            .with_body(r#"{"id":"80351110224678912","username":"nelly","global_name":"Nelly","avatar":"a_8342729096ea3675442027381ff50dfe","banner":"../x/evil","accent_color":3447003,"email":"never@read.me"}"#)
            .create_async()
            .await;
        let login = DiscordLogin::with_urls("CID", crate::oauth::tests::valid_store("discord-login"), crate::oauth::tests::no_open(), &server.url(), &server.url(), 0);
        let (_, card) = login.identity().await.unwrap();
        assert_eq!(card.avatar.as_deref(), Some("https://cdn.discordapp.com/avatars/80351110224678912/a_8342729096ea3675442027381ff50dfe.png?size=256"));
        assert_eq!(card.banner, None);
        assert_eq!(card.accent, Some(3_447_003));
        assert!(!format!("{card:?}").contains("never@read.me"));
        for bad in ["../x", "ABC", "a_", "x_1", "1f/2", "a_a_1", "%2e%2e"] {
            assert_eq!(image("avatars", "1", Some(bad.into()), 64), None, "{bad}");
        }
        assert!(image("banners", "1", Some("0abf".into()), 64).is_some());
    }
}
