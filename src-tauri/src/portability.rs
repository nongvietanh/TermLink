//! Profile import and export.
//!
//! The export format never contains secrets: no passwords, passphrases or key
//! material (only key *paths*), and no trusted host keys. Imports are parsed
//! strictly, size-limited, and every profile is validated exactly like one
//! created in the UI. Imported data is never executed.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::db::{groups, now_ms, profiles, Db};
use crate::domain::profile::ProfileInput;
use crate::domain::GroupInput;
use crate::error::{AppError, AppResult};

pub const FORMAT: &str = "termlink-profiles";
pub const VERSION: u32 = 1;
pub const MAX_IMPORT_BYTES: usize = 5 * 1024 * 1024;
const MAX_ITEMS: usize = 10_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportGroup {
    pub id: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportProfile {
    /// Reference to an `ExportGroup::id` in the same document.
    #[serde(default)]
    pub group_ref: Option<String>,
    pub name: String,
    #[serde(default = "ssh")]
    pub protocol: crate::domain::profile::Protocol,
    #[serde(default)]
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u32,
    #[serde(default)]
    pub username: String,
    #[serde(default = "password")]
    pub auth_method: crate::domain::profile::AuthMethod,
    #[serde(default)]
    pub key_path: Option<String>,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub terminal: crate::domain::profile::TerminalPrefs,
    #[serde(default)]
    pub ssh: crate::domain::profile::SshOptions,
}

fn ssh() -> crate::domain::profile::Protocol {
    crate::domain::profile::Protocol::Ssh
}
fn password() -> crate::domain::profile::AuthMethod {
    crate::domain::profile::AuthMethod::Password
}
fn default_port() -> u32 {
    22
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportDocument {
    pub format: String,
    pub version: u32,
    pub exported_at: i64,
    #[serde(default)]
    pub groups: Vec<ExportGroup>,
    #[serde(default)]
    pub profiles: Vec<ExportProfile>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportIssue {
    pub index: usize,
    pub name: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub groups_created: usize,
    pub profiles_imported: usize,
    pub profiles_skipped: usize,
    pub issues: Vec<ImportIssue>,
}

pub fn export(db: &Db) -> AppResult<ExportDocument> {
    let groups = groups::list(db)?
        .into_iter()
        .map(|g| ExportGroup {
            id: g.id,
            parent_id: g.parent_id,
            name: g.name,
        })
        .collect();
    let profiles = profiles::list(db)?
        .into_iter()
        .map(|p| ExportProfile {
            group_ref: p.group_id,
            name: p.name,
            protocol: p.protocol,
            host: p.host,
            port: p.port.into(),
            username: p.username,
            auth_method: p.auth_method,
            key_path: p.key_path,
            favorite: p.favorite,
            notes: p.notes,
            color: p.color,
            tags: p.tags,
            terminal: p.terminal,
            ssh: p.ssh,
        })
        .collect();
    Ok(ExportDocument {
        format: FORMAT.into(),
        version: VERSION,
        exported_at: now_ms(),
        groups,
        profiles,
    })
}

pub fn parse(bytes: &[u8]) -> AppResult<ExportDocument> {
    if bytes.len() > MAX_IMPORT_BYTES {
        return Err(AppError::validation("The import file is larger than 5 MB"));
    }
    let doc: ExportDocument = serde_json::from_slice(bytes).map_err(|e| {
        AppError::validation(format!("The file is not a valid TermLink export: {e}"))
    })?;
    if doc.format != FORMAT {
        return Err(AppError::validation(
            "The file is not a TermLink profile export",
        ));
    }
    if doc.version == 0 || doc.version > VERSION {
        return Err(AppError::validation(format!(
            "Unsupported export version {} (this build supports up to {VERSION})",
            doc.version
        )));
    }
    if doc.groups.len() > MAX_ITEMS || doc.profiles.len() > MAX_ITEMS {
        return Err(AppError::validation(
            "The import file contains too many items",
        ));
    }
    Ok(doc)
}

/// Imports a document. Groups are created fresh (new ids), and profiles that
/// match an existing profile (same name, host, port and username) are skipped.
pub fn import(db: &Db, doc: ExportDocument) -> AppResult<ImportSummary> {
    let mut summary = ImportSummary {
        groups_created: 0,
        profiles_imported: 0,
        profiles_skipped: 0,
        issues: Vec::new(),
    };

    // Create groups parents-first, mapping document ids to new ids.
    let known_ids: HashSet<&str> = doc.groups.iter().map(|g| g.id.as_str()).collect();
    let mut id_map: HashMap<String, String> = HashMap::new();
    let mut pending: Vec<&ExportGroup> = doc.groups.iter().collect();
    while !pending.is_empty() {
        let before = pending.len();
        let mut rest = Vec::new();
        for g in pending {
            let parent = match g.parent_id.as_deref() {
                None => None,
                Some(p) if !known_ids.contains(p) => None, // dangling parent: import at root
                Some(p) => match id_map.get(p) {
                    Some(new) => Some(new.clone()),
                    None => {
                        rest.push(g);
                        continue;
                    }
                },
            };
            match groups::create(
                db,
                GroupInput {
                    name: g.name.clone(),
                    parent_id: parent,
                    expanded: true,
                },
            ) {
                Ok(created) => {
                    id_map.insert(g.id.clone(), created.id);
                    summary.groups_created += 1;
                }
                Err(e) => summary.issues.push(ImportIssue {
                    index: 0,
                    name: g.name.clone(),
                    message: format!("Group skipped: {}", e.message),
                }),
            }
        }
        if rest.len() == before {
            // Cycle in parent references: remaining groups cannot be placed.
            for g in rest {
                summary.issues.push(ImportIssue {
                    index: 0,
                    name: g.name.clone(),
                    message: "Group skipped: circular parent reference".into(),
                });
            }
            break;
        }
        pending = rest;
    }

    let existing: HashSet<(String, String, u16, String)> = profiles::list(db)?
        .into_iter()
        .map(|p| {
            (
                p.name.to_lowercase(),
                p.host.to_lowercase(),
                p.port,
                p.username,
            )
        })
        .collect();

    for (index, item) in doc.profiles.into_iter().enumerate() {
        let f = item;
        let name = f.name.clone();
        let input = ProfileInput {
            group_id: f.group_ref.and_then(|r| id_map.get(&r).cloned()),
            name: f.name,
            protocol: f.protocol,
            host: f.host,
            port: f.port,
            username: f.username,
            auth_method: f.auth_method,
            key_path: f.key_path,
            favorite: f.favorite,
            notes: f.notes,
            color: f.color,
            tags: f.tags,
            terminal: f.terminal,
            ssh: f.ssh,
        };
        let valid = match input.validate() {
            Ok(v) => v,
            Err(e) => {
                summary.issues.push(ImportIssue {
                    index,
                    name,
                    message: e.message,
                });
                continue;
            }
        };
        let key = (
            valid.name.to_lowercase(),
            valid.host.to_lowercase(),
            valid.port,
            valid.username.clone(),
        );
        if existing.contains(&key) {
            summary.profiles_skipped += 1;
            continue;
        }
        match profiles::create_valid(db, &valid) {
            Ok(_) => summary.profiles_imported += 1,
            Err(e) => summary.issues.push(ImportIssue {
                index,
                name,
                message: e.message,
            }),
        }
    }
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::profiles::SecretFlag;
    use crate::domain::profile::{AuthMethod, Protocol, SshOptions, TerminalPrefs};

    fn seed(db: &Db) {
        let g = groups::create(
            db,
            GroupInput {
                name: "Prod".into(),
                parent_id: None,
                expanded: true,
            },
        )
        .unwrap();
        let sub = groups::create(
            db,
            GroupInput {
                name: "Web".into(),
                parent_id: Some(g.id.clone()),
                expanded: true,
            },
        )
        .unwrap();
        let p = profiles::create(
            db,
            ProfileInput {
                group_id: Some(sub.id),
                name: "web-1".into(),
                protocol: Protocol::Ssh,
                host: "web1.example.com".into(),
                port: 22,
                username: "deploy".into(),
                auth_method: AuthMethod::PublicKey,
                key_path: Some("~/.ssh/id_ed25519".into()),
                favorite: true,
                notes: String::new(),
                color: None,
                tags: vec!["prod".into()],
                terminal: TerminalPrefs::default(),
                ssh: SshOptions::default(),
            },
        )
        .unwrap();
        profiles::set_secret_flag(db, &p.id, SecretFlag::Passphrase, true).unwrap();
    }

    #[test]
    fn export_import_roundtrip() {
        let src = Db::open_in_memory().unwrap();
        seed(&src);
        let doc = export(&src).unwrap();
        let json = serde_json::to_vec(&doc).unwrap();
        let text = String::from_utf8(json.clone()).unwrap();
        assert!(
            !text.contains("passphraseSaved"),
            "secret flags must not be exported"
        );

        let dst = Db::open_in_memory().unwrap();
        let summary = import(&dst, parse(&json).unwrap()).unwrap();
        assert_eq!(summary.groups_created, 2);
        assert_eq!(summary.profiles_imported, 1);
        assert!(summary.issues.is_empty());
        let imported = &profiles::list(&dst).unwrap()[0];
        assert!(!imported.passphrase_saved);
        assert_eq!(imported.key_path.as_deref(), Some("~/.ssh/id_ed25519"));
        let group = groups::get(&dst.conn(), imported.group_id.as_ref().unwrap()).unwrap();
        assert_eq!(group.name, "Web");
        assert!(group.parent_id.is_some());

        // Importing again skips duplicates.
        let again = import(&dst, parse(&json).unwrap()).unwrap();
        assert_eq!(again.profiles_skipped, 1);
        assert_eq!(again.profiles_imported, 0);
    }

    #[test]
    fn rejects_foreign_or_malformed_documents() {
        assert!(parse(b"not json").is_err());
        assert!(parse(br#"{"format":"other","version":1,"exportedAt":0}"#).is_err());
        assert!(parse(br#"{"format":"termlink-profiles","version":99,"exportedAt":0}"#).is_err());
        // Unknown fields such as smuggled secrets are rejected.
        assert!(parse(
            br#"{"format":"termlink-profiles","version":1,"exportedAt":0,"profiles":[{"name":"x","host":"h","username":"u","password":"p"}]}"#
        )
        .is_err());
        let big = vec![b' '; MAX_IMPORT_BYTES + 1];
        assert!(parse(&big).is_err());
    }

    #[test]
    fn invalid_profiles_are_reported_not_imported() {
        let json = br#"{"format":"termlink-profiles","version":1,"exportedAt":0,
            "profiles":[{"name":"ok","host":"a.example","username":"u"},
                        {"name":"bad","host":"-oProxyCommand=x","username":"u"}]}"#;
        let db = Db::open_in_memory().unwrap();
        let s = import(&db, parse(json).unwrap()).unwrap();
        assert_eq!(s.profiles_imported, 1);
        assert_eq!(s.issues.len(), 1);
        assert_eq!(s.issues[0].name, "bad");
    }

    #[test]
    fn cyclic_groups_do_not_hang() {
        let json = br#"{"format":"termlink-profiles","version":1,"exportedAt":0,
            "groups":[{"id":"a","parentId":"b","name":"A"},{"id":"b","parentId":"a","name":"B"}]}"#;
        let db = Db::open_in_memory().unwrap();
        let s = import(&db, parse(json).unwrap()).unwrap();
        assert_eq!(s.groups_created, 0);
        assert_eq!(s.issues.len(), 2);
    }
}
