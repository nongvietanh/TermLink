//! Input validation shared by IPC commands, import, and persistence.
//!
//! The backend never trusts the frontend: every value that arrives over IPC is
//! validated here even though the UI performs the same checks with Zod.

use std::net::{Ipv4Addr, Ipv6Addr};

use crate::error::{AppError, AppResult};

fn has_control(s: &str) -> bool {
    s.chars().any(|c| c.is_control())
}

/// Trims and validates a display name (profile, group, snippet...).
pub fn name(field: &str, value: &str, max: usize) -> AppResult<String> {
    let v = value.trim();
    if v.is_empty() {
        return Err(AppError::validation(format!("{field} is required")));
    }
    if v.chars().count() > max {
        return Err(AppError::validation(format!(
            "{field} must be at most {max} characters"
        )));
    }
    if has_control(v) {
        return Err(AppError::validation(format!(
            "{field} must not contain control characters"
        )));
    }
    Ok(v.to_string())
}

/// Free text (notes, descriptions). Allows newlines and tabs, no other controls.
pub fn text(field: &str, value: &str, max: usize) -> AppResult<String> {
    if value.chars().count() > max {
        return Err(AppError::validation(format!(
            "{field} must be at most {max} characters"
        )));
    }
    if value
        .chars()
        .any(|c| c.is_control() && c != '\n' && c != '\r' && c != '\t')
    {
        return Err(AppError::validation(format!(
            "{field} contains unsupported control characters"
        )));
    }
    Ok(value.to_string())
}

/// Validates a hostname, IPv4 address, or IPv6 address (optionally in brackets).
/// Returns the normalized host (trimmed, brackets removed for IPv6).
pub fn host(value: &str) -> AppResult<String> {
    let v = value.trim();
    if v.is_empty() {
        return Err(AppError::validation("Host is required"));
    }
    if v.len() > 253 {
        return Err(AppError::validation("Host must be at most 253 characters"));
    }
    let unbracketed = v
        .strip_prefix('[')
        .and_then(|s| s.strip_suffix(']'))
        .unwrap_or(v);
    if unbracketed.parse::<Ipv6Addr>().is_ok() {
        return Ok(unbracketed.to_string());
    }
    if v.parse::<Ipv4Addr>().is_ok() {
        return Ok(v.to_string());
    }
    let host = v.strip_suffix('.').unwrap_or(v);
    let valid_labels = host.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    });
    if !valid_labels {
        return Err(AppError::validation(
            "Host must be a valid hostname, IPv4 address, or IPv6 address",
        ));
    }
    Ok(v.to_string())
}

pub fn port(value: u32) -> AppResult<u16> {
    if (1..=65535).contains(&value) {
        Ok(value as u16)
    } else {
        Err(AppError::validation("Port must be between 1 and 65535"))
    }
}

pub fn username(value: &str) -> AppResult<String> {
    let v = value.trim();
    if v.is_empty() {
        return Err(AppError::validation("Username is required"));
    }
    if v.chars().count() > 128 {
        return Err(AppError::validation(
            "Username must be at most 128 characters",
        ));
    }
    if v.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(AppError::validation(
            "Username must not contain spaces or control characters",
        ));
    }
    if v.starts_with('-') {
        return Err(AppError::validation("Username must not start with '-'"));
    }
    Ok(v.to_string())
}

pub fn tag(value: &str) -> AppResult<String> {
    let v = value.trim();
    if v.is_empty() || v.chars().count() > 40 {
        return Err(AppError::validation("Tags must be 1 to 40 characters"));
    }
    if !v
        .chars()
        .all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | ' ' | ':' | '/'))
    {
        return Err(AppError::validation(format!(
            "Tag '{v}' contains unsupported characters"
        )));
    }
    Ok(v.to_string())
}

pub fn tags(values: &[String]) -> AppResult<Vec<String>> {
    if values.len() > 32 {
        return Err(AppError::validation("At most 32 tags are allowed"));
    }
    let mut out: Vec<String> = Vec::with_capacity(values.len());
    for value in values {
        let t = tag(value)?;
        if !out.iter().any(|existing| existing.eq_ignore_ascii_case(&t)) {
            out.push(t);
        }
    }
    Ok(out)
}

/// A local file path chosen by the user (e.g. a private key). The path is only
/// stored; it is opened by the backend when a connection is made.
pub fn local_path(field: &str, value: &str) -> AppResult<String> {
    let v = value.trim();
    if v.is_empty() {
        return Err(AppError::validation(format!("{field} is required")));
    }
    if v.len() > 1024 {
        return Err(AppError::validation(format!("{field} is too long")));
    }
    if has_control(v) {
        return Err(AppError::validation(format!(
            "{field} contains invalid characters"
        )));
    }
    Ok(v.to_string())
}

pub fn env_var_name(value: &str) -> AppResult<String> {
    let mut chars = value.chars();
    let valid = matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
        && value.len() <= 64;
    if valid {
        Ok(value.to_string())
    } else {
        Err(AppError::validation(format!(
            "'{value}' is not a valid environment variable name"
        )))
    }
}

pub fn color(value: &str) -> AppResult<String> {
    let v = value.trim();
    let valid = v.len() == 7 && v.starts_with('#') && v[1..].chars().all(|c| c.is_ascii_hexdigit());
    if valid {
        Ok(v.to_ascii_lowercase())
    } else {
        Err(AppError::validation(
            "Color must be a hex value like #22d3ee",
        ))
    }
}

/// Validates an opaque identifier produced by TermLink (UUID v4 strings).
pub fn id(field: &str, value: &str) -> AppResult<String> {
    uuid::Uuid::parse_str(value)
        .map(|u| u.to_string())
        .map_err(|_| AppError::validation(format!("{field} is not a valid identifier")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_valid_hosts() {
        for h in [
            "example.com",
            "srv-01.internal",
            "localhost",
            "10.0.0.1",
            "::1",
            "[2001:db8::1]",
            "fe80::1",
            "host_with_underscore.lan",
            "example.com.",
        ] {
            assert!(host(h).is_ok(), "{h} should be valid");
        }
        assert_eq!(host("[2001:db8::1]").unwrap(), "2001:db8::1");
        assert_eq!(host("  example.com ").unwrap(), "example.com");
    }

    #[test]
    fn rejects_invalid_hosts() {
        for h in [
            "",
            " ",
            "-oProxyCommand=evil",
            "bad host",
            "host..double",
            "a\u{0}b",
            "exa$mple.com",
            &"a".repeat(254),
            &format!("{}.com", "a".repeat(64)),
        ] {
            assert!(host(h).is_err(), "{h:?} should be invalid");
        }
    }

    #[test]
    fn validates_ports() {
        assert!(port(0).is_err());
        assert!(port(65536).is_err());
        assert_eq!(port(22).unwrap(), 22);
        assert_eq!(port(65535).unwrap(), 65535);
    }

    #[test]
    fn validates_usernames() {
        assert!(username("root").is_ok());
        assert!(username("DOMAIN\\user").is_ok());
        assert!(username("user@realm").is_ok());
        assert!(username("").is_err());
        assert!(username("two words").is_err());
        assert!(username("-l").is_err());
        assert!(username("a\nb").is_err());
    }

    #[test]
    fn dedupes_tags_case_insensitively() {
        let t = tags(&["prod".into(), "PROD".into(), "web".into()]).unwrap();
        assert_eq!(t, vec!["prod", "web"]);
        assert!(tags(&["bad;tag".into()]).is_err());
    }

    #[test]
    fn validates_names_and_text() {
        assert_eq!(name("Name", "  Web  ", 10).unwrap(), "Web");
        assert!(name("Name", "", 10).is_err());
        assert!(name("Name", "x".repeat(11).as_str(), 10).is_err());
        assert!(name("Name", "a\tb", 10).is_err());
        assert!(text("Notes", "line1\nline2", 100).is_ok());
        assert!(text("Notes", "bell\u{7}", 100).is_err());
    }

    #[test]
    fn validates_env_names_colors_ids() {
        assert!(env_var_name("LANG").is_ok());
        assert!(env_var_name("_X1").is_ok());
        assert!(env_var_name("1X").is_err());
        assert!(env_var_name("A-B").is_err());
        assert_eq!(color("#22D3EE").unwrap(), "#22d3ee");
        assert!(color("red").is_err());
        assert!(id("id", "not-a-uuid").is_err());
        assert!(id("id", &uuid::Uuid::new_v4().to_string()).is_ok());
    }
}
