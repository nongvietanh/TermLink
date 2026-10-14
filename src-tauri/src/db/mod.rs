//! SQLite persistence: connection management and schema migrations.
//!
//! Migrations are embedded SQL files applied in order inside a transaction each.
//! The applied version is tracked with `PRAGMA user_version`, so a database
//! created by a newer TermLink build is refused instead of being corrupted.

use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use rusqlite::{Connection, OpenFlags};

use crate::error::{AppError, AppResult, ErrorKind};

pub mod groups;
pub mod history;
pub mod known_hosts;
pub mod profiles;
pub mod settings;
pub mod snippets;
pub mod tags;
pub mod transfers;

/// Ordered list of migrations. Index + 1 is the schema version after applying.
const MIGRATIONS: &[(&str, &str)] = &[(
    "0001_initial",
    include_str!("../../migrations/0001_initial.sql"),
)];

pub const SCHEMA_VERSION: u32 = MIGRATIONS.len() as u32;

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    /// Opens (or creates) the database file and applies pending migrations.
    pub fn open(path: &Path) -> AppResult<Self> {
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        Self::init(conn)
    }

    /// In-memory database, used by tests.
    pub fn open_in_memory() -> AppResult<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(mut conn: Connection) -> AppResult<Self> {
        conn.pragma_update(None, "foreign_keys", true)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        migrate(&mut conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Locks the connection. Operations are short; the lock is never held
    /// across `.await` points.
    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        // A poisoned lock only means another thread panicked mid-operation;
        // SQLite transactions keep the data itself consistent.
        self.conn.lock().unwrap_or_else(|p| p.into_inner())
    }
}

pub fn schema_version(conn: &Connection) -> AppResult<u32> {
    Ok(conn.query_row("PRAGMA user_version", [], |r| r.get::<_, u32>(0))?)
}

pub fn migrate(conn: &mut Connection) -> AppResult<()> {
    let current = schema_version(conn)?;
    if current > SCHEMA_VERSION {
        return Err(AppError::new(
            ErrorKind::Database,
            format!(
                "The local database was created by a newer version of TermLink (schema {current}, supported {SCHEMA_VERSION}). Please update TermLink."
            ),
        ));
    }
    for (index, (name, sql)) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let version = index as u32 + 1;
        log::info!("applying database migration {name} (v{version})");
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", version)?;
        tx.commit()?;
    }
    Ok(())
}

pub fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_empty_database_to_latest() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        assert_eq!(schema_version(&conn).unwrap(), SCHEMA_VERSION);
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        for expected in [
            "command_history",
            "groups",
            "known_hosts",
            "port_forwards",
            "profile_tags",
            "profiles",
            "session_history",
            "settings",
            "snippet_tags",
            "snippets",
            "tags",
            "transfer_history",
        ] {
            assert!(
                tables.contains(&expected.to_string()),
                "missing table {expected}"
            );
        }
    }

    #[test]
    fn migration_is_idempotent() {
        let db = Db::open_in_memory().unwrap();
        let mut conn = db.conn();
        migrate(&mut conn).unwrap();
        migrate(&mut conn).unwrap();
        assert_eq!(schema_version(&conn).unwrap(), SCHEMA_VERSION);
    }

    #[test]
    fn refuses_newer_schema() {
        let db = Db::open_in_memory().unwrap();
        let mut conn = db.conn();
        conn.pragma_update(None, "user_version", SCHEMA_VERSION + 1)
            .unwrap();
        let err = migrate(&mut conn).unwrap_err();
        assert_eq!(err.kind, ErrorKind::Database);
    }

    #[test]
    fn file_database_persists_across_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("termlink.db");
        {
            let db = Db::open(&path).unwrap();
            db.conn()
                .execute(
                    "INSERT INTO settings (key, value, updated_at) VALUES ('k', '1', 0)",
                    [],
                )
                .unwrap();
        }
        let db = Db::open(&path).unwrap();
        let v: String = db
            .conn()
            .query_row("SELECT value FROM settings WHERE key = 'k'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(v, "1");
    }

    #[test]
    fn foreign_keys_are_enforced() {
        let db = Db::open_in_memory().unwrap();
        let err = db.conn().execute(
            "INSERT INTO profile_tags (profile_id, tag_id) VALUES ('missing', 1)",
            [],
        );
        assert!(err.is_err());
    }

    #[test]
    fn port_forward_requires_target_for_local() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        conn.execute(
            "INSERT INTO profiles (id, name, created_at, updated_at) VALUES ('p', 'P', 0, 0)",
            [],
        )
        .unwrap();
        let bad = conn.execute(
            "INSERT INTO port_forwards (id, profile_id, name, kind, bind_port, created_at, updated_at)
             VALUES ('f', 'p', 'web', 'local', 8080, 0, 0)",
            [],
        );
        assert!(bad.is_err());
        conn.execute(
            "INSERT INTO port_forwards (id, profile_id, name, kind, bind_port, created_at, updated_at)
             VALUES ('d', 'p', 'socks', 'dynamic', 1080, 0, 0)",
            [],
        )
        .unwrap();
    }
}
