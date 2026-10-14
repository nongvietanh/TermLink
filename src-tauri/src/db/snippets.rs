//! Reusable command snippets.

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::tags::{self, TagOwner};
use super::{new_id, now_ms, Db};
use crate::domain::{is_potentially_destructive, Snippet, SnippetInput};
use crate::error::{AppError, AppResult};

const COLUMNS: &str =
    "id, name, command, description, category, confirm_before_run, created_at, updated_at";

fn from_row(r: &Row<'_>) -> rusqlite::Result<Snippet> {
    let command: String = r.get(2)?;
    Ok(Snippet {
        id: r.get(0)?,
        name: r.get(1)?,
        potentially_destructive: is_potentially_destructive(&command),
        command,
        description: r.get(3)?,
        category: r.get(4)?,
        tags: Vec::new(),
        confirm_before_run: r.get::<_, i64>(5)? != 0,
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
    })
}

pub fn list(db: &Db) -> AppResult<Vec<Snippet>> {
    let conn = db.conn();
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM snippets ORDER BY category COLLATE NOCASE, name COLLATE NOCASE"
    ))?;
    let mut snippets = stmt
        .query_map([], from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    let mut tag_map = tags::load_all(&conn, TagOwner::Snippet)?;
    for s in &mut snippets {
        s.tags = tag_map.remove(&s.id).unwrap_or_default();
    }
    Ok(snippets)
}

fn get_conn(conn: &Connection, id: &str) -> AppResult<Snippet> {
    let mut s = conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM snippets WHERE id = ?1"),
            [id],
            from_row,
        )
        .optional()?
        .ok_or_else(|| AppError::not_found("Snippet"))?;
    s.tags = tags::load_for(conn, TagOwner::Snippet, id)?;
    Ok(s)
}

pub fn get(db: &Db, id: &str) -> AppResult<Snippet> {
    get_conn(&db.conn(), id)
}

pub fn create(db: &Db, input: SnippetInput) -> AppResult<Snippet> {
    let s = input.validate()?;
    let mut conn = db.conn();
    let tx = conn.transaction()?;
    let id = new_id();
    tx.execute(
        "INSERT INTO snippets (id, name, command, description, category, confirm_before_run, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![id, s.name, s.command, s.description, s.category, s.confirm_before_run as i64, now_ms()],
    )?;
    tags::set_tags(&tx, TagOwner::Snippet, &id, &s.tags)?;
    tx.commit()?;
    get_conn(&conn, &id)
}

pub fn update(db: &Db, id: &str, input: SnippetInput) -> AppResult<Snippet> {
    let s = input.validate()?;
    let mut conn = db.conn();
    let tx = conn.transaction()?;
    let n = tx.execute(
        "UPDATE snippets SET name = ?2, command = ?3, description = ?4, category = ?5,
            confirm_before_run = ?6, updated_at = ?7 WHERE id = ?1",
        params![
            id,
            s.name,
            s.command,
            s.description,
            s.category,
            s.confirm_before_run as i64,
            now_ms()
        ],
    )?;
    if n == 0 {
        return Err(AppError::not_found("Snippet"));
    }
    tags::set_tags(&tx, TagOwner::Snippet, id, &s.tags)?;
    tags::prune(&tx)?;
    tx.commit()?;
    get_conn(&conn, id)
}

pub fn delete(db: &Db, id: &str) -> AppResult<()> {
    let mut conn = db.conn();
    let tx = conn.transaction()?;
    let n = tx.execute("DELETE FROM snippets WHERE id = ?1", [id])?;
    if n == 0 {
        return Err(AppError::not_found("Snippet"));
    }
    tags::prune(&tx)?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(name: &str, cmd: &str) -> SnippetInput {
        SnippetInput {
            name: name.into(),
            command: cmd.into(),
            description: String::new(),
            category: "System".into(),
            tags: vec!["ops".into()],
            confirm_before_run: false,
        }
    }

    #[test]
    fn crud_and_destructive_flag() {
        let db = Db::open_in_memory().unwrap();
        let a = create(&db, input("Disk usage", "df -h")).unwrap();
        assert!(!a.potentially_destructive);
        let b = create(&db, input("Clean", "rm -rf /tmp/build")).unwrap();
        assert!(b.potentially_destructive);
        assert_eq!(list(&db).unwrap().len(), 2);
        let a2 = update(&db, &a.id, input("Disk", "df -hT")).unwrap();
        assert_eq!(a2.command, "df -hT");
        assert_eq!(a2.tags, vec!["ops"]);
        delete(&db, &b.id).unwrap();
        assert!(get(&db, &b.id).is_err());
        assert!(delete(&db, &b.id).is_err());
    }
}
