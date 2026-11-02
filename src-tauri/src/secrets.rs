use anyhow::Result;
use keyring::{Entry, Error};
use music_core::model::SecretStore;
use std::path::Path;
use std::sync::Arc;

/// The app's secrets: the OS keychain, or on Android a private file (`FileStore`).
#[cfg(not(target_os = "android"))]
pub fn store(service: &str, _: &Path) -> Arc<dyn SecretStore> {
    Arc::new(KeyringStore::new(service))
}

#[cfg(target_os = "android")]
pub fn store(_: &str, dir: &Path) -> Arc<dyn SecretStore> {
    Arc::new(FileStore::new(dir.join("secrets.json")))
}

/// OS keychain: Windows Credential Manager, macOS Keychain, Secret Service. One entry per key, JSON value.
pub struct KeyringStore {
    service: String,
}

impl KeyringStore {
    pub fn new(service: &str) -> Self {
        Self { service: service.into() }
    }
}

impl SecretStore for KeyringStore {
    fn get(&self, key: &str) -> Option<serde_json::Value> {
        let raw = Entry::new(&self.service, key).ok()?.get_password().ok()?;
        serde_json::from_str(&raw).ok()
    }

    fn set(&self, key: &str, value: Option<serde_json::Value>) -> Result<()> {
        let entry = Entry::new(&self.service, key)?;
        match value {
            Some(v) => entry.set_password(&v.to_string())?,
            None => match entry.delete_credential() {
                Ok(()) | Err(Error::NoEntry) => {}
                Err(e) => return Err(e.into()),
            },
        }
        Ok(())
    }
}

/// Android: `keyring` has no store there. One JSON object in the app's private folder: no other app reads it, and Android
/// encrypts user data at rest. Android's Keystore later (docs/notes/ideas/mobile.md).
#[cfg(target_os = "android")]
pub struct FileStore {
    path: std::path::PathBuf,
    lock: std::sync::Mutex<()>,
}

#[cfg(target_os = "android")]
impl FileStore {
    pub fn new(path: std::path::PathBuf) -> Self {
        Self { path, lock: std::sync::Mutex::new(()) }
    }

    fn read(&self) -> serde_json::Map<String, serde_json::Value> {
        std::fs::read(&self.path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }
}

#[cfg(target_os = "android")]
impl SecretStore for FileStore {
    fn get(&self, key: &str) -> Option<serde_json::Value> {
        let _held = self.lock.lock().unwrap();
        self.read().remove(key)
    }

    fn set(&self, key: &str, value: Option<serde_json::Value>) -> Result<()> {
        let _held = self.lock.lock().unwrap();
        let mut all = self.read();
        match value {
            Some(v) => all.insert(key.into(), v),
            None => all.remove(key),
        };
        // Whole file at once: a crash mid-write keeps the old one.
        let tmp = self.path.with_extension("tmp");
        std::fs::write(&tmp, serde_json::to_vec(&all)?)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }
}
