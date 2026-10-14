// In-memory backend for UI tests (Vitest and Playwright "e2e" mode).
//
// It is NOT used by the application: main.tsx only loads it when Vite runs in
// "e2e" mode, and production builds exclude it. Sessions created here are
// clearly labelled fakes; real protocol behaviour is covered by the Rust
// integration tests (src-tauri/tests).
import type {
  AppError,
  AppSettings,
  ErrorKind,
  Group,
  GroupInput,
  KnownHost,
  OpenRequest,
  Profile,
  ProfileInput,
  SessionEvent,
  Snippet,
  SnippetInput,
} from "@/domain/types";
import { setTransport, type SessionHandlers, type Transport } from "@/lib/ipc";
import { DEFAULT_SETTINGS } from "@/stores/settings";

interface MockSession {
  id: string;
  handlers: SessionHandlers;
  request: OpenRequest;
  pending: Map<string, (response: unknown) => void>;
  closed: boolean;
  line: string;
}

export interface MockState {
  profiles: Profile[];
  groups: Group[];
  snippets: Snippet[];
  knownHosts: KnownHost[];
  settings: AppSettings;
  sessions: Map<string, MockSession>;
  writes: { id: string; data: string }[];
  secrets: Map<string, string>;
}

const enc = new TextEncoder();
const uuid = () => crypto.randomUUID();
const now = () => Date.now();
const err = (kind: ErrorKind, message: string): AppError => ({ kind, message });

const DESTRUCTIVE = ["rm -rf", "shutdown", "reboot", "drop database", "mkfs"];

function profileFrom(input: ProfileInput, existing?: Profile): Profile {
  return {
    id: existing?.id ?? uuid(),
    sortOrder: 0,
    passwordSaved: existing?.passwordSaved ?? false,
    passphraseSaved: existing?.passphraseSaved ?? false,
    lastConnectedAt: existing?.lastConnectedAt ?? null,
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
    ...input,
    keyPath: input.authMethod === "public_key" ? input.keyPath : null,
  };
}

function snippetFrom(input: SnippetInput, existing?: Snippet): Snippet {
  return {
    id: existing?.id ?? uuid(),
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
    potentiallyDestructive: DESTRUCTIVE.some((d) => input.command.toLowerCase().includes(d)),
    ...input,
  };
}

export function createMockBackend(seed: Partial<MockState> = {}) {
  const state: MockState = {
    profiles: [],
    groups: [],
    snippets: [],
    knownHosts: [],
    // DOM renderer so UI tests can read terminal text (WebGL draws to a canvas).
    settings: {
      ...structuredClone(DEFAULT_SETTINGS),
      appearance: { ...DEFAULT_SETTINGS.appearance, language: "english" },
      terminal: { ...DEFAULT_SETTINGS.terminal, webgl: false },
    },
    sessions: new Map(),
    writes: [],
    secrets: new Map(),
    ...seed,
  };

  const emit = (s: MockSession, ev: SessionEvent) => {
    if (!s.closed) s.handlers.onEvent(ev);
  };
  const out = (s: MockSession, text: string) => {
    if (!s.closed) s.handlers.onData(enc.encode(text));
  };
  const ask = (s: MockSession, ev: SessionEvent & { requestId: string }) =>
    new Promise<unknown>((resolve) => {
      s.pending.set(ev.requestId, resolve);
      emit(s, ev);
    });
  const close = (s: MockSession, reason: string) => {
    if (s.closed) return;
    emit(s, { type: "status", state: "disconnected", message: null });
    emit(s, { type: "closed", reason });
    s.closed = true;
    state.sessions.delete(s.id);
  };

  async function runSession(s: MockSession) {
    const r = s.request;
    emit(s, { type: "status", state: "connecting", message: "Connecting" });
    if (r.kind === "local") {
      emit(s, {
        type: "connected",
        info: {
          host: "localhost",
          port: 0,
          username: "tester",
          hostKeyFingerprint: null,
          hostKeyAlgorithm: null,
          connectMs: null,
          shell: "Mock shell",
        },
      });
      emit(s, { type: "status", state: "connected", message: null });
      out(s, "[TermLink UI test backend: no real shell]\r\nmock$ ");
      return;
    }
    const profile =
      r.kind === "profile" ? state.profiles.find((p) => p.id === r.profileId) : undefined;
    const host = r.kind === "quick" ? r.host : (profile?.host ?? "");
    const port = r.kind === "quick" ? r.port : (profile?.port ?? 22);
    const username = r.kind === "quick" ? r.username : (profile?.username ?? "");
    if (host === "unreachable.test") {
      emit(s, { type: "error", error: err("network", `Connection refused by ${host}:${port}`) });
      emit(s, { type: "status", state: "failed", message: "Connection refused" });
      emit(s, { type: "closed", reason: `Connection refused by ${host}:${port}` });
      s.closed = true;
      state.sessions.delete(s.id);
      return;
    }
    const fingerprint = "SHA256:mockmockmockmockmockmockmockmockmockmockmo";
    const known = state.knownHosts.find((k) => k.host === host && k.port === port);
    if (!known || known.fingerprint !== fingerprint) {
      emit(s, { type: "status", state: "verifying", message: "Waiting for host key confirmation" });
      const answer = (await ask(s, {
        type: "hostKeyPrompt",
        requestId: uuid(),
        host,
        port,
        algorithm: "ssh-ed25519",
        fingerprint,
        status: known ? "changed" : "unknown",
        previous: known ? [{ fingerprint: known.fingerprint, algorithm: known.algorithm }] : [],
      })) as { type: string; decision?: string };
      if (
        answer.type !== "hostKey" ||
        answer.decision === "reject" ||
        (known && answer.decision !== "accept_and_save")
      ) {
        emit(s, {
          type: "error",
          error: err(
            "host_key_rejected",
            "The connection was cancelled because the host key was not trusted",
          ),
        });
        emit(s, { type: "status", state: "failed", message: null });
        emit(s, {
          type: "closed",
          reason: "The connection was cancelled because the host key was not trusted",
        });
        s.closed = true;
        state.sessions.delete(s.id);
        return;
      }
      if (answer.decision === "accept_and_save") {
        state.knownHosts = state.knownHosts.filter((k) => !(k.host === host && k.port === port));
        state.knownHosts.push({
          id: state.knownHosts.length + 1,
          host,
          port,
          algorithm: "ssh-ed25519",
          publicKey: "AAAA",
          fingerprint,
          addedAt: now(),
          lastSeenAt: now(),
        });
      }
    }
    emit(s, { type: "status", state: "authenticating", message: "Authenticating" });
    const saved = profile && state.secrets.get(`${profile.id}:password`);
    if (!saved) {
      let error: string | null = null;
      for (;;) {
        const answer = (await ask(s, {
          type: "authPrompt",
          requestId: uuid(),
          kind: "password",
          title: `Password for ${username}@${host}`,
          instructions: "",
          fields: [{ label: "Password", echo: false }],
          canSave: !!profile,
          error,
        })) as { type: string; values?: string[]; save?: boolean };
        if (answer.type !== "credentials") {
          emit(s, { type: "error", error: err("authentication", "Authentication was cancelled") });
          emit(s, { type: "status", state: "failed", message: null });
          emit(s, { type: "closed", reason: "Authentication was cancelled" });
          s.closed = true;
          state.sessions.delete(s.id);
          return;
        }
        if (answer.values?.[0] === "secret") {
          if (answer.save && profile) {
            state.secrets.set(`${profile.id}:password`, "secret");
            profile.passwordSaved = true;
          }
          break;
        }
        error = "Incorrect password, please try again";
      }
    }
    if (profile) profile.lastConnectedAt = now();
    emit(s, {
      type: "connected",
      info: {
        host,
        port,
        username,
        hostKeyFingerprint: fingerprint,
        hostKeyAlgorithm: "ssh-ed25519",
        connectMs: 12,
        shell: null,
      },
    });
    emit(s, { type: "status", state: "connected", message: null });
    out(
      s,
      `[TermLink UI test backend: simulated session, no network connection]\r\n${username}@${host}:~$ `,
    );
  }

  const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
    app_info: () => ({
      version: "0.1.0-test",
      schemaVersion: 1,
      credentialBackend: "Mock credential store",
      platform: "test",
    }),
    settings_get: () => state.settings,
    settings_update: (a) => (state.settings = a.settings as AppSettings),
    local_shells: () => [{ id: "mock", name: "Mock shell", program: "mock" }],
    groups_list: () => state.groups,
    group_create: (a) => {
      const input = a.input as GroupInput;
      const g: Group = { id: uuid(), sortOrder: 0, createdAt: now(), updatedAt: now(), ...input };
      state.groups.push(g);
      return g;
    },
    group_update: (a) => {
      const g = state.groups.find((x) => x.id === a.id);
      if (!g) throw err("not_found", "Group was not found");
      Object.assign(g, a.input, { updatedAt: now() });
      return g;
    },
    group_set_expanded: (a) => {
      const g = state.groups.find((x) => x.id === a.id);
      if (g) g.expanded = a.expanded as boolean;
    },
    group_delete: (a) => {
      const g = state.groups.find((x) => x.id === a.id);
      if (!g) throw err("not_found", "Group was not found");
      for (const c of state.groups) if (c.parentId === g.id) c.parentId = g.parentId;
      for (const p of state.profiles) if (p.groupId === g.id) p.groupId = g.parentId;
      state.groups = state.groups.filter((x) => x.id !== g.id);
    },
    profiles_list: () => state.profiles,
    profile_create: (a) => {
      const input = a.input as ProfileInput;
      if (!input.name.trim()) throw err("validation", "Name is required");
      const p = profileFrom(input);
      state.profiles.push(p);
      return p;
    },
    profile_update: (a) => {
      const idx = state.profiles.findIndex((p) => p.id === a.id);
      if (idx < 0) throw err("not_found", "Connection profile was not found");
      const p = profileFrom(a.input as ProfileInput, state.profiles[idx]);
      state.profiles[idx] = p;
      return p;
    },
    profile_duplicate: (a) => {
      const src = state.profiles.find((p) => p.id === a.id);
      if (!src) throw err("not_found", "Connection profile was not found");
      const p = {
        ...structuredClone(src),
        id: uuid(),
        name: `${src.name} (copy)`,
        favorite: false,
        passwordSaved: false,
        passphraseSaved: false,
      };
      state.profiles.push(p);
      return p;
    },
    profiles_delete: (a) => {
      const ids = new Set(a.ids as string[]);
      const before = state.profiles.length;
      state.profiles = state.profiles.filter((p) => !ids.has(p.id));
      return before - state.profiles.length;
    },
    profile_set_favorite: (a) => {
      const p = state.profiles.find((x) => x.id === a.id);
      if (!p) throw err("not_found", "Connection profile was not found");
      p.favorite = a.favorite as boolean;
      return p;
    },
    profiles_move: (a) => {
      for (const p of state.profiles)
        if ((a.ids as string[]).includes(p.id)) p.groupId = (a.groupId as string | null) ?? null;
    },
    profiles_export: () => ({
      path: "C:\\mock\\termlink-profiles.json",
      profiles: state.profiles.length,
      groups: state.groups.length,
    }),
    profiles_import: () => ({
      groupsCreated: 0,
      profilesImported: 0,
      profilesSkipped: 0,
      issues: [],
    }),
    key_file_pick: () => "C:\\Users\\tester\\.ssh\\id_ed25519",
    save_text_file: () => "C:\\mock\\termlink-terminal.txt",
    credential_set: (a) => {
      state.secrets.set(`${a.profileId}:${a.kind}`, a.secret as string);
      const p = state.profiles.find((x) => x.id === a.profileId);
      if (p) p[a.kind === "password" ? "passwordSaved" : "passphraseSaved"] = true;
    },
    credential_delete: (a) => {
      state.secrets.delete(`${a.profileId}:${a.kind}`);
      const p = state.profiles.find((x) => x.id === a.profileId);
      if (p) p[a.kind === "password" ? "passwordSaved" : "passphraseSaved"] = false;
    },
    known_hosts_list: () => state.knownHosts,
    known_host_delete: (a) => {
      state.knownHosts = state.knownHosts.filter((k) => k.id !== a.id);
    },
    snippets_list: () => state.snippets,
    snippet_create: (a) => {
      const s = snippetFrom(a.input as SnippetInput);
      state.snippets.push(s);
      return s;
    },
    snippet_update: (a) => {
      const idx = state.snippets.findIndex((s) => s.id === a.id);
      if (idx < 0) throw err("not_found", "Snippet was not found");
      const s = snippetFrom(a.input as SnippetInput, state.snippets[idx]);
      state.snippets[idx] = s;
      return s;
    },
    snippet_delete: (a) => {
      state.snippets = state.snippets.filter((s) => s.id !== a.id);
    },
    session_history_list: () => [],
    session_history_clear: () => undefined,
    command_history_list: () => [],
    command_history_record: () => undefined,
    command_history_clear: () => undefined,
    session_write: (a) => {
      const s = state.sessions.get(a.id as string);
      if (!s) throw err("session_closed", "The session is no longer active");
      const data = a.data as string;
      state.writes.push({ id: s.id, data });
      for (const ch of data) {
        if (ch === "\r") {
          const line = s.line;
          s.line = "";
          out(s, "\r\n");
          if (line.trim() === "exit") {
            emit(s, { type: "exit", code: 0, signal: null });
            close(s, "Shell exited with status 0");
            return;
          }
          if (line) out(s, `mock: ${line}\r\n`);
          out(s, "$ ");
        } else if (ch === "\u007f") {
          if (s.line) {
            s.line = s.line.slice(0, -1);
            out(s, "\b \b");
          }
        } else if (ch >= " ") {
          s.line += ch;
          out(s, ch);
        }
      }
    },
    session_resize: () => undefined,
    session_respond: (a) => {
      const s = state.sessions.get(a.id as string);
      const resolve = s?.pending.get(a.requestId as string);
      if (!s || !resolve) throw err("not_found", "Prompt was not found");
      s.pending.delete(a.requestId as string);
      resolve(a.response);
    },
    session_close: (a) => {
      const s = state.sessions.get(a.id as string);
      if (s) close(s, "Disconnected");
    },
    sessions_list: () =>
      [...state.sessions.values()].map((s) => ({
        id: s.id,
        kind: s.request.kind === "local" ? "local" : "ssh",
        label: "",
        profileId: null,
      })),
  };

  const transport: Transport = {
    async invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
      const handler = handlers[cmd];
      if (!handler) throw err("unsupported", `Mock backend does not implement ${cmd}`);
      await Promise.resolve();
      return structuredClone(handler(args)) as T;
    },
    async openSession(request, _cols, _rows, sessionHandlers) {
      const s: MockSession = {
        id: uuid(),
        handlers: sessionHandlers,
        request,
        pending: new Map(),
        closed: false,
        line: "",
      };
      state.sessions.set(s.id, s);
      setTimeout(() => void runSession(s), 10);
      return {
        id: s.id,
        kind: request.kind === "local" ? "local" : "ssh",
        label: request.kind === "quick" ? request.host : "session",
        profileId: request.kind === "profile" ? request.profileId : null,
      };
    },
  };

  return { state, transport };
}

declare global {
  interface Window {
    __termlinkMock?: ReturnType<typeof createMockBackend>;
  }
}

/** Installs the mock backend with demo data (Playwright e2e mode). */
export function installMockBackend() {
  const groupId = uuid();
  const base = (name: string, host: string, extra: Partial<Profile> = {}): Profile => ({
    id: uuid(),
    groupId: null,
    name,
    protocol: "ssh",
    host,
    port: 22,
    username: "deploy",
    authMethod: "password",
    keyPath: null,
    passwordSaved: false,
    passphraseSaved: false,
    favorite: false,
    notes: "",
    color: null,
    tags: [],
    terminal: {},
    ssh: { connectTimeoutSecs: 15, keepaliveIntervalSecs: 30, keepaliveMax: 3, env: [] },
    sortOrder: 0,
    lastConnectedAt: null,
    createdAt: now(),
    updatedAt: now(),
    ...extra,
  });
  const mock = createMockBackend({
    groups: [
      {
        id: groupId,
        parentId: null,
        name: "Production",
        sortOrder: 0,
        expanded: true,
        createdAt: now(),
        updatedAt: now(),
      },
    ],
    profiles: [
      base("web-01", "web-01.example.test", { groupId, tags: ["prod", "web"], favorite: true }),
      base("db-primary", "db.example.test", { groupId, tags: ["prod", "db"], port: 2222 }),
      base("staging", "staging.example.test", { tags: ["staging"] }),
      base("offline box", "unreachable.test"),
    ],
    snippets: [
      snippetFrom({
        name: "Disk usage",
        command: "df -h",
        description: "Filesystem usage",
        category: "Diagnostics",
        tags: ["disk"],
        confirmBeforeRun: false,
      }),
    ],
  });
  setTransport(mock.transport);
  window.__termlinkMock = mock;
}
