use anyhow::Result;
use keyring::{Entry, Error};
use music_core::model::SecretStore;

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
