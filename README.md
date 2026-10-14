# TermLink

TermLink is a desktop app for SSH terminals and connection management, built with Tauri 2, React 19, Rust and SQLite. Windows comes first; the code is written to port to macOS and Linux.

## Status (milestone 1)

| Area                                                                                                                                  | Status                                              |
| ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| App shell: top bar, nav rail, resizable explorer, status bar, dark and light themes                                                   | Done                                                |
| Connection profiles: CRUD, nested groups, tags, favorites, recents, search, bulk actions, drag-and-drop                               | Done                                                |
| Profile import/export (versioned JSON, never contains secrets)                                                                        | Done                                                |
| Real SSH (russh): password, keyboard-interactive, private key with passphrase, agent (OpenSSH agent and Pageant), keepalive, timeouts | Done (agent auth is not covered by automated tests) |
| Key and agent authentication never fall back to an account password; encrypted keys can still request their key passphrase            | Done                                                |
| Host-key verification: unknown keys need confirmation; a changed key gets a MITM warning and is never trusted silently                | Done                                                |
| Secrets in the OS credential store (Windows Credential Manager); the database stores flags only                                       | Done                                                |
| xterm.js terminal: streaming, resize, search, copy/paste, scrollback, themes, split view, tabs, reconnect                             | Done                                                |
| Vietnamese interface (default, with English option), bundled Noto Sans Mono Latin Extended, Vietnamese IME input                      | Done                                                |
| Local terminal (ConPTY / PTY)                                                                                                         | Done                                                |
| Snippets (explicit Insert/Run only, destructive commands confirmed), command and session history, command palette, settings           | Done                                                |
| SFTP, port forwarding, RDP, VNC                                                                                                       | **Planned.** The UI shows them as unavailable.      |

## Requirements

- Node 22.12+ (required by Vitest 5; tested on 24.21.0)
- Rust stable 1.90+ with the MSVC toolchain (tested on 1.99)
- Windows: Visual Studio C++ build tools plus the **Windows 10/11 SDK**; WebView2 (included with Windows 11)

## Commands

```bash
npm install
npm run app:dev                     # run the desktop app in development mode
npm run app:build                   # release build plus NSIS/MSI installers (src-tauri/target/release/bundle)
npm run typecheck && npm run lint   # type checking and linting
npm test                            # Vitest: unit and component tests
npm run test:e2e                    # Playwright UI tests in Edge, using an in-memory mock backend
npm run test:rust                   # Rust unit tests plus SSH/PTY integration tests (in-process SSH server)
node e2e-app/smoke.mjs              # drives the REAL app over CDP against a local dev SSH server (Windows)
npm run test:app                    # same real-app smoke test via npm
cargo run --manifest-path src-tauri/Cargo.toml --example dev_ssh_server -- 2222   # dev-only test server: tester / termlink-dev
```

On Windows, run `cargo` from PowerShell or cmd. Git Bash puts its own `link.exe` ahead of the MSVC linker.

## Layout

- `src-tauri/src/`
  - `db/`: SQLite access and migrations (`migrations/`)
  - `domain/`: models and validation
  - `credentials.rs`: keyring abstraction
  - `session/`: SSH and local session lifecycle, plus prompts
  - `commands.rs`: the IPC boundary, where all input is validated
  - `portability.rs`: import/export
- `src/`
  - `features/`: connections, terminal, snippets, history, settings, palette
  - `stores/`: Zustand state
  - `lib/ipc.ts`: typed backend API
  - `domain/schemas.ts`: Zod schemas mirroring the Rust validation

See [docs/architecture.md](docs/architecture.md) for module boundaries and session flow, [docs/security.md](docs/security.md) for threat assumptions and known limitations, and [docs/feature-status.md](docs/feature-status.md) for milestone status and verification evidence.

## Security notes

- Passwords and passphrases are stored only in the OS credential store, and only after a successful login. They are zeroized in memory and never logged.
- Private keys stay in their files; a profile stores only the key's path.
- Host-key checking cannot be disabled.
- The webview has least-privilege capabilities: no filesystem or shell access. File dialogs are opened by the backend.
- The CSP is strict.
- Commands are never run automatically. Keystrokes typed into terminals are never recorded.
- Debug builds use a separate data folder and the `TermLink-dev` credential namespace.
- The renderer prototype-freeze option is disabled because it prevented React from starting; the app relies on its restrictive CSP, validated IPC and narrow Tauri capabilities. See the security notes for detail.
