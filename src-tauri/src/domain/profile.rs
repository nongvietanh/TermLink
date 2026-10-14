use serde::{Deserialize, Serialize};

use super::validation as v;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Protocol {
    Ssh,
    Local,
    Rdp,
    Vnc,
}

impl Protocol {
    pub fn as_str(self) -> &'static str {
        match self {
            Protocol::Ssh => "ssh",
            Protocol::Local => "local",
            Protocol::Rdp => "rdp",
            Protocol::Vnc => "vnc",
        }
    }

    pub fn parse(s: &str) -> AppResult<Self> {
        match s {
            "ssh" => Ok(Protocol::Ssh),
            "local" => Ok(Protocol::Local),
            "rdp" => Ok(Protocol::Rdp),
            "vnc" => Ok(Protocol::Vnc),
            other => Err(AppError::validation(format!("Unknown protocol '{other}'"))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthMethod {
    Password,
    PublicKey,
    Agent,
    KeyboardInteractive,
}

impl AuthMethod {
    pub fn as_str(self) -> &'static str {
        match self {
            AuthMethod::Password => "password",
            AuthMethod::PublicKey => "public_key",
            AuthMethod::Agent => "agent",
            AuthMethod::KeyboardInteractive => "keyboard_interactive",
        }
    }

    pub fn parse(s: &str) -> AppResult<Self> {
        match s {
            "password" => Ok(AuthMethod::Password),
            "public_key" => Ok(AuthMethod::PublicKey),
            "agent" => Ok(AuthMethod::Agent),
            "keyboard_interactive" => Ok(AuthMethod::KeyboardInteractive),
            other => Err(AppError::validation(format!(
                "Unknown authentication method '{other}'"
            ))),
        }
    }
}

/// Per-profile terminal preferences. `None` means "use the global setting".
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct TerminalPrefs {
    pub font_family: Option<String>,
    pub font_size: Option<u32>,
    pub scrollback: Option<u32>,
    pub theme: Option<String>,
    pub term_type: Option<String>,
}

impl TerminalPrefs {
    pub fn validate(mut self) -> AppResult<Self> {
        if let Some(f) = &self.font_family {
            let f = f.trim();
            self.font_family = if f.is_empty() {
                None
            } else {
                Some(v::name("Font family", f, 200)?)
            };
        }
        if let Some(size) = self.font_size {
            if !(8..=40).contains(&size) {
                return Err(AppError::validation("Font size must be between 8 and 40"));
            }
        }
        if let Some(sb) = self.scrollback {
            if sb > 200_000 {
                return Err(AppError::validation(
                    "Scrollback must be at most 200000 lines",
                ));
            }
        }
        if let Some(theme) = &self.theme {
            self.theme = Some(v::name("Theme", theme, 40)?);
        }
        if let Some(term) = &self.term_type {
            let t = term.trim();
            let valid = !t.is_empty()
                && t.len() <= 64
                && t.chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '+'));
            if !valid {
                return Err(AppError::validation("Terminal type is invalid"));
            }
            self.term_type = Some(t.to_string());
        }
        Ok(self)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnvVar {
    pub name: String,
    pub value: String,
}

/// SSH connection options.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct SshOptions {
    /// TCP connect + handshake timeout (time spent waiting on the user is excluded).
    pub connect_timeout_secs: u32,
    /// Interval between keepalive probes; 0 disables keepalives.
    pub keepalive_interval_secs: u32,
    /// Unanswered keepalives before the connection is considered dead.
    pub keepalive_max: u32,
    /// Environment variables requested for the shell (servers may refuse them).
    pub env: Vec<EnvVar>,
}

impl Default for SshOptions {
    fn default() -> Self {
        Self {
            connect_timeout_secs: 15,
            keepalive_interval_secs: 30,
            keepalive_max: 3,
            env: Vec::new(),
        }
    }
}

impl SshOptions {
    pub fn validate(self) -> AppResult<Self> {
        if !(1..=300).contains(&self.connect_timeout_secs) {
            return Err(AppError::validation(
                "Connection timeout must be between 1 and 300 seconds",
            ));
        }
        if self.keepalive_interval_secs > 3600 {
            return Err(AppError::validation(
                "Keepalive interval must be at most 3600 seconds",
            ));
        }
        if !(1..=20).contains(&self.keepalive_max) {
            return Err(AppError::validation(
                "Keepalive attempts must be between 1 and 20",
            ));
        }
        if self.env.len() > 32 {
            return Err(AppError::validation(
                "At most 32 environment variables are allowed",
            ));
        }
        let mut env = Vec::with_capacity(self.env.len());
        for var in self.env {
            if var.value.chars().count() > 1024 || var.value.chars().any(char::is_control) {
                return Err(AppError::validation(format!(
                    "Value of {} must be at most 1024 characters without control characters",
                    var.name
                )));
            }
            env.push(EnvVar {
                name: v::env_var_name(&var.name)?,
                value: var.value,
            });
        }
        Ok(Self { env, ..self })
    }
}

/// A saved connection profile as returned to the UI.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub group_id: Option<String>,
    pub name: String,
    pub protocol: Protocol,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: AuthMethod,
    pub key_path: Option<String>,
    pub password_saved: bool,
    pub passphrase_saved: bool,
    pub favorite: bool,
    pub notes: String,
    pub color: Option<String>,
    pub tags: Vec<String>,
    pub terminal: TerminalPrefs,
    pub ssh: SshOptions,
    pub sort_order: i64,
    pub last_connected_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Fields a user can create or edit. Secrets are never part of this type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProfileInput {
    #[serde(default)]
    pub group_id: Option<String>,
    pub name: String,
    #[serde(default = "default_protocol")]
    pub protocol: Protocol,
    #[serde(default)]
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u32,
    #[serde(default)]
    pub username: String,
    #[serde(default = "default_auth")]
    pub auth_method: AuthMethod,
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
    pub terminal: TerminalPrefs,
    #[serde(default)]
    pub ssh: SshOptions,
}

fn default_protocol() -> Protocol {
    Protocol::Ssh
}
fn default_port() -> u32 {
    22
}
fn default_auth() -> AuthMethod {
    AuthMethod::Password
}

/// A profile input after validation and normalization.
#[derive(Debug, Clone, PartialEq)]
pub struct ValidProfile {
    pub group_id: Option<String>,
    pub name: String,
    pub protocol: Protocol,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: AuthMethod,
    pub key_path: Option<String>,
    pub favorite: bool,
    pub notes: String,
    pub color: Option<String>,
    pub tags: Vec<String>,
    pub terminal: TerminalPrefs,
    pub ssh: SshOptions,
}

impl ProfileInput {
    pub fn validate(self) -> AppResult<ValidProfile> {
        let name = v::name("Name", &self.name, 100)?;
        let group_id = match self.group_id.as_deref() {
            Some(g) if !g.is_empty() => Some(v::id("Group", g)?),
            _ => None,
        };
        let color = match self.color.as_deref() {
            Some(c) if !c.trim().is_empty() => Some(v::color(c)?),
            _ => None,
        };
        let notes = v::text("Notes", &self.notes, 10_000)?;
        let tags = v::tags(&self.tags)?;
        let terminal = self.terminal.validate()?;
        let ssh = self.ssh.validate()?;

        let (host, port, username, auth_method, key_path) = match self.protocol {
            Protocol::Ssh => {
                let key_path = match self.auth_method {
                    AuthMethod::PublicKey => Some(v::local_path(
                        "Private key file",
                        self.key_path.as_deref().unwrap_or(""),
                    )?),
                    _ => None,
                };
                (
                    v::host(&self.host)?,
                    v::port(self.port)?,
                    v::username(&self.username)?,
                    self.auth_method,
                    key_path,
                )
            }
            Protocol::Local => (String::new(), 22, String::new(), AuthMethod::Password, None),
            Protocol::Rdp | Protocol::Vnc => {
                // Profiles can be stored for planned protocols, but they cannot be opened yet.
                let username = if self.username.trim().is_empty() {
                    String::new()
                } else {
                    v::username(&self.username)?
                };
                (
                    v::host(&self.host)?,
                    v::port(self.port)?,
                    username,
                    AuthMethod::Password,
                    None,
                )
            }
        };

        Ok(ValidProfile {
            group_id,
            name,
            protocol: self.protocol,
            host,
            port,
            username,
            auth_method,
            key_path,
            favorite: self.favorite,
            notes,
            color,
            tags,
            terminal,
            ssh,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> ProfileInput {
        ProfileInput {
            group_id: None,
            name: "Web 1".into(),
            protocol: Protocol::Ssh,
            host: "web1.example.com".into(),
            port: 22,
            username: "deploy".into(),
            auth_method: AuthMethod::Password,
            key_path: None,
            favorite: false,
            notes: String::new(),
            color: None,
            tags: vec!["prod".into()],
            terminal: TerminalPrefs::default(),
            ssh: SshOptions::default(),
        }
    }

    #[test]
    fn valid_ssh_profile() {
        let p = input().validate().unwrap();
        assert_eq!(p.host, "web1.example.com");
        assert_eq!(p.key_path, None);
    }

    #[test]
    fn public_key_requires_path() {
        let mut i = input();
        i.auth_method = AuthMethod::PublicKey;
        assert!(i.clone().validate().is_err());
        i.key_path = Some("C:\\Users\\me\\.ssh\\id_ed25519".into());
        assert_eq!(
            i.validate().unwrap().key_path.as_deref(),
            Some("C:\\Users\\me\\.ssh\\id_ed25519")
        );
    }

    #[test]
    fn key_path_dropped_for_password_auth() {
        let mut i = input();
        i.key_path = Some("/tmp/key".into());
        assert_eq!(i.validate().unwrap().key_path, None);
    }

    #[test]
    fn rejects_bad_fields() {
        let mut i = input();
        i.port = 0;
        assert!(i.validate().is_err());
        let mut i = input();
        i.host = "bad host".into();
        assert!(i.validate().is_err());
        let mut i = input();
        i.group_id = Some("../../etc".into());
        assert!(i.validate().is_err());
        let mut i = input();
        i.ssh.connect_timeout_secs = 0;
        assert!(i.validate().is_err());
        let mut i = input();
        i.terminal.font_size = Some(100);
        assert!(i.validate().is_err());
    }

    #[test]
    fn local_profile_ignores_host_fields() {
        let mut i = input();
        i.protocol = Protocol::Local;
        i.host = String::new();
        i.username = String::new();
        let p = i.validate().unwrap();
        assert_eq!(p.host, "");
    }

    #[test]
    fn deserialization_rejects_unknown_fields() {
        let json = r#"{"name":"x","host":"h","username":"u","password":"secret"}"#;
        assert!(serde_json::from_str::<ProfileInput>(json).is_err());
    }
}
