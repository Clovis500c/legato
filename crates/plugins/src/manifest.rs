//! `plugin.json`: who made the plugin, what it needs. Checked before anything runs; the user approves the
//! permissions at install (and again when an update asks for more).

use crate::perms::Permission;
use anyhow::{Result, bail, ensure};
use serde::{Deserialize, Serialize};

/// Plugin API this app offers. A plugin asks for one; newer ones are refused ("update the app").
pub const API: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "PluginManifest")]
pub struct Manifest {
    /// Reverse domain or simple name: `com.example.sleep-timer`.
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    #[serde(default)]
    pub description: String,
    /// Plugin API version it was written for.
    pub api: u32,
    /// Script file, next to plugin.json.
    #[serde(default = "main_default")]
    pub main: String,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
}

fn main_default() -> String {
    "main.js".into()
}

fn id_ok(id: &str) -> bool {
    (3..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-') && !id.starts_with(['.', '-']) && !id.contains("..")
}

impl Manifest {
    /// Parsed and checked: fields in bounds, known permissions, main file a plain name.
    pub fn parse(json: &str) -> Result<Self> {
        let m: Manifest = serde_json::from_str(json).map_err(|e| anyhow::anyhow!("plugin.json: {e}"))?;
        ensure!(id_ok(&m.id), "plugin.json: id must be 3-64 characters: a-z, 0-9, dots and dashes");
        ensure!(!m.name.trim().is_empty() && m.name.chars().count() <= 60, "plugin.json: name must be 1-60 characters");
        ensure!(!m.author.trim().is_empty() && m.author.chars().count() <= 60, "plugin.json: author must be 1-60 characters");
        ensure!(!m.version.is_empty() && m.version.len() <= 20, "plugin.json: version must be 1-20 characters");
        ensure!(m.description.chars().count() <= 300, "plugin.json: description is over 300 characters");
        ensure!(m.api >= 1, "plugin.json: api must be 1 or more");
        if m.api > API {
            bail!("This plugin needs a newer version of Legato (plugin API {}, this app has {API})", m.api);
        }
        ensure!(m.main.ends_with(".js") && !m.main.contains(['/', '\\']) && !m.main.starts_with('.') && m.main.len() <= 64, "plugin.json: main must be a .js file next to plugin.json");
        ensure!(m.permissions.len() <= 32, "plugin.json: too many permissions");
        for p in &m.permissions {
            Permission::parse(p)?;
        }
        if let Some(h) = &m.homepage {
            ensure!(h.starts_with("https://") && h.len() <= 200, "plugin.json: homepage must be an https link");
        }
        Ok(m)
    }

    pub fn permissions(&self) -> Vec<Permission> {
        self.permissions.iter().filter_map(|p| Permission::parse(p).ok()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn json(extra: &str) -> String {
        format!(r#"{{"id":"com.example.timer","name":"Sleep timer","version":"1.0.0","author":"Ann","api":1{extra}}}"#)
    }

    #[test]
    fn good_manifest_and_defaults() {
        let m = Manifest::parse(&json(r#","permissions":["player:control","network:api.example.com"]"#)).unwrap();
        assert_eq!(m.main, "main.js");
        assert_eq!(m.permissions().len(), 2);
    }

    #[test]
    fn bad_fields_are_refused() {
        for bad in [
            json(r#","permissions":["files:all"]"#),
            json(r#","main":"../x.js""#),
            json(r#","main":"main.py""#),
            json(r#","homepage":"http://x""#),
            json(r#","permissions":["network:*"]"#),
            r#"{"id":"../evil","name":"x","version":"1","author":"a","api":1}"#.into(),
            r#"{"id":"ok.id","name":"","version":"1","author":"a","api":1}"#.into(),
        ] {
            assert!(Manifest::parse(&bad).is_err(), "{bad}");
        }
        let newer = Manifest::parse(&json("").replace("\"api\":1", "\"api\":9")).unwrap_err().to_string();
        assert!(newer.contains("newer version of Legato"), "{newer}");
    }
}
