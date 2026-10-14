//! Trusted SSH host keys.
//!
//! A host is identified by (host, port). A presented key is:
//! - `Trusted` when an identical key is stored for that endpoint,
//! - `Changed` when other keys are stored for that endpoint (possible MITM),
//! - `Unknown` when nothing is stored for that endpoint.
//!
//! Keys are only added after an explicit user decision.

use rusqlite::{params, OptionalExtension};

use super::{now_ms, Db};
use crate::domain::KnownHost;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostKeyStatus {
    Trusted,
    Unknown,
    /// Previously trusted keys for this endpoint (fingerprint, algorithm).
    Changed {
        previous: Vec<(String, String)>,
    },
}

pub struct PresentedKey<'a> {
    pub host: &'a str,
    pub port: u16,
    pub algorithm: &'a str,
    /// OpenSSH base64 public key blob.
    pub public_key: &'a str,
    pub fingerprint: &'a str,
}

pub fn check(db: &Db, key: &PresentedKey<'_>) -> AppResult<HostKeyStatus> {
    let conn = db.conn();
    let mut stmt = conn.prepare(
        "SELECT id, algorithm, public_key, fingerprint FROM known_hosts WHERE host = ?1 AND port = ?2",
    )?;
    let rows = stmt
        .query_map(params![key.host, key.port], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    if rows.is_empty() {
        return Ok(HostKeyStatus::Unknown);
    }
    if let Some((id, ..)) = rows
        .iter()
        .find(|(_, alg, pk, _)| alg == key.algorithm && pk == key.public_key)
    {
        conn.execute(
            "UPDATE known_hosts SET last_seen_at = ?2 WHERE id = ?1",
            params![id, now_ms()],
        )?;
        return Ok(HostKeyStatus::Trusted);
    }
    Ok(HostKeyStatus::Changed {
        previous: rows.into_iter().map(|(_, alg, _, fp)| (fp, alg)).collect(),
    })
}

/// Trusts a key. When `replace` is set, all other keys for the endpoint are
/// removed (used when the user accepts a changed key).
pub fn trust(db: &Db, key: &PresentedKey<'_>, replace: bool) -> AppResult<()> {
    let mut conn = db.conn();
    let tx = conn.transaction()?;
    if replace {
        tx.execute(
            "DELETE FROM known_hosts WHERE host = ?1 AND port = ?2",
            params![key.host, key.port],
        )?;
    }
    let now = now_ms();
    tx.execute(
        "INSERT INTO known_hosts (host, port, algorithm, public_key, fingerprint, added_at, last_seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT (host, port, algorithm) DO UPDATE SET
            public_key = excluded.public_key, fingerprint = excluded.fingerprint,
            added_at = excluded.added_at, last_seen_at = excluded.last_seen_at",
        params![key.host, key.port, key.algorithm, key.public_key, key.fingerprint, now],
    )?;
    tx.commit()?;
    Ok(())
}

pub fn list(db: &Db) -> AppResult<Vec<KnownHost>> {
    let conn = db.conn();
    let mut stmt = conn.prepare(
        "SELECT id, host, port, algorithm, public_key, fingerprint, added_at, last_seen_at
         FROM known_hosts ORDER BY host COLLATE NOCASE, port, algorithm",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(KnownHost {
                id: r.get(0)?,
                host: r.get(1)?,
                port: r.get(2)?,
                algorithm: r.get(3)?,
                public_key: r.get(4)?,
                fingerprint: r.get(5)?,
                added_at: r.get(6)?,
                last_seen_at: r.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn delete(db: &Db, id: i64) -> AppResult<()> {
    let conn = db.conn();
    let n = conn.execute("DELETE FROM known_hosts WHERE id = ?1", [id])?;
    if n == 0 {
        return Err(AppError::not_found("Known host"));
    }
    Ok(())
}

pub fn exists(db: &Db, host: &str, port: u16) -> AppResult<bool> {
    Ok(db
        .conn()
        .query_row(
            "SELECT 1 FROM known_hosts WHERE host = ?1 AND port = ?2 LIMIT 1",
            params![host, port],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key<'a>(pk: &'a str, fp: &'a str) -> PresentedKey<'a> {
        PresentedKey {
            host: "srv.example.com",
            port: 22,
            algorithm: "ssh-ed25519",
            public_key: pk,
            fingerprint: fp,
        }
    }

    #[test]
    fn unknown_then_trusted() {
        let db = Db::open_in_memory().unwrap();
        let k = key("AAAA1", "SHA256:one");
        assert_eq!(check(&db, &k).unwrap(), HostKeyStatus::Unknown);
        trust(&db, &k, false).unwrap();
        assert_eq!(check(&db, &k).unwrap(), HostKeyStatus::Trusted);
        assert!(
            exists(&db, "SRV.example.com", 22).unwrap(),
            "host match is case-insensitive"
        );
    }

    #[test]
    fn changed_key_is_detected_and_replaceable() {
        let db = Db::open_in_memory().unwrap();
        trust(&db, &key("AAAA1", "SHA256:one"), false).unwrap();
        let attacker = key("AAAA2", "SHA256:two");
        match check(&db, &attacker).unwrap() {
            HostKeyStatus::Changed { previous } => {
                assert_eq!(
                    previous,
                    vec![("SHA256:one".to_string(), "ssh-ed25519".to_string())]
                );
            }
            other => panic!("expected Changed, got {other:?}"),
        }
        trust(&db, &attacker, true).unwrap();
        assert_eq!(check(&db, &attacker).unwrap(), HostKeyStatus::Trusted);
        assert_eq!(list(&db).unwrap().len(), 1);
    }

    #[test]
    fn different_port_is_a_different_host() {
        let db = Db::open_in_memory().unwrap();
        trust(&db, &key("AAAA1", "SHA256:one"), false).unwrap();
        let other_port = PresentedKey {
            port: 2222,
            ..key("AAAA1", "SHA256:one")
        };
        assert_eq!(check(&db, &other_port).unwrap(), HostKeyStatus::Unknown);
    }

    #[test]
    fn delete_known_host() {
        let db = Db::open_in_memory().unwrap();
        trust(&db, &key("AAAA1", "SHA256:one"), false).unwrap();
        let id = list(&db).unwrap()[0].id;
        delete(&db, id).unwrap();
        assert!(delete(&db, id).is_err());
    }
}
