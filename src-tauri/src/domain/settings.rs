//! Application settings. Stored as one JSON document; every field has a
//! default so documents written by older versions keep loading (configuration
//! migration by defaults), and values are range-checked on every update.

use serde::{Deserialize, Serialize};

use super::validation as v;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub version: u32,
    pub appearance: AppearanceSettings,
    pub terminal: TerminalSettings,
    pub ssh: SshDefaults,
    pub local_terminal: LocalTerminalSettings,
    pub safety: SafetySettings,
    pub layout: LayoutSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            version: 1,
            appearance: Default::default(),
            terminal: Default::default(),
            ssh: Default::default(),
            local_terminal: Default::default(),
            safety: Default::default(),
            layout: Default::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ThemeMode {
    #[default]
    Dark,
    Light,
    System,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppearanceSettings {
    pub theme: ThemeMode,
    pub language: UiLanguage,
    pub reduce_motion: bool,
    pub ui_scale: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum UiLanguage {
    English,
    #[default]
    Vietnamese,
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            theme: ThemeMode::Dark,
            language: UiLanguage::Vietnamese,
            reduce_motion: false,
            ui_scale: 100,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum CursorStyle {
    #[default]
    Block,
    Bar,
    Underline,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TerminalSettings {
    pub font_family: String,
    pub font_size: u32,
    pub line_height: f32,
    pub cursor_style: CursorStyle,
    pub cursor_blink: bool,
    pub scrollback: u32,
    pub color_scheme: String,
    pub copy_on_select: bool,
    pub right_click_paste: bool,
    pub term_type: String,
    pub webgl: bool,
}

impl Default for TerminalSettings {
    fn default() -> Self {
        Self {
            font_family: "\"Noto Sans Mono\", \"Cascadia Mono\", \"JetBrains Mono\", Consolas, \"Courier New\", monospace"
                .into(),
            font_size: 14,
            line_height: 1.2,
            cursor_style: CursorStyle::Block,
            cursor_blink: true,
            scrollback: 10_000,
            color_scheme: "auto".into(),
            copy_on_select: false,
            right_click_paste: true,
            term_type: "xterm-256color".into(),
            webgl: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SshDefaults {
    pub connect_timeout_secs: u32,
    pub keepalive_interval_secs: u32,
    pub default_username: String,
}

impl Default for SshDefaults {
    fn default() -> Self {
        Self {
            connect_timeout_secs: 15,
            keepalive_interval_secs: 30,
            default_username: String::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LocalTerminalSettings {
    /// Identifier of a shell detected by the backend (see `local_shells`).
    pub default_shell: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SafetySettings {
    pub confirm_destructive_snippets: bool,
    pub confirm_multiline_paste: bool,
    pub confirm_close_connected_session: bool,
}

impl Default for SafetySettings {
    fn default() -> Self {
        Self {
            confirm_destructive_snippets: true,
            confirm_multiline_paste: true,
            confirm_close_connected_session: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SplitMode {
    #[default]
    Single,
    Horizontal,
    Vertical,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LayoutSettings {
    pub sidebar_collapsed: bool,
    pub explorer_visible: bool,
    pub explorer_width: u32,
    pub status_bar_visible: bool,
    pub split_mode: SplitMode,
    pub last_view: String,
}

impl Default for LayoutSettings {
    fn default() -> Self {
        Self {
            sidebar_collapsed: false,
            explorer_visible: true,
            explorer_width: 280,
            status_bar_visible: true,
            split_mode: SplitMode::Single,
            last_view: "dashboard".into(),
        }
    }
}

impl AppSettings {
    pub fn validate(self) -> AppResult<Self> {
        let s = self;
        if !(80..=200).contains(&s.appearance.ui_scale) {
            return Err(AppError::validation(
                "UI scale must be between 80% and 200%",
            ));
        }
        let t = &s.terminal;
        v::name("Terminal font", &t.font_family, 300)?;
        if !(8..=40).contains(&t.font_size) {
            return Err(AppError::validation("Font size must be between 8 and 40"));
        }
        if !(1.0..=2.5).contains(&t.line_height) {
            return Err(AppError::validation(
                "Line height must be between 1.0 and 2.5",
            ));
        }
        if t.scrollback > 200_000 {
            return Err(AppError::validation(
                "Scrollback must be at most 200000 lines",
            ));
        }
        v::name("Color scheme", &t.color_scheme, 40)?;
        v::name("Terminal type", &t.term_type, 64)?;
        if !(1..=300).contains(&s.ssh.connect_timeout_secs) {
            return Err(AppError::validation(
                "Connection timeout must be between 1 and 300 seconds",
            ));
        }
        if s.ssh.keepalive_interval_secs > 3600 {
            return Err(AppError::validation(
                "Keepalive interval must be at most 3600 seconds",
            ));
        }
        if !s.ssh.default_username.is_empty() {
            v::username(&s.ssh.default_username)?;
        }
        if let Some(shell) = &s.local_terminal.default_shell {
            v::name("Default shell", shell, 64)?;
        }
        if !(160..=800).contains(&s.layout.explorer_width) {
            return Err(AppError::validation(
                "Explorer width must be between 160 and 800 pixels",
            ));
        }
        v::name("Last view", &s.layout.last_view, 40)?;
        Ok(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_valid() {
        AppSettings::default().validate().unwrap();
    }

    #[test]
    fn partial_documents_fill_defaults() {
        let s: AppSettings =
            serde_json::from_str(r#"{"terminal":{"fontSize":16},"futureField":true}"#).unwrap();
        assert_eq!(s.terminal.font_size, 16);
        assert_eq!(s.terminal.scrollback, 10_000);
        assert_eq!(s.appearance.language, UiLanguage::Vietnamese);
        assert!(s.safety.confirm_destructive_snippets);
    }

    #[test]
    fn rejects_out_of_range() {
        let mut s = AppSettings::default();
        s.terminal.font_size = 2;
        assert!(s.validate().is_err());
        let mut s = AppSettings::default();
        s.layout.explorer_width = 5000;
        assert!(s.validate().is_err());
    }
}
