// Types mirroring the Rust backend's serialized models (camelCase).
// Keep in sync with src-tauri/src/domain and src-tauri/src/session.

export type Protocol = "ssh" | "local" | "rdp" | "vnc";
export type AuthMethod = "password" | "public_key" | "agent" | "keyboard_interactive";

export interface TerminalPrefs {
  fontFamily?: string | null;
  fontSize?: number | null;
  scrollback?: number | null;
  theme?: string | null;
  termType?: string | null;
}

export interface EnvVar {
  name: string;
  value: string;
}

export interface SshOptions {
  connectTimeoutSecs: number;
  keepaliveIntervalSecs: number;
  keepaliveMax: number;
  env: EnvVar[];
}

export interface Profile {
  id: string;
  groupId: string | null;
  name: string;
  protocol: Protocol;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  keyPath: string | null;
  passwordSaved: boolean;
  passphraseSaved: boolean;
  favorite: boolean;
  notes: string;
  color: string | null;
  tags: string[];
  terminal: TerminalPrefs;
  ssh: SshOptions;
  sortOrder: number;
  lastConnectedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProfileInput {
  groupId: string | null;
  name: string;
  protocol: Protocol;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  keyPath: string | null;
  favorite: boolean;
  notes: string;
  color: string | null;
  tags: string[];
  terminal: TerminalPrefs;
  ssh: SshOptions;
}

export interface Group {
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  expanded: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface GroupInput {
  name: string;
  parentId: string | null;
  expanded: boolean;
}

export interface Snippet {
  id: string;
  name: string;
  command: string;
  description: string;
  category: string;
  tags: string[];
  confirmBeforeRun: boolean;
  potentiallyDestructive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SnippetInput {
  name: string;
  command: string;
  description: string;
  category: string;
  tags: string[];
  confirmBeforeRun: boolean;
}

export interface KnownHost {
  id: number;
  host: string;
  port: number;
  algorithm: string;
  publicKey: string;
  fingerprint: string;
  addedAt: number;
  lastSeenAt: number | null;
}

export interface SessionHistoryEntry {
  id: number;
  profileId: string | null;
  protocol: string;
  label: string;
  host: string;
  port: number | null;
  username: string;
  status: "connecting" | "connected" | "failed" | "closed";
  error: string | null;
  startedAt: number;
  endedAt: number | null;
}

export type CommandSource = "snippet" | "palette" | "history";

export interface CommandHistoryEntry {
  id: number;
  profileId: string | null;
  targetLabel: string;
  command: string;
  source: CommandSource;
  executedAt: number;
}

export type ThemeMode = "dark" | "light" | "system";
export type UiLanguage = "english" | "vietnamese";
export type CursorStyle = "block" | "bar" | "underline";
export type SplitMode = "single" | "horizontal" | "vertical";

export interface AppSettings {
  version: number;
  appearance: { theme: ThemeMode; language: UiLanguage; reduceMotion: boolean; uiScale: number };
  terminal: {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    cursorStyle: CursorStyle;
    cursorBlink: boolean;
    scrollback: number;
    colorScheme: string;
    copyOnSelect: boolean;
    rightClickPaste: boolean;
    termType: string;
    webgl: boolean;
  };
  ssh: { connectTimeoutSecs: number; keepaliveIntervalSecs: number; defaultUsername: string };
  localTerminal: { defaultShell: string | null };
  safety: {
    confirmDestructiveSnippets: boolean;
    confirmMultilinePaste: boolean;
    confirmCloseConnectedSession: boolean;
  };
  layout: {
    sidebarCollapsed: boolean;
    explorerVisible: boolean;
    explorerWidth: number;
    statusBarVisible: boolean;
    splitMode: SplitMode;
    lastView: string;
  };
}

export interface AppInfo {
  version: string;
  schemaVersion: number;
  credentialBackend: string;
  platform: string;
}

export interface ShellInfo {
  id: string;
  name: string;
  program: string;
}

export type ErrorKind =
  | "validation"
  | "not_found"
  | "conflict"
  | "database"
  | "credential_store"
  | "io"
  | "network"
  | "timeout"
  | "authentication"
  | "host_key_rejected"
  | "session_closed"
  | "cancelled"
  | "unsupported"
  | "internal";

export interface AppError {
  kind: ErrorKind;
  message: string;
}

export interface ImportSummary {
  groupsCreated: number;
  profilesImported: number;
  profilesSkipped: number;
  issues: { index: number; name: string; message: string }[];
}

export interface ExportResult {
  path: string;
  profiles: number;
  groups: number;
}

// --- Sessions -----------------------------------------------------------

export type SessionState =
  "connecting" | "verifying" | "authenticating" | "connected" | "disconnected" | "failed";

export type SessionKind = "ssh" | "local";

export interface SessionSummary {
  id: string;
  kind: SessionKind;
  label: string;
  profileId: string | null;
}

export interface ConnectionInfo {
  host: string;
  port: number;
  username: string;
  hostKeyFingerprint: string | null;
  hostKeyAlgorithm: string | null;
  connectMs: number | null;
  shell: string | null;
}

export interface HostMetrics {
  cpuPercent: number | null;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  networkRxBytesPerSecond: number | null;
  networkTxBytesPerSecond: number | null;
  uptimeSeconds: number;
}

export interface PromptField {
  label: string;
  echo: boolean;
}

export type HostKeyPromptEvent = {
  type: "hostKeyPrompt";
  requestId: string;
  host: string;
  port: number;
  algorithm: string;
  fingerprint: string;
  status: "unknown" | "changed";
  previous: { fingerprint: string; algorithm: string }[];
};

export type AuthPromptEvent = {
  type: "authPrompt";
  requestId: string;
  kind: "password" | "passphrase" | "keyboard_interactive";
  title: string;
  instructions: string;
  fields: PromptField[];
  canSave: boolean;
  error: string | null;
};

export type SessionEvent =
  | { type: "status"; state: SessionState; message: string | null }
  | HostKeyPromptEvent
  | AuthPromptEvent
  | { type: "promptClosed"; requestId: string }
  | { type: "banner"; text: string }
  | { type: "connected"; info: ConnectionInfo }
  | { type: "metrics"; metrics: HostMetrics }
  | { type: "metricsUnavailable" }
  | { type: "exit"; code: number | null; signal: string | null }
  | { type: "error"; error: AppError }
  | { type: "closed"; reason: string };

export type OpenRequest =
  | { kind: "profile"; profileId: string }
  | {
      kind: "quick";
      host: string;
      port: number;
      username: string;
      authMethod: AuthMethod;
      keyPath?: string | null;
    }
  | { kind: "local"; shellId?: string | null };

export type HostKeyDecision = "reject" | "accept_once" | "accept_and_save";

export type PromptResponse =
  | { type: "hostKey"; decision: HostKeyDecision }
  | { type: "credentials"; values: string[]; save: boolean }
  | { type: "cancel" };
