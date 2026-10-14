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
    let id = insert_snippet(&tx, &s)?;
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

/// A built-in starter command note: name, command, description, category, tags.
struct Preset {
    name: &'static str,
    command: &'static str,
    description: &'static str,
    category: &'static str,
    tags: &'static [&'static str],
}

/// Curated, read-only commands shipped so the snippet library is useful out of
/// the box. All are non-destructive; a copy-only workflow never changes the
/// server. Commands and names stay in English because a shell is language
/// neutral; the surrounding UI is translated.
const PRESETS: &[Preset] = &[
    Preset {
        name: "System overview",
        command: "uname -a; uptime; whoami",
        description: "Kernel, uptime, load average and current user",
        category: "System",
        tags: &["system"],
    },
    Preset {
        name: "CPU & load snapshot",
        command: "top -bn1 | head -n 20",
        description: "One-shot process and load snapshot",
        category: "System",
        tags: &["cpu", "system"],
    },
    Preset {
        name: "Memory usage",
        command: "free -h",
        description: "RAM and swap usage in human units",
        category: "System",
        tags: &["memory"],
    },
    Preset {
        name: "OS release",
        command: "cat /etc/os-release",
        description: "Distribution name and version",
        category: "System",
        tags: &["system"],
    },
    Preset {
        name: "Disk free",
        command: "df -h",
        description: "Free space per mounted filesystem",
        category: "Disk",
        tags: &["disk"],
    },
    Preset {
        name: "Largest directories",
        command: "du -ahx / 2>/dev/null | sort -rh | head -n 20",
        description: "Twenty biggest paths on the root filesystem",
        category: "Disk",
        tags: &["disk"],
    },
    Preset {
        name: "Inode usage",
        command: "df -i",
        description: "Inode consumption per filesystem",
        category: "Disk",
        tags: &["disk"],
    },
    Preset {
        name: "Listening ports",
        command: "ss -tulpn",
        description: "TCP/UDP sockets that are listening",
        category: "Network",
        tags: &["network"],
    },
    Preset {
        name: "Network interfaces",
        command: "ip -brief address",
        description: "Interfaces and their IP addresses",
        category: "Network",
        tags: &["network"],
    },
    Preset {
        name: "Established connections",
        command: "ss -tan state established",
        description: "Currently established TCP connections",
        category: "Network",
        tags: &["network"],
    },
    Preset {
        name: "Public IP address",
        command: "curl -s ifconfig.me; echo",
        description: "Outbound public IP as seen by the internet",
        category: "Network",
        tags: &["network"],
    },
    Preset {
        name: "Top processes by memory",
        command: "ps aux --sort=-%mem | head -n 15",
        description: "Fifteen most memory-hungry processes",
        category: "Processes",
        tags: &["processes"],
    },
    Preset {
        name: "Top processes by CPU",
        command: "ps aux --sort=-%cpu | head -n 15",
        description: "Fifteen most CPU-hungry processes",
        category: "Processes",
        tags: &["cpu", "processes"],
    },
    Preset {
        name: "Logged-in users",
        command: "w",
        description: "Who is logged in and what they are running",
        category: "Processes",
        tags: &["users"],
    },
    Preset {
        name: "Failed services",
        command: "systemctl --failed",
        description: "systemd units that failed to start",
        category: "Services",
        tags: &["systemd"],
    },
    Preset {
        name: "Recent system log",
        command: "journalctl -n 100 --no-pager",
        description: "Last 100 journal lines",
        category: "Services",
        tags: &["logs"],
    },
    Preset {
        name: "Docker containers",
        command: "docker ps -a",
        description: "All containers and their state",
        category: "Docker",
        tags: &["docker"],
    },
    Preset {
        name: "Docker disk usage",
        command: "docker system df",
        description: "Space used by images, containers and volumes",
        category: "Docker",
        tags: &["docker"],
    },
];

fn preset_input(p: &Preset) -> SnippetInput {
    SnippetInput {
        name: p.name.into(),
        command: p.command.into(),
        description: p.description.into(),
        category: p.category.into(),
        tags: p.tags.iter().map(|t| (*t).to_string()).collect(),
        confirm_before_run: false,
    }
}

const SEEDED_KEY: &str = "snippets_seeded";

/// Inserts the starter snippets the first time TermLink runs. The one-time flag
/// lives in the settings table, so deleting the starters never brings them back
/// on the next launch.
pub fn seed_defaults_once(db: &Db) -> AppResult<()> {
    let mut conn = db.conn();
    let already: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            [SEEDED_KEY],
            |r| r.get(0),
        )
        .optional()?;
    if already.is_some() {
        return Ok(());
    }
    let tx = conn.transaction()?;
    for preset in PRESETS {
        insert_snippet(&tx, &preset_input(preset).validate()?)?;
    }
    tx.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?1, '1', ?2)
         ON CONFLICT (key) DO UPDATE SET value = '1', updated_at = excluded.updated_at",
        params![SEEDED_KEY, now_ms()],
    )?;
    tx.commit()?;
    Ok(())
}

/// Re-adds any starter snippets the user is missing (matched by name), without
/// touching ones they have customised. Returns the full, updated list.
pub fn restore_defaults(db: &Db) -> AppResult<Vec<Snippet>> {
    {
        let mut conn = db.conn();
        let existing: std::collections::HashSet<String> = conn
            .prepare("SELECT name FROM snippets")?
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<Result<_, _>>()?;
        let tx = conn.transaction()?;
        for preset in PRESETS {
            if !existing.contains(preset.name) {
                insert_snippet(&tx, &preset_input(preset).validate()?)?;
            }
        }
        tx.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?1, '1', ?2)
             ON CONFLICT (key) DO UPDATE SET value = '1', updated_at = excluded.updated_at",
            params![SEEDED_KEY, now_ms()],
        )?;
        tx.commit()?;
    }
    list(db)
}

/// Inserts one validated snippet and its tags inside an open transaction and
/// returns the new id.
fn insert_snippet(tx: &rusqlite::Transaction<'_>, s: &SnippetInput) -> AppResult<String> {
    let id = new_id();
    tx.execute(
        "INSERT INTO snippets (id, name, command, description, category, confirm_before_run, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![id, s.name, s.command, s.description, s.category, s.confirm_before_run as i64, now_ms()],
    )?;
    tags::set_tags(tx, TagOwner::Snippet, &id, &s.tags)?;
    Ok(id)
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

    #[test]
    fn seeds_defaults_only_once() {
        let db = Db::open_in_memory().unwrap();
        seed_defaults_once(&db).unwrap();
        let seeded = list(&db).unwrap();
        assert_eq!(seeded.len(), PRESETS.len());
        assert!(seeded.iter().all(|s| !s.potentially_destructive));
        // Deleting a starter and reseeding must not bring it back.
        delete(&db, &seeded[0].id).unwrap();
        seed_defaults_once(&db).unwrap();
        assert_eq!(list(&db).unwrap().len(), PRESETS.len() - 1);
    }

    #[test]
    fn restore_defaults_fills_missing_without_duplicating() {
        let db = Db::open_in_memory().unwrap();
        seed_defaults_once(&db).unwrap();
        let before = list(&db).unwrap();
        delete(&db, &before[0].id).unwrap();
        delete(&db, &before[1].id).unwrap();
        let restored = restore_defaults(&db).unwrap();
        assert_eq!(restored.len(), PRESETS.len());
        // Running it again adds nothing.
        assert_eq!(restore_defaults(&db).unwrap().len(), PRESETS.len());
    }
}
