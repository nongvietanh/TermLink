//! SFTP transfer history.

use rusqlite::{params, Row};
use serde::Serialize;

use super::{new_id, now_ms, Db};
use crate::error::AppResult;

/// History is bounded so it cannot grow without limit.
const MAX_TRANSFER_HISTORY: i64 = 2_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferRecord {
    pub id: String,
    pub profile_id: Option<String>,
    pub direction: String,
    pub local_path: String,
    pub remote_path: String,
    pub size_bytes: Option<i64>,
    pub transferred_bytes: i64,
    pub status: String,
    pub error: Option<String>,
    pub started_at: i64,
    pub finished_at: Option<i64>,
}

/// A finished transfer to persist (completed, failed or cancelled).
pub struct NewTransfer<'a> {
    pub profile_id: Option<&'a str>,
    pub direction: &'a str,
    pub local_path: &'a str,
    pub remote_path: &'a str,
    pub size_bytes: Option<i64>,
    pub transferred_bytes: i64,
    pub status: &'a str,
    pub error: Option<&'a str>,
    pub started_at: i64,
}

pub fn record(db: &Db, t: NewTransfer<'_>) -> AppResult<()> {
    let conn = db.conn();
    conn.execute(
        "INSERT INTO transfer_history
            (id, profile_id, direction, local_path, remote_path, size_bytes,
             transferred_bytes, status, error, started_at, finished_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            new_id(),
            t.profile_id,
            t.direction,
            t.local_path,
            t.remote_path,
            t.size_bytes,
            t.transferred_bytes,
            t.status,
            t.error,
            t.started_at,
            now_ms(),
        ],
    )?;
    conn.execute(
        "DELETE FROM transfer_history WHERE id NOT IN
           (SELECT id FROM transfer_history ORDER BY started_at DESC LIMIT ?1)",
        [MAX_TRANSFER_HISTORY],
    )?;
    Ok(())
}

fn from_row(r: &Row<'_>) -> rusqlite::Result<TransferRecord> {
    Ok(TransferRecord {
        id: r.get(0)?,
        profile_id: r.get(1)?,
        direction: r.get(2)?,
        local_path: r.get(3)?,
        remote_path: r.get(4)?,
        size_bytes: r.get(5)?,
        transferred_bytes: r.get(6)?,
        status: r.get(7)?,
        error: r.get(8)?,
        started_at: r.get(9)?,
        finished_at: r.get(10)?,
    })
}

pub fn list(db: &Db, limit: u32) -> AppResult<Vec<TransferRecord>> {
    let conn = db.conn();
    let mut stmt = conn.prepare(
        "SELECT id, profile_id, direction, local_path, remote_path, size_bytes,
                transferred_bytes, status, error, started_at, finished_at
         FROM transfer_history ORDER BY started_at DESC, id DESC LIMIT ?1",
    )?;
    let rows = stmt
        .query_map([limit.min(500)], from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn clear(db: &Db) -> AppResult<()> {
    db.conn().execute("DELETE FROM transfer_history", [])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_and_lists_transfers() {
        let db = Db::open_in_memory().unwrap();
        record(
            &db,
            NewTransfer {
                profile_id: None,
                direction: "download",
                local_path: "/home/u/file.txt",
                remote_path: "/srv/file.txt",
                size_bytes: Some(1024),
                transferred_bytes: 1024,
                status: "completed",
                error: None,
                started_at: now_ms(),
            },
        )
        .unwrap();
        record(
            &db,
            NewTransfer {
                profile_id: None,
                direction: "upload",
                local_path: "/home/u/img.png",
                remote_path: "/srv/img.png",
                size_bytes: Some(2048),
                transferred_bytes: 512,
                status: "cancelled",
                error: None,
                started_at: now_ms(),
            },
        )
        .unwrap();
        let rows = list(&db, 10).unwrap();
        assert_eq!(rows.len(), 2);
        clear(&db).unwrap();
        assert!(list(&db, 10).unwrap().is_empty());
    }
}
