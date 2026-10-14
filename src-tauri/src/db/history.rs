//! Session history and command history.

use rusqlite::{params, Row};

use super::{now_ms, Db};
use crate::domain::{CommandHistoryEntry, CommandSource, SessionHistoryEntry};
use crate::error::{AppError, AppResult};

/// History is bounded so it cannot grow without limit.
const MAX_SESSION_HISTORY: i64 = 2_000;
const MAX_COMMAND_HISTORY: i64 = 5_000;

pub struct NewSession<'a> {
    pub profile_id: Option<&'a str>,
    pub protocol: &'a str,
    pub label: &'a str,
    pub host: &'a str,
    pub port: Option<u16>,
    pub username: &'a str,
}

pub fn session_started(db: &Db, s: NewSession<'_>) -> AppResult<i64> {
    let conn = db.conn();
    conn.execute(
        "INSERT INTO session_history (profile_id, protocol, label, host, port, username, status, started_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'connecting', ?7)",
        params![s.profile_id, s.protocol, s.label, s.host, s.port, s.username, now_ms()],
    )?;
    let id = conn.last_insert_rowid();
    conn.execute(
        "DELETE FROM session_history WHERE id NOT IN
           (SELECT id FROM session_history ORDER BY started_at DESC LIMIT ?1)",
        [MAX_SESSION_HISTORY],
    )?;
    Ok(id)
}

pub fn session_status(db: &Db, id: i64, status: &str, error: Option<&str>) -> AppResult<()> {
    let ended = matches!(status, "failed" | "closed").then(now_ms);
    db.conn().execute(
        "UPDATE session_history SET status = ?2, error = COALESCE(?3, error),
            ended_at = COALESCE(?4, ended_at) WHERE id = ?1",
        params![id, status, error, ended],
    )?;
    Ok(())
}

fn session_from_row(r: &Row<'_>) -> rusqlite::Result<SessionHistoryEntry> {
    Ok(SessionHistoryEntry {
        id: r.get(0)?,
        profile_id: r.get(1)?,
        protocol: r.get(2)?,
        label: r.get(3)?,
        host: r.get(4)?,
        port: r.get(5)?,
        username: r.get(6)?,
        status: r.get(7)?,
        error: r.get(8)?,
        started_at: r.get(9)?,
        ended_at: r.get(10)?,
    })
}

pub fn list_sessions(db: &Db, limit: u32) -> AppResult<Vec<SessionHistoryEntry>> {
    let conn = db.conn();
    let mut stmt = conn.prepare(
        "SELECT id, profile_id, protocol, label, host, port, username, status, error, started_at, ended_at
         FROM session_history ORDER BY started_at DESC, id DESC LIMIT ?1",
    )?;
    let rows = stmt
        .query_map([limit.min(500)], session_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Sessions left in "connecting"/"connected" by a crash are closed at startup.
pub fn close_dangling_sessions(db: &Db) -> AppResult<()> {
    db.conn().execute(
        "UPDATE session_history SET status = 'closed', ended_at = COALESCE(ended_at, started_at)
         WHERE status IN ('connecting', 'connected')",
        [],
    )?;
    Ok(())
}

pub fn clear_sessions(db: &Db) -> AppResult<()> {
    db.conn().execute("DELETE FROM session_history", [])?;
    Ok(())
}

pub fn record_command(
    db: &Db,
    profile_id: Option<&str>,
    target_label: &str,
    command: &str,
    source: CommandSource,
) -> AppResult<()> {
    if command.trim().is_empty() || command.chars().count() > 20_000 {
        return Err(AppError::validation(
            "Command must be 1 to 20000 characters",
        ));
    }
    let conn = db.conn();
    conn.execute(
        "INSERT INTO command_history (profile_id, target_label, command, source, executed_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![profile_id, target_label, command, source.as_str(), now_ms()],
    )?;
    conn.execute(
        "DELETE FROM command_history WHERE id NOT IN
           (SELECT id FROM command_history ORDER BY executed_at DESC LIMIT ?1)",
        [MAX_COMMAND_HISTORY],
    )?;
    Ok(())
}

pub fn list_commands(
    db: &Db,
    query: Option<&str>,
    limit: u32,
) -> AppResult<Vec<CommandHistoryEntry>> {
    let conn = db.conn();
    let pattern = query.map(str::trim).filter(|q| !q.is_empty()).map(|q| {
        format!(
            "%{}%",
            q.replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_")
        )
    });
    let mut stmt = conn.prepare(
        "SELECT id, profile_id, target_label, command, source, executed_at FROM command_history
         WHERE ?1 IS NULL OR command LIKE ?1 ESCAPE '\\' OR target_label LIKE ?1 ESCAPE '\\'
         ORDER BY executed_at DESC, id DESC LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![pattern, limit.min(1000)], |r| {
            Ok(CommandHistoryEntry {
                id: r.get(0)?,
                profile_id: r.get(1)?,
                target_label: r.get(2)?,
                command: r.get(3)?,
                source: r.get(4)?,
                executed_at: r.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn clear_commands(db: &Db) -> AppResult<()> {
    db.conn().execute("DELETE FROM command_history", [])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_lifecycle() {
        let db = Db::open_in_memory().unwrap();
        let id = session_started(
            &db,
            NewSession {
                profile_id: None,
                protocol: "ssh",
                label: "web",
                host: "web",
                port: Some(22),
                username: "root",
            },
        )
        .unwrap();
        session_status(&db, id, "connected", None).unwrap();
        session_status(&db, id, "failed", Some("Authentication failed")).unwrap();
        let rows = list_sessions(&db, 10).unwrap();
        assert_eq!(rows[0].status, "failed");
        assert_eq!(rows[0].error.as_deref(), Some("Authentication failed"));
        assert!(rows[0].ended_at.is_some());
    }

    #[test]
    fn command_search_escapes_wildcards() {
        let db = Db::open_in_memory().unwrap();
        record_command(&db, None, "web", "df -h", CommandSource::Snippet).unwrap();
        record_command(&db, None, "web", "echo 100%", CommandSource::Palette).unwrap();
        assert_eq!(list_commands(&db, Some("%"), 10).unwrap().len(), 1);
        assert_eq!(list_commands(&db, Some("df"), 10).unwrap().len(), 1);
        assert_eq!(list_commands(&db, None, 10).unwrap().len(), 2);
        assert!(record_command(&db, None, "", "   ", CommandSource::Palette).is_err());
        clear_commands(&db).unwrap();
        assert!(list_commands(&db, None, 10).unwrap().is_empty());
    }
}
