// Typed bridge to the Rust backend.
//
// All backend access goes through `api`. The transport is pluggable so that
// UI tests can run against an in-memory mock (see src/test/mock-backend.ts);
// production builds always use the Tauri transport.
import { Channel, invoke } from "@tauri-apps/api/core";

import type {
  AppError,
  AppInfo,
  AppSettings,
  CommandHistoryEntry,
  CommandSource,
  ExportResult,
  Group,
  GroupInput,
  ImportSummary,
  KnownHost,
  OpenRequest,
  Profile,
  ProfileInput,
  PromptResponse,
  SessionEvent,
  SessionHistoryEntry,
  SessionSummary,
  ShellInfo,
  Snippet,
  SnippetInput,
} from "@/domain/types";

export interface SessionHandlers {
  onData: (bytes: Uint8Array) => void;
  onEvent: (event: SessionEvent) => void;
}

export interface Transport {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  openSession(
    request: OpenRequest,
    cols: number,
    rows: number,
    handlers: SessionHandlers,
  ): Promise<SessionSummary>;
}

const tauriTransport: Transport = {
  invoke: (cmd, args) => invoke(cmd, args),
  async openSession(request, cols, rows, handlers) {
    const onData = new Channel<ArrayBuffer>();
    onData.onmessage = (buf) => handlers.onData(new Uint8Array(buf));
    const onEvent = new Channel<SessionEvent>();
    onEvent.onmessage = (ev) => handlers.onEvent(ev);
    return invoke<SessionSummary>("session_open", { request, cols, rows, onData, onEvent });
  },
};

let transport: Transport = tauriTransport;

export function setTransport(t: Transport) {
  transport = t;
}

export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    "message" in value &&
    typeof (value as AppError).message === "string"
  );
}

/** Normalizes anything thrown by the IPC layer into an AppError. */
export function toAppError(err: unknown): AppError {
  if (isAppError(err)) return err;
  if (err instanceof Error) return { kind: "internal", message: err.message };
  if (typeof err === "string") return { kind: "internal", message: err };
  return { kind: "internal", message: "An unexpected error occurred" };
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await transport.invoke<T>(cmd, args);
  } catch (err) {
    throw toAppError(err);
  }
}

export const api = {
  appInfo: () => call<AppInfo>("app_info"),

  groupsList: () => call<Group[]>("groups_list"),
  groupCreate: (input: GroupInput) => call<Group>("group_create", { input }),
  groupUpdate: (id: string, input: GroupInput) => call<Group>("group_update", { id, input }),
  groupSetExpanded: (id: string, expanded: boolean) =>
    call<void>("group_set_expanded", { id, expanded }),
  groupDelete: (id: string) => call<void>("group_delete", { id }),

  profilesList: () => call<Profile[]>("profiles_list"),
  profileCreate: (input: ProfileInput) => call<Profile>("profile_create", { input }),
  profileUpdate: (id: string, input: ProfileInput) =>
    call<Profile>("profile_update", { id, input }),
  profileDuplicate: (id: string) => call<Profile>("profile_duplicate", { id }),
  profilesDelete: (ids: string[]) => call<number>("profiles_delete", { ids }),
  profileSetFavorite: (id: string, favorite: boolean) =>
    call<Profile>("profile_set_favorite", { id, favorite }),
  profilesMove: (ids: string[], groupId: string | null) =>
    call<void>("profiles_move", { ids, groupId }),
  profilesExport: () => call<ExportResult | null>("profiles_export"),
  profilesImport: () => call<ImportSummary | null>("profiles_import"),
  keyFilePick: () => call<string | null>("key_file_pick"),

  credentialSet: (profileId: string, kind: "password" | "passphrase", secret: string) =>
    call<void>("credential_set", { profileId, kind, secret }),
  credentialDelete: (profileId: string, kind: "password" | "passphrase") =>
    call<void>("credential_delete", { profileId, kind }),

  knownHostsList: () => call<KnownHost[]>("known_hosts_list"),
  knownHostDelete: (id: number) => call<void>("known_host_delete", { id }),

  snippetsList: () => call<Snippet[]>("snippets_list"),
  snippetCreate: (input: SnippetInput) => call<Snippet>("snippet_create", { input }),
  snippetUpdate: (id: string, input: SnippetInput) =>
    call<Snippet>("snippet_update", { id, input }),
  snippetDelete: (id: string) => call<void>("snippet_delete", { id }),

  sessionHistoryList: (limit?: number) =>
    call<SessionHistoryEntry[]>("session_history_list", { limit }),
  sessionHistoryClear: () => call<void>("session_history_clear"),
  commandHistoryList: (query?: string, limit?: number) =>
    call<CommandHistoryEntry[]>("command_history_list", { query, limit }),
  commandHistoryRecord: (
    profileId: string | null,
    targetLabel: string,
    command: string,
    source: CommandSource,
  ) => call<void>("command_history_record", { profileId, targetLabel, command, source }),
  commandHistoryClear: () => call<void>("command_history_clear"),

  settingsGet: () => call<AppSettings>("settings_get"),
  settingsUpdate: (settings: AppSettings) => call<AppSettings>("settings_update", { settings }),

  localShells: () => call<ShellInfo[]>("local_shells"),
  sessionOpen: async (
    request: OpenRequest,
    cols: number,
    rows: number,
    handlers: SessionHandlers,
  ): Promise<SessionSummary> => {
    try {
      return await transport.openSession(request, cols, rows, handlers);
    } catch (err) {
      throw toAppError(err);
    }
  },
  sessionWrite: (id: string, data: string) => call<void>("session_write", { id, data }),
  sessionResize: (id: string, cols: number, rows: number) =>
    call<void>("session_resize", { id, cols, rows }),
  sessionRespond: (id: string, requestId: string, response: PromptResponse) =>
    call<void>("session_respond", { id, requestId, response }),
  sessionClose: (id: string) => call<void>("session_close", { id }),
};
