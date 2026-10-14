//! Detection of local shells.
//!
//! The frontend can only choose a shell by the `id` of an entry detected here;
//! it can never supply an arbitrary program path or command line.

use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShellInfo {
    pub id: String,
    pub name: String,
    pub program: String,
    #[serde(skip)]
    pub args: Vec<String>,
}

fn which(program: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(program))
        .find(|candidate| candidate.is_file())
}

fn push(list: &mut Vec<ShellInfo>, id: &str, name: &str, program: &Path, args: &[&str]) {
    if program.is_file() && !list.iter().any(|s| s.id == id) {
        list.push(ShellInfo {
            id: id.into(),
            name: name.into(),
            program: program.to_string_lossy().into_owned(),
            args: args.iter().map(|s| s.to_string()).collect(),
        });
    }
}

#[cfg(windows)]
pub fn detect() -> Vec<ShellInfo> {
    let mut list = Vec::new();
    let system_root = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    let system32 = system_root.join("System32");

    let pwsh = which("pwsh.exe")
        .or_else(|| Some(PathBuf::from(r"C:\Program Files\PowerShell\7\pwsh.exe")));
    if let Some(p) = pwsh {
        push(&mut list, "pwsh", "PowerShell 7", &p, &["-NoLogo"]);
    }
    push(
        &mut list,
        "powershell",
        "Windows PowerShell",
        &system32.join(r"WindowsPowerShell\v1.0\powershell.exe"),
        &["-NoLogo"],
    );
    push(
        &mut list,
        "cmd",
        "Command Prompt",
        &system32.join("cmd.exe"),
        &[],
    );
    if let Some(git) = which("git.exe") {
        // ...\Git\cmd\git.exe -> ...\Git\bin\bash.exe
        if let Some(root) = git.parent().and_then(Path::parent) {
            push(
                &mut list,
                "git-bash",
                "Git Bash",
                &root.join(r"bin\bash.exe"),
                &["--login", "-i"],
            );
        }
    }
    push(
        &mut list,
        "git-bash",
        "Git Bash",
        Path::new(r"C:\Program Files\Git\bin\bash.exe"),
        &["--login", "-i"],
    );
    push(&mut list, "wsl", "WSL", &system32.join("wsl.exe"), &[]);
    list
}

#[cfg(unix)]
pub fn detect() -> Vec<ShellInfo> {
    let mut list = Vec::new();
    if let Some(shell) = std::env::var_os("SHELL") {
        let p = PathBuf::from(&shell);
        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "shell".into());
        push(
            &mut list,
            "login",
            &format!("Login shell ({name})"),
            &p,
            &["-l"],
        );
    }
    for (id, name, path) in [
        ("zsh", "zsh", "/bin/zsh"),
        ("bash", "bash", "/bin/bash"),
        ("fish", "fish", "/usr/bin/fish"),
        ("sh", "sh", "/bin/sh"),
    ] {
        push(&mut list, id, name, Path::new(path), &[]);
    }
    list
}

/// Resolves a shell id, falling back to the first detected shell.
pub fn resolve(id: Option<&str>) -> Option<ShellInfo> {
    let shells = detect();
    match id {
        Some(id) => shells.into_iter().find(|s| s.id == id),
        None => shells.into_iter().next(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_at_least_one_shell() {
        let shells = detect();
        assert!(!shells.is_empty(), "no local shell detected");
        let ids: Vec<_> = shells.iter().map(|s| &s.id).collect();
        let mut dedup = ids.clone();
        dedup.dedup();
        assert_eq!(ids.len(), dedup.len(), "shell ids must be unique");
    }

    #[test]
    fn resolve_unknown_id_returns_none() {
        assert!(resolve(Some("definitely-not-a-shell")).is_none());
        assert!(resolve(None).is_some());
    }
}
