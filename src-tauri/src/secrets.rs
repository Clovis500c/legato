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

/// Android: `keyring` has no store there. One JSON object in the app's private folder, sealed by a key in Android's
/// Keystore (`mobile/keystore.rs`): `secrets.bin`. An older `secrets.json` (plain) is sealed and removed at the first
/// launch; if the Keystore refuses, the plain file stays rather than losing a sign-in.
#[cfg(target_os = "android")]
pub struct FileStore {
    plain: std::path::PathBuf,
    sealed: std::path::PathBuf,
    lock: std::sync::Mutex<()>,
}

#[cfg(target_os = "android")]
impl FileStore {
    pub fn new(plain: std::path::PathBuf) -> Self {
        let sealed = plain.with_extension("bin");
        let me = Self { plain, sealed, lock: std::sync::Mutex::new(()) };
        if me.plain.exists() && !me.sealed.exists() {
            let all = me.read();
            let _ = me.write(&all);
        }
        me
    }

    fn read(&self) -> serde_json::Map<String, serde_json::Value> {
        if let Ok(bytes) = std::fs::read(&self.sealed) {
            // A key gone (restored backup, reset lock screen): nothing to read, the sign-ins are asked again.
            return crate::keystore::open(&bytes).ok().flatten().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        }
        std::fs::read(&self.plain).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    fn write(&self, all: &serde_json::Map<String, serde_json::Value>) -> Result<()> {
        let json = serde_json::to_vec(all)?;
        // Whole file at once: a crash mid-write keeps the old one.
        match crate::keystore::seal(&json) {
            Ok(sealed) => {
                let tmp = self.sealed.with_extension("tmp");
                std::fs::write(&tmp, sealed)?;
                std::fs::rename(&tmp, &self.sealed)?;
                let _ = std::fs::remove_file(&self.plain);
            }
            Err(_) => {
                let tmp = self.plain.with_extension("tmp");
                std::fs::write(&tmp, json)?;
                std::fs::rename(&tmp, &self.plain)?;
            }
        }
        Ok(())
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
        self.write(&all)
    }
}
