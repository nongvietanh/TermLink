# Security notes

## Threat assumptions

TermLink protects secrets and local data from accidental disclosure, untrusted profile input, malicious remote endpoints and renderer compromise. It does not protect against malware running as the logged-in user, a compromised operating system, a malicious binary distribution, or an administrator with access to the machine. A user who types a command into an SSH shell has authorized that command for the remote account.

## Controls in milestone 1

- Passwords and private-key passphrases are stored in the OS credential store. SQLite stores only secret-presence flags. Secrets are zeroized when practical and omitted from logs, history, profile exports and UI event payloads.
- Private key files remain at their source path. TermLink reads a key only for an explicit connection using that profile. File selection is provided by the native dialog; the webview has no general filesystem permission.
- Public-key and agent profiles never fall back to an account password. If the server accepts the key as one factor but requires another authentication factor, TermLink stops and reports that requirement; an encrypted private key may still request its separate key passphrase.
- Unknown SSH server keys require a visible fingerprint decision. Changed keys show the previously trusted fingerprint and cannot be accepted with the one-time option. The user must explicitly replace the trust record.
- IPC inputs are typed, size-bounded and validated in Rust. The frontend has no shell plugin or filesystem plugin capability. Tauri capabilities grant only app/window/event, zoom and logging operations needed by the UI; native dialogs are opened by backend commands.
- The webview has a restrictive CSP, no remote script source and no arbitrary navigation or network API. Prototype freezing is disabled because it prevents the current React dependency tree from starting; CSP and the narrow IPC capability set remain the primary renderer boundaries.
- Imported profiles use a versioned schema and never contain secret values. Destructive UI actions require a confirmation. Commands from snippets are sent only after an explicit Insert or Run action; configured destructive snippets ask again.
- Keystrokes typed directly into a terminal are not recorded as command history. TermLink records commands only when it explicitly submits them through its snippet/history actions.
- Linux server monitoring uses a compile-time, read-only SSH exec command with no user-controlled interpolation, polls every five seconds, and caps response data before parsing. It reads OS counters and root filesystem capacity only; it does not collect process lists or send telemetry to TermLink services. Exec-disabled or non-Linux servers report metrics as unavailable.
- Debug builds use a separate data directory and `TermLink-dev` credential namespace to isolate development and smoke-test data from release data.

## Data stored locally

The SQLite database contains connection metadata, notes, tags, host public keys and fingerprints, snippets, application settings and user-selected command/session history. It is not encrypted by TermLink. Windows disk encryption and account access controls are recommended for shared or portable machines. Terminal output and SSH payloads are not written to application logs.

## Known limitations

- The first milestone is verified on Windows. macOS and Linux builds, credential-store behavior and local PTYs still need platform CI and manual validation.
- SSH server certificates are currently treated as their presented public key. Certificate-authority trust and revocation are not configured; users should rely on ordinary known-host fingerprints.
- Agent authentication is implemented for supported OpenSSH agent transports and Pageant, but it does not yet have a dedicated automated integration test.
- Resource monitoring currently supports Linux servers with procfs, `cat`, `awk`-free proc counters, and `df`; other server operating systems and SSH accounts whose policy disables exec requests show an unavailable state.
- The app has no SFTP transfer implementation, port forwarding, RDP or VNC support. The UI labels those areas unavailable.
- The local SQLite database is not encrypted. Backups and profile exports may expose host names, usernames, notes and private-key file paths, although they never include saved passwords or passphrases.
- When a user imports a profile that references a private-key path, connecting can cause TermLink to read that selected path. Review imported profiles before connecting.

## Reporting and review

Review changes to `src-tauri/capabilities/default.json`, the CSP, credential handling, host-key decisions and profile import before release. Do not add telemetry or log secret-bearing values. Before distributing a release, build and sign the installer through the project's release process and test upgrade/migration behavior on a copy of user data.
