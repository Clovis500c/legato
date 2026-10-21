//! Third-party plugins: local folders with a `plugin.json` and one script. Each runs isolated in its own QuickJS
//! runtime (no DOM, no network, no files), reaching the app only through `app` calls that the user's approved
//! permissions allow. Network goes through a gateway that keeps to approved hosts. Docs: docs/plugins.md.

pub mod manifest;
pub mod net;
pub mod perms;
pub mod runtime;

pub use manifest::{API, Manifest};
pub use perms::{Permission, Route};
pub use runtime::{Call, Outbox, Running};
