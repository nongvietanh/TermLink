//! Connection profile persistence.

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::tags::{self, TagOwner};
use super::{groups, new_id, now_ms, Db};
use crate::domain::profile::{AuthMethod, Profile, ProfileInput, Protocol, ValidProfile};
use crate::error::{AppError, AppResult};

const COLUMNS: &str = "id, group_id, name, protocol, host, port, username, auth_method, key_path,
    password_saved, passphrase_saved, favorite, notes, color, terminal_json, ssh_json, sort_order,
    last_connected_at, created_at, updated_at";

fn from_row(r: &Row<'_>) -> rusqlite::Result<Profile> {
    let protocol: String = r.get(3)?;
    let auth: String = r.get(7)?;
    let terminal_json: String = r.get(14)?;
    let ssh_json: String = r.get(15)?;
    let conv = |e: AppError| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    };
    Ok(Profile {
        id: r.get(0)?,
        group_id: r.get(1)?,
        name: r.get(2)?,
        protocol: Protocol::parse(&protocol).map_err(conv)?,
        host: r.get(4)?,
        port: r.get::<_, u16>(5)?,
        username: r.get(6)?,
        auth_method: AuthMethod::parse(&auth).map_err(conv)?,
        key_path: r.get(8)?,
        password_saved: r.get::<_, i64>(9)? != 0,
        passphrase_saved: r.get::<_, i64>(10)? != 0,
        favorite: r.get::<_, i64>(11)? != 0,
        notes: r.get(12)?,
        color: r.get(13)?,
        tags: Vec::new(),
        // Stored JSON was validated on write; fall back to defaults if a future
        // version wrote fields this build does not understand.
        terminal: serde_json::from_str(&terminal_json).unwrap_or_default(),
        ssh: serde_json::from_str(&ssh_json).unwrap_or_default(),
        sort_order: r.get(16)?,
        last_connected_at: r.get(17)?,
        created_at: r.get(18)?,
        updated_at: r.get(19)?,
    })
}

pub fn list(db: &Db) -> AppResult<Vec<Profile>> {
    let conn = db.conn();
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM profiles ORDER BY sort_order, name COLLATE NOCASE"
    ))?;
    let mut profiles = stmt
        .query_map([], from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    let mut tag_map = tags::load_all(&conn, TagOwner::Profile)?;
    for p in &mut profiles {
        p.tags = tag_map.remove(&p.id).unwrap_or_default();
    }
    Ok(profiles)
}

pub fn get_conn(conn: &Connection, id: &str) -> AppResult<Profile> {
    let mut profile = conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM profiles WHERE id = ?1"),
            [id],
            from_row,
        )
        .optional()?
        .ok_or_else(|| AppError::not_found("Connection profile"))?;
    profile.tags = tags::load_for(conn, TagOwner::Profile, id)?;
    Ok(profile)
}

pub fn get(db: &Db, id: &str) -> AppResult<Profile> {
    get_conn(&db.conn(), id)
}

fn insert(conn: &Connection, id: &str, p: &ValidProfile, now: i64) -> AppResult<()> {
    if let Some(g) = &p.group_id {
        groups::get(conn, g)?;
    }
    let sort: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM profiles WHERE group_id IS ?1",
        [&p.group_id],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO profiles (id, group_id, name, protocol, host, port, username, auth_method,
            key_path, favorite, notes, color, terminal_json, ssh_json, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16)",
        params![
            id,
            p.group_id,
            p.name,
            p.protocol.as_str(),
            p.host,
            p.port,
            p.username,
            p.auth_method.as_str(),
            p.key_path,
            p.favorite as i64,
            p.notes,
            p.color,
            serde_json::to_string(&p.terminal)?,
            serde_json::to_string(&p.ssh)?,
            sort,
            now
        ],
    )?;
    tags::set_tags(conn, TagOwner::Profile, id, &p.tags)?;
    Ok(())
}

pub fn create(db: &Db, input: ProfileInput) -> AppResult<Profile> {
    let valid = input.validate()?;
    create_valid(db, &valid)
}

pub fn create_valid(db: &Db, valid: &ValidProfile) -> AppResult<Profile> {
    let mut conn = db.conn();
    let tx = conn.transaction()?;
    let id = new_id();
    insert(&tx, &id, valid, now_ms())?;
    tx.commit()?;
    get_conn(&conn, &id)
}

/// Result of an update: the profile plus which stored secrets became stale and
/// should be removed from the credential store by the caller.
pub struct UpdateOutcome {
    pub profile: Profile,
    pub clear_password: bool,
    pub clear_passphrase: bool,
}

pub fn update(db: &Db, id: &str, input: ProfileInput) -> AppResult<UpdateOutcome> {
    let p = input.validate()?;
    let mut conn = db.conn();
    let tx = conn.transaction()?;
    let existing = get_conn(&tx, id)?;
    if let Some(g) = &p.group_id {
        groups::get(&tx, g)?;
    }
    // Saved secrets belong to a specific account; drop them when the target or
    // method changes so they are never sent to a different server.
    let target_changed = existing.host != p.host
        || existing.port != p.port
        || existing.username != p.username
        || existing.protocol != p.protocol;
    let clear_password = existing.password_saved
        && (target_changed
            || !matches!(
                p.auth_method,
                AuthMethod::Password | AuthMethod::KeyboardInteractive
            ));
    let clear_passphrase = existing.passphrase_saved
        && (p.auth_method != AuthMethod::PublicKey || existing.key_path != p.key_path);
    tx.execute(
        "UPDATE profiles SET group_id = ?2, name = ?3, protocol = ?4, host = ?5, port = ?6,
            username = ?7, auth_method = ?8, key_path = ?9, favorite = ?10, notes = ?11,
            color = ?12, terminal_json = ?13, ssh_json = ?14,
            password_saved = CASE WHEN ?15 THEN 0 ELSE password_saved END,
            passphrase_saved = CASE WHEN ?16 THEN 0 ELSE passphrase_saved END,
            updated_at = ?17
         WHERE id = ?1",
        params![
            id,
            p.group_id,
            p.name,
            p.protocol.as_str(),
            p.host,
            p.port,
            p.username,
            p.auth_method.as_str(),
            p.key_path,
            p.favorite as i64,
            p.notes,
            p.color,
            serde_json::to_string(&p.terminal)?,
            serde_json::to_string(&p.ssh)?,
            clear_password,
            clear_passphrase,
            now_ms()
        ],
    )?;
    tags::set_tags(&tx, TagOwner::Profile, id, &p.tags)?;
    tags::prune(&tx)?;
    tx.commit()?;
    Ok(UpdateOutcome {
        profile: get_conn(&conn, id)?,
        clear_password,
        clear_passphrase,
    })
}

/// Duplicates a profile. Saved secrets are not copied.
pub fn duplicate(db: &Db, id: &str) -> AppResult<Profile> {
    let mut conn = db.conn();
    let tx = conn.transaction()?;
    let src = get_conn(&tx, id)?;
    let mut name = format!("{} (copy)", src.name);
    if name.chars().count() > 100 {
        name = name.chars().take(100).collect();
    }
    let valid = ValidProfile {
        group_id: src.group_id,
        name,
        protocol: src.protocol,
        host: src.host,
        port: src.port,
        username: src.username,
        auth_method: src.auth_method,
        key_path: src.key_path,
        favorite: false,
        notes: src.notes,
        color: src.color,
        tags: src.tags,
        terminal: src.terminal,
        ssh: src.ssh,
    };
    let new = new_id();
    insert(&tx, &new, &valid, now_ms())?;
    tx.commit()?;
    get_conn(&conn, &new)
}

/// Deletes profiles and returns those that existed (callers remove their secrets).
pub fn delete_many(db: &Db, ids: &[String]) -> AppResult<Vec<Profile>> {
    let mut conn = db.conn();
    let tx = conn.transaction()?;
    let mut deleted = Vec::new();
    for id in ids {
        if let Ok(p) = get_conn(&tx, id) {
            tx.execute("DELETE FROM profiles WHERE id = ?1", [id])?;
            deleted.push(p);
        }
    }
    tags::prune(&tx)?;
    tx.commit()?;
    Ok(deleted)
}

pub fn set_favorite(db: &Db, id: &str, favorite: bool) -> AppResult<Profile> {
    let conn = db.conn();
    let n = conn.execute(
        "UPDATE profiles SET favorite = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, favorite as i64, now_ms()],
    )?;
    if n == 0 {
        return Err(AppError::not_found("Connection profile"));
    }
    get_conn(&conn, id)
}

pub fn move_many(db: &Db, ids: &[String], group_id: Option<&str>) -> AppResult<()> {
    let mut conn = db.conn();
    let tx = conn.transaction()?;
    if let Some(g) = group_id {
        groups::get(&tx, g)?;
    }
    let now = now_ms();
    for id in ids {
        tx.execute(
            "UPDATE profiles SET group_id = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, group_id, now],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn mark_connected(db: &Db, id: &str) -> AppResult<()> {
    db.conn().execute(
        "UPDATE profiles SET last_connected_at = ?2 WHERE id = ?1",
        params![id, now_ms()],
    )?;
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SecretFlag {
    Password,
    Passphrase,
}

pub fn set_secret_flag(db: &Db, id: &str, flag: SecretFlag, saved: bool) -> AppResult<()> {
    let column = match flag {
        SecretFlag::Password => "password_saved",
        SecretFlag::Passphrase => "passphrase_saved",
    };
    db.conn().execute(
        &format!("UPDATE profiles SET {column} = ?2 WHERE id = ?1"),
        params![id, saved as i64],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::profile::{SshOptions, TerminalPrefs};
    use crate::domain::GroupInput;

    pub fn sample(name: &str) -> ProfileInput {
        ProfileInput {
            group_id: None,
            name: name.into(),
            protocol: Protocol::Ssh,
            host: "db.internal".into(),
            port: 2222,
            username: "admin".into(),
            auth_method: AuthMethod::Password,
            key_path: None,
            favorite: false,
            notes: "primary".into(),
            color: Some("#22d3ee".into()),
            tags: vec!["prod".into(), "db".into()],
            terminal: TerminalPrefs::default(),
            ssh: SshOptions::default(),
        }
    }

    #[test]
    fn crud_roundtrip() {
        let db = Db::open_in_memory().unwrap();
        let p = create(&db, sample("DB")).unwrap();
        assert_eq!(p.port, 2222);
        assert_eq!(p.tags, vec!["db", "prod"]);
        assert!(!p.password_saved);

        let mut edit = sample("DB primary");
        edit.tags = vec!["prod".into()];
        let out = update(&db, &p.id, edit).unwrap();
        assert_eq!(out.profile.name, "DB primary");
        assert_eq!(out.profile.tags, vec!["prod"]);

        let all = list(&db).unwrap();
        assert_eq!(all.len(), 1);

        let deleted = delete_many(&db, std::slice::from_ref(&p.id)).unwrap();
        assert_eq!(deleted.len(), 1);
        assert!(get(&db, &p.id).is_err());
        // Orphan tags are pruned.
        assert!(tags::list_all(&db.conn()).unwrap().is_empty());
    }

    #[test]
    fn duplicate_does_not_copy_secret_flags() {
        let db = Db::open_in_memory().unwrap();
        let p = create(&db, sample("Web")).unwrap();
        set_secret_flag(&db, &p.id, SecretFlag::Password, true).unwrap();
        let copy = duplicate(&db, &p.id).unwrap();
        assert_eq!(copy.name, "Web (copy)");
        assert!(!copy.password_saved);
        assert_eq!(copy.tags, p.tags);
        assert_ne!(copy.id, p.id);
    }

    #[test]
    fn changing_target_clears_saved_password() {
        let db = Db::open_in_memory().unwrap();
        let p = create(&db, sample("Web")).unwrap();
        set_secret_flag(&db, &p.id, SecretFlag::Password, true).unwrap();
        // Same target: password kept.
        let out = update(&db, &p.id, sample("Renamed")).unwrap();
        assert!(!out.clear_password);
        assert!(out.profile.password_saved);
        // New host: password must be cleared.
        let mut moved = sample("Renamed");
        moved.host = "other.internal".into();
        let out = update(&db, &p.id, moved).unwrap();
        assert!(out.clear_password);
        assert!(!out.profile.password_saved);
    }

    #[test]
    fn favorites_and_moves() {
        let db = Db::open_in_memory().unwrap();
        let g = groups::create(
            &db,
            GroupInput {
                name: "Prod".into(),
                parent_id: None,
                expanded: true,
            },
        )
        .unwrap();
        let a = create(&db, sample("A")).unwrap();
        let b = create(&db, sample("B")).unwrap();
        assert!(set_favorite(&db, &a.id, true).unwrap().favorite);
        move_many(&db, &[a.id.clone(), b.id.clone()], Some(&g.id)).unwrap();
        assert_eq!(
            get(&db, &b.id).unwrap().group_id.as_deref(),
            Some(g.id.as_str())
        );
        // Deleting the group keeps the profiles (moved to root).
        groups::delete(&db, &g.id).unwrap();
        assert_eq!(get(&db, &a.id).unwrap().group_id, None);
    }

    #[test]
    fn create_rejects_missing_group() {
        let db = Db::open_in_memory().unwrap();
        let mut s = sample("X");
        s.group_id = Some(new_id());
        assert!(create(&db, s).is_err());
    }
}
