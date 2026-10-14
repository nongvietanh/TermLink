//! Domain models shared by persistence, IPC commands and protocol adapters.

pub mod profile;
pub mod settings;
pub mod validation;

use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use validation as v;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub sort_order: i64,
    pub expanded: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupInput {
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default = "default_true")]
    pub expanded: bool,
}

fn default_true() -> bool {
    true
}

impl GroupInput {
    pub fn validate(self) -> AppResult<GroupInput> {
        Ok(GroupInput {
            name: v::name("Group name", &self.name, 100)?,
            parent_id: match self.parent_id.as_deref() {
                Some(p) if !p.is_empty() => Some(v::id("Parent group", p)?),
                _ => None,
            },
            expanded: self.expanded,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snippet {
    pub id: String,
    pub name: String,
    pub command: String,
    pub description: String,
    pub category: String,
    pub tags: Vec<String>,
    pub confirm_before_run: bool,
    /// Computed: the command matches a known destructive pattern.
    pub potentially_destructive: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SnippetInput {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub confirm_before_run: bool,
}

impl SnippetInput {
    pub fn validate(self) -> AppResult<SnippetInput> {
        let command = v::text("Command", &self.command, 20_000)?;
        if command.trim().is_empty() {
            return Err(crate::error::AppError::validation("Command is required"));
        }
        let category = if self.category.trim().is_empty() {
            String::new()
        } else {
            v::name("Category", &self.category, 60)?
        };
        Ok(SnippetInput {
            name: v::name("Snippet name", &self.name, 100)?,
            command,
            description: v::text("Description", &self.description, 2_000)?,
            category,
            tags: v::tags(&self.tags)?,
            confirm_before_run: self.confirm_before_run,
        })
    }
}

/// Heuristic detection of commands that commonly destroy data or disrupt a
/// system. It is a safety net that adds a confirmation step, not a security
/// boundary: it can be bypassed and has false positives.
pub fn is_potentially_destructive(command: &str) -> bool {
    let c = command.to_ascii_lowercase();
    const PATTERNS: &[&str] = &[
        "rm -rf",
        "rm -fr",
        "rm -r ",
        "rm --recursive",
        "mkfs",
        "dd if=",
        "dd of=",
        "> /dev/sd",
        "shutdown",
        "reboot",
        "poweroff",
        "halt",
        "init 0",
        "init 6",
        ":(){",
        "chmod -r 777",
        "chown -r",
        "drop database",
        "drop table",
        "truncate table",
        "kill -9 -1",
        "killall",
        "systemctl stop",
        "format c:",
        "remove-item -recurse",
        "del /s",
        "rd /s",
        "git push --force",
        "git push -f",
        "git reset --hard",
        "docker system prune",
        "kubectl delete",
        "terraform destroy",
        "wipefs",
        "fdisk",
        "parted",
    ];
    PATTERNS.iter().any(|p| c.contains(p))
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownHost {
    pub id: i64,
    pub host: String,
    pub port: u16,
    pub algorithm: String,
    pub public_key: String,
    pub fingerprint: String,
    pub added_at: i64,
    pub last_seen_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionHistoryEntry {
    pub id: i64,
    pub profile_id: Option<String>,
    pub protocol: String,
    pub label: String,
    pub host: String,
    pub port: Option<u16>,
    pub username: String,
    pub status: String,
    pub error: Option<String>,
    pub started_at: i64,
    pub ended_at: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandSource {
    Snippet,
    Palette,
    History,
}

impl CommandSource {
    pub fn as_str(self) -> &'static str {
        match self {
            CommandSource::Snippet => "snippet",
            CommandSource::Palette => "palette",
            CommandSource::History => "history",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandHistoryEntry {
    pub id: i64,
    pub profile_id: Option<String>,
    pub target_label: String,
    pub command: String,
    pub source: String,
    pub executed_at: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_destructive_commands() {
        assert!(is_potentially_destructive("sudo rm -rf /var/www"));
        assert!(is_potentially_destructive("DROP DATABASE prod;"));
        assert!(is_potentially_destructive("sudo reboot"));
        assert!(!is_potentially_destructive("ls -la"));
        assert!(!is_potentially_destructive("df -h"));
    }

    #[test]
    fn snippet_validation() {
        let ok = SnippetInput {
            name: "Disk".into(),
            command: "df -h".into(),
            description: String::new(),
            category: "  ".into(),
            tags: vec![],
            confirm_before_run: false,
        }
        .validate()
        .unwrap();
        assert_eq!(ok.category, "");
        let bad = SnippetInput {
            name: "Empty".into(),
            command: "   ".into(),
            description: String::new(),
            category: String::new(),
            tags: vec![],
            confirm_before_run: false,
        };
        assert!(bad.validate().is_err());
    }
}
