//! Tag helpers shared by profiles and snippets.

use std::collections::HashMap;

use rusqlite::{params, Connection};

use crate::error::AppResult;

#[derive(Clone, Copy)]
pub enum TagOwner {
    Profile,
    Snippet,
}

impl TagOwner {
    fn table(self) -> &'static str {
        match self {
            TagOwner::Profile => "profile_tags",
            TagOwner::Snippet => "snippet_tags",
        }
    }
    fn column(self) -> &'static str {
        match self {
            TagOwner::Profile => "profile_id",
            TagOwner::Snippet => "snippet_id",
        }
    }
}

/// Replaces the tags of one owner. Must run inside a transaction.
pub fn set_tags(
    conn: &Connection,
    owner: TagOwner,
    owner_id: &str,
    tags: &[String],
) -> AppResult<()> {
    let (table, column) = (owner.table(), owner.column());
    conn.execute(
        &format!("DELETE FROM {table} WHERE {column} = ?1"),
        [owner_id],
    )?;
    for tag in tags {
        conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", [tag])?;
        let tag_id: i64 =
            conn.query_row("SELECT id FROM tags WHERE name = ?1", [tag], |r| r.get(0))?;
        conn.execute(
            &format!("INSERT OR IGNORE INTO {table} ({column}, tag_id) VALUES (?1, ?2)"),
            params![owner_id, tag_id],
        )?;
    }
    Ok(())
}

/// Loads tags for all owners of a kind, keyed by owner id.
pub fn load_all(conn: &Connection, owner: TagOwner) -> AppResult<HashMap<String, Vec<String>>> {
    let (table, column) = (owner.table(), owner.column());
    let mut stmt = conn.prepare(&format!(
        "SELECT x.{column}, t.name FROM {table} x JOIN tags t ON t.id = x.tag_id ORDER BY t.name COLLATE NOCASE"
    ))?;
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    for row in rows {
        let (id, name) = row?;
        map.entry(id).or_default().push(name);
    }
    Ok(map)
}

pub fn load_for(conn: &Connection, owner: TagOwner, owner_id: &str) -> AppResult<Vec<String>> {
    let (table, column) = (owner.table(), owner.column());
    let mut stmt = conn.prepare(&format!(
        "SELECT t.name FROM {table} x JOIN tags t ON t.id = x.tag_id WHERE x.{column} = ?1 ORDER BY t.name COLLATE NOCASE"
    ))?;
    let tags = stmt
        .query_map([owner_id], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(tags)
}

/// Removes tags no longer referenced by anything.
pub fn prune(conn: &Connection) -> AppResult<()> {
    conn.execute(
        "DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM profile_tags)
                         AND id NOT IN (SELECT tag_id FROM snippet_tags)",
        [],
    )?;
    Ok(())
}

pub fn list_all(conn: &Connection) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare("SELECT name FROM tags ORDER BY name COLLATE NOCASE")?;
    let tags = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(tags)
}
