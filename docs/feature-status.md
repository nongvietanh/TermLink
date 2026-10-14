# Feature status

Updated 14 October 2026. “Done” means the code is implemented in the first milestone; validation evidence is listed separately so mock UI coverage is not mistaken for a real protocol test.

## Milestone 1: SSH workspace

| Feature                                                                                     | Status | Evidence / remaining work                                                                                                                        |
| ------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tauri 2 desktop shell, original TermLink icon, dark/light themes, resizable panels          | Done   | Debug desktop app built and launched on Windows.                                                                                                 |
| Profiles, nested groups, tags, favorites, recents, search, CRUD and bulk actions            | Done   | Rust persistence/domain tests and UI tests.                                                                                                      |
| Versioned profile import/export, with no secret values                                      | Done   | Rust import/export and validation tests.                                                                                                         |
| SSH password, keyboard-interactive, private-key/passphrase and agent auth                   | Done   | Real loopback SSH integration covers password, keyboard-interactive and encrypted private key. Agent path needs a dedicated integration test.    |
| Key/agent authentication does not fall back to an account password                          | Done   | Unit test covers the no-fallback policy; encrypted keys still request their separate passphrase.                                                 |
| Host-key trust, changed-key warning, reject, accept once and explicit replacement           | Done   | Rust SSH integration tests plus real app smoke verifies fingerprint before accepting.                                                            |
| Interactive xterm SSH terminal, resize, search, copy/paste, tabs, split panes and reconnect | Done   | Rust SSH stream tests, frontend tests, and real app smoke checks input/output and UTF-8.                                                         |
| Vietnamese UI, bundled Latin Extended terminal font and IME-safe global shortcuts           | Done   | Vitest covers translation and IME shortcut handling; manual IME verification remains platform-specific.                                          |
| Windows Credential Manager storage, delete and reconnect                                    | Done   | Real app smoke saves, reuses and removes a test credential.                                                                                      |
| Local shell                                                                                 | Done   | Real local PowerShell command executed in the app smoke test; PTY lifecycle integration tests.                                                   |
| Linux SSH resource status: CPU, memory, root disk, network rates and host uptime            | Done   | Read-only metrics command over a second SSH channel every 5 seconds; parser and SSH integration tests. Other OS/restricted exec are unavailable. |
| Snippets, command/session history, settings, command palette                                | Done   | Vitest and Playwright UI tests; destructive snippet confirmation is covered in UI tests.                                                         |
| Windows NSIS/MSI package                                                                    | Built  | Latest release build produced a 3.09 MiB NSIS installer and a 4.05 MiB MSI. Artifacts are unsigned; signing is a release pipeline step.          |

## Later milestones

| Feature                                            | Status  | Notes                                                                               |
| -------------------------------------------------- | ------- | ----------------------------------------------------------------------------------- |
| SFTP file browser, transfer queue and cancellation | Planned | UI is labeled unavailable; no fake operations.                                      |
| SSH local/remote/dynamic forwarding                | Planned | UI is labeled unavailable.                                                          |
| RDP and VNC                                        | Planned | No implementation selected; evaluate native-client integration and licensing first. |
| Cross-platform release validation                  | Planned | macOS and Linux need CI and platform-specific credential/PTY checks.                |

## Verification run on Windows

- `cargo test`: 62 unit tests and 18 integration tests passed; one OS-keyring unit test is ignored by default because it writes to the user's keyring.
- `cargo clippy --all-targets`: passed without warnings.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: 54 tests passed.
- `npm run test:e2e`: 8 Playwright UI tests passed in Edge against the explicitly simulated test backend.
- `node e2e-app/smoke.mjs`: passed against the actual Tauri app, Windows Credential Manager, a local russh server and a real PowerShell shell.
- `npx tauri build --debug --no-bundle`: passed.
- `npm run app:build`: passed; both NSIS and MSI installers were generated.
