//! Connection groups (nested folders).

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::{new_id, now_ms, Db};
use crate::domain::{Group, GroupInput};
use crate::error::{AppError, AppResult};

const COLUMNS: &str = "id, parent_id, name, sort_order, expanded, created_at, updated_at";

fn from_row(r: &Row<'_>) -> rusqlite::Result<Group> {
    Ok(Group {
        id: r.get(0)?,
        parent_id: r.get(1)?,
        name: r.get(2)?,
        sort_order: r.get(3)?,
        expanded: r.get::<_, i64>(4)? != 0,
        created_at: r.get(5)?,
        updated_at: r.get(6)?,
    })
}

pub fn list(db: &Db) -> AppResult<Vec<Group>> {
    let conn = db.conn();
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM groups ORDER BY sort_order, name COLLATE NOCASE"
    ))?;
    let groups = stmt
        .query_map([], from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(groups)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Group> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM groups WHERE id = ?1"),
        [id],
        from_row,
    )
    .optional()?
    .ok_or_else(|| AppError::not_found("Group"))
}

/// Ensures `parent` exists and that making it the parent of `id` would not create a cycle.
fn check_parent(conn: &Connection, id: Option<&str>, parent: Option<&str>) -> AppResult<()> {
    let Some(parent) = parent else { return Ok(()) };
    get(conn, parent)?;
    let Some(id) = id else { return Ok(()) };
    let mut cursor = Some(parent.to_string());
    let mut depth = 0;
    while let Some(current) = cursor {
        if current == id {
            return Err(AppError::validation(
                "A group cannot be moved into itself or one of its subgroups",
            ));
        }
        depth += 1;
        if depth > 64 {
            return Err(AppError::validation(
                "Groups can be nested at most 64 levels deep",
            ));
        }
        cursor = conn
            .query_row(
                "SELECT parent_id FROM groups WHERE id = ?1",
                [&current],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();
    }
    Ok(())
}

pub fn create(db: &Db, input: GroupInput) -> AppResult<Group> {
    let input = input.validate()?;
    let conn = db.conn();
    check_parent(&conn, None, input.parent_id.as_deref())?;
    let id = new_id();
    let now = now_ms();
    let sort: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM groups WHERE parent_id IS ?1",
        [&input.parent_id],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO groups (id, parent_id, name, sort_order, expanded, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![
            id,
            input.parent_id,
            input.name,
            sort,
            input.expanded as i64,
            now
        ],
    )?;
    get(&conn, &id)
}

pub fn update(db: &Db, id: &str, input: GroupInput) -> AppResult<Group> {
    let input = input.validate()?;
    let conn = db.conn();
    get(&conn, id)?;
    check_parent(&conn, Some(id), input.parent_id.as_deref())?;
    conn.execute(
        "UPDATE groups SET name = ?2, parent_id = ?3, expanded = ?4, updated_at = ?5 WHERE id = ?1",
        params![
            id,
            input.name,
            input.parent_id,
            input.expanded as i64,
            now_ms()
        ],
    )?;
    get(&conn, id)
}

pub fn set_expanded(db: &Db, id: &str, expanded: bool) -> AppResult<()> {
    let changed = db.conn().execute(
        "UPDATE groups SET expanded = ?2 WHERE id = ?1",
        params![id, expanded as i64],
    )?;
    if changed == 0 {
        return Err(AppError::not_found("Group"));
    }
    Ok(())
}

/// Deletes a group. Its subgroups and profiles move up to the deleted group's
/// parent so that no connection profile is lost by deleting a folder.
pub fn delete(db: &Db, id: &str) -> AppResult<()> {
    let mut conn = db.conn();
    let tx = conn.transaction()?;
    let group = get(&tx, id)?;
    let now = now_ms();
    tx.execute(
        "UPDATE groups SET parent_id = ?2, updated_at = ?3 WHERE parent_id = ?1",
        params![id, group.parent_id, now],
    )?;
    tx.execute(
        "UPDATE profiles SET group_id = ?2, updated_at = ?3 WHERE group_id = ?1",
        params![id, group.parent_id, now],
    )?;
    tx.execute("DELETE FROM groups WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(name: &str, parent: Option<&str>) -> GroupInput {
        GroupInput {
            name: name.into(),
            parent_id: parent.map(String::from),
            expanded: true,
        }
    }

    #[test]
    fn create_nested_and_list() {
        let db = Db::open_in_memory().unwrap();
        let root = create(&db, input("Production", None)).unwrap();
        let child = create(&db, input("Web", Some(&root.id))).unwrap();
        assert_eq!(child.parent_id.as_deref(), Some(root.id.as_str()));
        assert_eq!(list(&db).unwrap().len(), 2);
    }

    #[test]
    fn rejects_cycles() {
        let db = Db::open_in_memory().unwrap();
        let a = create(&db, input("A", None)).unwrap();
        let b = create(&db, input("B", Some(&a.id))).unwrap();
        let c = create(&db, input("C", Some(&b.id))).unwrap();
        assert!(update(&db, &a.id, input("A", Some(&c.id))).is_err());
        assert!(update(&db, &a.id, input("A", Some(&a.id))).is_err());
        // Moving C to root is fine.
        update(&db, &c.id, input("C", None)).unwrap();
    }

    #[test]
    fn rejects_unknown_parent() {
        let db = Db::open_in_memory().unwrap();
        let err = create(&db, input("X", Some(&new_id()))).unwrap_err();
        assert_eq!(err.kind, crate::error::ErrorKind::NotFound);
    }

    #[test]
    fn delete_reparents_children() {
        let db = Db::open_in_memory().unwrap();
        let root = create(&db, input("Root", None)).unwrap();
        let mid = create(&db, input("Mid", Some(&root.id))).unwrap();
        let leaf = create(&db, input("Leaf", Some(&mid.id))).unwrap();
        delete(&db, &mid.id).unwrap();
        let leaf = get(&db.conn(), &leaf.id).unwrap();
        assert_eq!(leaf.parent_id.as_deref(), Some(root.id.as_str()));
    }
}
