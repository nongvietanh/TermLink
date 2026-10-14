//! Secure credential storage.
//!
//! Secrets (SSH passwords and private-key passphrases) live only in the
//! operating system's credential store: Windows Credential Manager, macOS
//! Keychain, or the Secret Service on Linux. The SQLite database only records
//! *whether* a secret has been saved for a profile.
//!
//! Secret values are wrapped in [`Zeroizing`] so their memory is cleared when
//! dropped, and they are never logged or included in error messages.

use std::collections::HashMap;
use std::sync::Mutex;

use zeroize::Zeroizing;

use crate::error::{AppError, AppResult, ErrorKind};

pub type Secret = Zeroizing<String>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SecretKind {
    Password,
    Passphrase,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SecretKey {
    pub profile_id: String,
    pub kind: SecretKind,
}

impl SecretKey {
    pub fn password(profile_id: &str) -> Self {
        Self {
            profile_id: profile_id.to_string(),
            kind: SecretKind::Password,
        }
    }

    pub fn passphrase(profile_id: &str) -> Self {
        Self {
            profile_id: profile_id.to_string(),
            kind: SecretKind::Passphrase,
        }
    }

    /// Account name inside the credential store. Contains no secret data.
    pub fn account(&self) -> String {
        let kind = match self.kind {
            SecretKind::Password => "password",
            SecretKind::Passphrase => "passphrase",
        };
        format!("profile:{}:{kind}", self.profile_id)
    }
}

pub trait SecretStore: Send + Sync {
    fn set(&self, key: &SecretKey, secret: &str) -> AppResult<()>;
    fn get(&self, key: &SecretKey) -> AppResult<Option<Secret>>;
    /// Removes a secret. Removing a missing secret is not an error.
    fn delete(&self, key: &SecretKey) -> AppResult<()>;
    fn backend_name(&self) -> &'static str;
}

fn store_error(action: &str, err: &keyring::Error) -> AppError {
    // keyring errors describe the platform failure and never contain the secret.
    log::warn!("credential store {action} failed: {err}");
    let message = match err {
        keyring::Error::NoStorageAccess(_) | keyring::Error::NoDefaultStore => {
            "The system credential store is not available"
        }
        keyring::Error::TooLong(..) => "The secret is too long for the system credential store",
        _ => "The system credential store reported an error",
    };
    AppError::new(ErrorKind::CredentialStore, message)
}

/// Credential store backed by the operating system keyring.
pub struct KeyringStore {
    service: String,
}

impl KeyringStore {
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
        }
    }

    fn entry(&self, key: &SecretKey) -> AppResult<keyring::Entry> {
        keyring::Entry::new(&self.service, &key.account()).map_err(|e| store_error("open", &e))
    }
}

impl SecretStore for KeyringStore {
    fn set(&self, key: &SecretKey, secret: &str) -> AppResult<()> {
        if secret.is_empty() {
            return Err(AppError::validation("An empty secret cannot be saved"));
        }
        self.entry(key)?
            .set_password(secret)
            .map_err(|e| store_error("write", &e))
    }

    fn get(&self, key: &SecretKey) -> AppResult<Option<Secret>> {
        match self.entry(key)?.get_password() {
            Ok(s) => Ok(Some(Zeroizing::new(s))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(store_error("read", &e)),
        }
    }

    fn delete(&self, key: &SecretKey) -> AppResult<()> {
        match self.entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(store_error("delete", &e)),
        }
    }

    fn backend_name(&self) -> &'static str {
        if cfg!(windows) {
            "Windows Credential Manager"
        } else if cfg!(target_os = "macos") {
            "macOS Keychain"
        } else {
            "Secret Service"
        }
    }
}

/// In-memory store for tests and for running without a system keyring.
/// Secrets are lost when the process exits.
#[derive(Default)]
pub struct MemoryStore {
    secrets: Mutex<HashMap<SecretKey, Secret>>,
}

impl SecretStore for MemoryStore {
    fn set(&self, key: &SecretKey, secret: &str) -> AppResult<()> {
        if secret.is_empty() {
            return Err(AppError::validation("An empty secret cannot be saved"));
        }
        self.secrets
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(key.clone(), Zeroizing::new(secret.to_string()));
        Ok(())
    }

    fn get(&self, key: &SecretKey) -> AppResult<Option<Secret>> {
        Ok(self
            .secrets
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .get(key)
            .cloned())
    }

    fn delete(&self, key: &SecretKey) -> AppResult<()> {
        self.secrets
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(key);
        Ok(())
    }

    fn backend_name(&self) -> &'static str {
        "In-memory (not persisted)"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn exercise(store: &dyn SecretStore) {
        let key = SecretKey::password(&uuid::Uuid::new_v4().to_string());
        assert!(store.get(&key).unwrap().is_none());
        store.set(&key, "s3cret").unwrap();
        assert_eq!(
            store.get(&key).unwrap().as_deref().map(String::as_str),
            Some("s3cret")
        );
        store.set(&key, "rotated").unwrap();
        assert_eq!(
            store.get(&key).unwrap().as_deref().map(String::as_str),
            Some("rotated")
        );
        store.delete(&key).unwrap();
        assert!(store.get(&key).unwrap().is_none());
        // Deleting twice is fine.
        store.delete(&key).unwrap();
        assert!(store.set(&key, "").is_err());
    }

    #[test]
    fn memory_store_roundtrip() {
        exercise(&MemoryStore::default());
    }

    #[test]
    fn password_and_passphrase_are_distinct() {
        let store = MemoryStore::default();
        store.set(&SecretKey::password("p"), "pw").unwrap();
        assert!(store.get(&SecretKey::passphrase("p")).unwrap().is_none());
        assert_eq!(SecretKey::passphrase("p").account(), "profile:p:passphrase");
    }

    /// Exercises the real OS credential store. Ignored by default because it
    /// touches the user's keyring; run with `cargo test -- --ignored keyring`.
    #[test]
    #[ignore]
    fn keyring_store_roundtrip() {
        exercise(&KeyringStore::new("TermLink-test"));
    }
}
