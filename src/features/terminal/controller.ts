// Session controller: connects tabs, xterm instances and the backend.
import type {
  OpenRequest,
  Profile,
  PromptResponse,
  SessionEvent,
  SessionKind,
} from "@/domain/types";
import { api, toAppError } from "@/lib/ipc";
import { notifyError } from "@/lib/notify";
import { confirm } from "@/stores/confirm";
import { useLibrary } from "@/stores/library";
import { activeKeyOf, isLive, useSessions, type SessionTab } from "@/stores/sessions";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";

import {
  createTerminal,
  disposeTerminal,
  focusTerminal,
  getTerminal,
  waitForSize,
  writeToTerminal,
} from "./registry";

const ESC = "\u001b";
const dim = (s: string) => `${ESC}[90m${s}${ESC}[0m`;
const red = (s: string) => `${ESC}[31m${s}${ESC}[0m`;

/**
 * Serializes writes for one tab: IPC calls are asynchronous, so without this
 * keystrokes could reach the backend out of order. Input typed while a write
 * is in flight is batched into the next call, and input produced before the
 * backend session id is known (e.g. xterm answering ConPTY's cursor-position
 * query) is held until the session is ready.
 */
export class WriteQueue {
  private pending = "";
  private inflight = false;
  private sessionId: string | null = null;

  setSession(id: string) {
    this.sessionId = id;
    this.kick();
  }

  push(data: string) {
    if (!this.sessionId && this.pending.length > 64 * 1024) return;
    this.pending += data;
    this.kick();
  }

  private kick() {
    if (!this.inflight && this.sessionId && this.pending) void this.flush();
  }

  private async flush() {
    this.inflight = true;
    while (this.pending && this.sessionId) {
      const chunk = this.pending;
      const id = this.sessionId;
      this.pending = "";
      try {
        await api.sessionWrite(id, chunk);
      } catch {
        // Session ended; drop remaining input.
        this.pending = "";
      }
    }
    this.inflight = false;
  }
}

/** Write queues keyed by tab key; replaced on every (re)connect. */
const queues = new Map<string, WriteQueue>();
const resizeTimers = new Map<string, ReturnType<typeof setTimeout>>();

const tabOf = (key: string) => useSessions.getState().tabs.find((t) => t.key === key);

function newKey() {
  return crypto.randomUUID();
}

function isVisible(key: string) {
  const s = useSessions.getState();
  const ui = useUi.getState();
  if (ui.view !== "workspace") return false;
  return s.split === "single" ? s.panes[0] === key : s.panes.includes(key);
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    notifyError({ kind: "internal", message: "Could not access the clipboard" });
  }
}

async function handlePaste(text: string, paste: (t: string) => void) {
  const { confirmMultilinePaste } = useSettings.getState().settings.safety;
  if (confirmMultilinePaste && /\r|\n/.test(text.trim())) {
    const lines = text.trim().split(/\r\n|\r|\n/).length;
    const ok = await confirm({
      title: `Paste ${lines} lines?`,
      description: "Multi-line text may run several commands at once in the remote shell.",
      detail: text.length > 4000 ? `${text.slice(0, 4000)}\n…` : text,
      confirmLabel: "Paste",
    });
    if (!ok) return;
  }
  paste(text);
}

function ensureTerminal(key: string, kind: SessionKind, profile: Profile | null) {
  const settings = useSettings.getState().settings;
  return createTerminal(key, kind, settings, profile?.terminal ?? {}, {
    onInput: (data) => sendInput(key, data),
    onResize: (cols, rows) => scheduleResize(key, cols, rows),
    onPaste: (text, paste) => void handlePaste(text, paste),
    onCopy: (text) => void copyText(text),
  });
}

const acceptsInput = (t: SessionTab) =>
  t.state !== "disconnected" && t.state !== "failed" && t.state !== "idle";

function sendInput(key: string, data: string) {
  const tab = tabOf(key);
  if (!tab || !acceptsInput(tab)) return;
  queues.get(key)?.push(data);
}

function scheduleResize(key: string, cols: number, rows: number) {
  const prev = resizeTimers.get(key);
  if (prev) clearTimeout(prev);
  resizeTimers.set(
    key,
    setTimeout(() => {
      resizeTimers.delete(key);
      const tab = tabOf(key);
      if (tab?.sessionId && isLive(tab))
        api.sessionResize(tab.sessionId, cols, rows).catch(() => {});
    }, 60),
  );
}

function handleEvent(key: string, generation: number, ev: SessionEvent) {
  const tab = tabOf(key);
  if (!tab || tab.generation !== generation) return;
  const update = useSessions.getState().updateTab;
  switch (ev.type) {
    case "status":
      update(key, {
        state: ev.state,
        message: ev.message,
        ...(ev.state === "connected" ? { connectedAt: Date.now(), error: null } : {}),
      });
      break;
    case "hostKeyPrompt":
    case "authPrompt":
      update(key, (t) => ({
        prompts: [...t.prompts.filter((p) => p.requestId !== ev.requestId), ev],
      }));
      break;
    case "promptClosed":
      update(key, (t) => ({ prompts: t.prompts.filter((p) => p.requestId !== ev.requestId) }));
      break;
    case "banner":
      writeToTerminal(key, dim(ev.text.replace(/\r?\n/g, "\r\n")) + "\r\n");
      break;
    case "connected":
      update(key, { info: ev.info });
      // Saved-credential flags and last-connected time may have changed.
      void useLibrary
        .getState()
        .reloadProfiles()
        .catch(() => {});
      break;
    case "metrics":
      update(key, { metrics: ev.metrics, metricsUnavailable: false });
      break;
    case "metricsUnavailable":
      update(key, { metrics: null, metricsUnavailable: true });
      break;
    case "exit":
      update(key, { exit: { code: ev.code, signal: ev.signal } });
      break;
    case "error":
      update(key, { error: ev.error });
      writeToTerminal(key, `\r\n${red(`✖ ${ev.error.message}`)}\r\n`);
      break;
    case "closed": {
      queues.delete(key);
      // Failures were already printed by the "error" event.
      const alreadyShown = tabOf(key)?.error?.message === ev.reason;
      update(key, (t) => ({
        sessionId: null,
        prompts: [],
        metrics: null,
        metricsUnavailable: false,
        closedReason: ev.reason,
        state: t.state === "failed" ? "failed" : "disconnected",
      }));
      if (!alreadyShown) writeToTerminal(key, `\r\n${dim(`── ${ev.reason} ──`)}\r\n`);
      break;
    }
  }
}

async function start(key: string) {
  const tab = tabOf(key);
  if (!tab) return;
  const generation = tab.generation;
  const queue = new WriteQueue();
  queues.set(key, queue);
  const { cols, rows } = await waitForSize(key);
  if (tabOf(key)?.generation !== generation) return;
  try {
    const summary = await api.sessionOpen(tab.request, cols, rows, {
      onData: (bytes) => {
        const t = tabOf(key);
        if (!t || t.generation !== generation) return;
        writeToTerminal(key, bytes);
        if (!t.unread && !isVisible(key)) useSessions.getState().updateTab(key, { unread: true });
      },
      onEvent: (ev) => handleEvent(key, generation, ev),
    });
    const current = tabOf(key);
    if (!current || current.generation !== generation) {
      // Tab closed or reconnected while opening: stop the orphan session.
      void api.sessionClose(summary.id).catch(() => {});
      return;
    }
    useSessions.getState().updateTab(key, { sessionId: summary.id });
    queue.setSession(summary.id);
  } catch (err) {
    const error = toAppError(err);
    useSessions.getState().updateTab(key, { state: "failed", error, closedReason: error.message });
    writeToTerminal(key, `${red(`✖ ${error.message}`)}\r\n`);
  }
}

export interface OpenOptions {
  title: string;
  kind: SessionKind;
  profile?: Profile | null;
}

/** Opens a new session tab and starts connecting. Returns the tab key. */
export function openSession(request: OpenRequest, opts: OpenOptions): string {
  const key = newKey();
  const profile = opts.profile ?? null;
  ensureTerminal(key, opts.kind, profile);
  const tab: SessionTab = {
    key,
    title: opts.title,
    kind: opts.kind,
    request,
    profileId: profile?.id ?? null,
    color: profile?.color ?? null,
    sessionId: null,
    generation: 1,
    state: "connecting",
    message: null,
    info: null,
    metrics: null,
    metricsUnavailable: false,
    error: null,
    exit: null,
    closedReason: null,
    prompts: [],
    connectedAt: null,
    createdAt: Date.now(),
    unread: false,
  };
  useSessions.getState().addTab(tab);
  useUi.getState().setView("workspace");
  void start(key);
  return key;
}

export function connectProfile(profile: Profile): string | null {
  if (profile.protocol === "rdp" || profile.protocol === "vnc") {
    notifyError({
      kind: "unsupported",
      message: `${profile.protocol.toUpperCase()} connections are planned but not available yet.`,
    });
    return null;
  }
  return openSession(
    { kind: "profile", profileId: profile.id },
    { title: profile.name, kind: profile.protocol === "local" ? "local" : "ssh", profile },
  );
}

export function openLocalTerminal(shellId?: string | null) {
  const shells = useSettings.getState().shells;
  const defaultId = shellId ?? useSettings.getState().settings.localTerminal.defaultShell;
  const shell = shells.find((s) => s.id === defaultId) ?? shells[0];
  return openSession(
    { kind: "local", shellId: shell?.id ?? null },
    { title: shell?.name ?? "Local terminal", kind: "local" },
  );
}

export async function reconnect(key: string) {
  const tab = tabOf(key);
  if (!tab) return;
  queues.delete(key);
  if (tab.sessionId) void api.sessionClose(tab.sessionId).catch(() => {});
  useSessions.getState().updateTab(key, {
    generation: tab.generation + 1,
    sessionId: null,
    state: "connecting",
    message: null,
    error: null,
    exit: null,
    closedReason: null,
    prompts: [],
    info: null,
    metrics: null,
    metricsUnavailable: false,
    connectedAt: null,
  });
  writeToTerminal(key, `\r\n${dim("── Reconnecting… ──")}\r\n`);
  await start(key);
}

export function disconnect(key: string) {
  const tab = tabOf(key);
  if (tab?.sessionId) void api.sessionClose(tab.sessionId).catch(() => {});
}

export async function closeTab(key: string, opts: { force?: boolean } = {}) {
  const tab = tabOf(key);
  if (!tab) return;
  const { confirmCloseConnectedSession } = useSettings.getState().settings.safety;
  if (!opts.force && confirmCloseConnectedSession && tab.state === "connected") {
    const ok = await confirm({
      title: `Close "${tab.title}"?`,
      description: "The session is still connected. Closing the tab ends the remote shell.",
      confirmLabel: "Close session",
      tone: "danger",
    });
    if (!ok) return;
  }
  queues.delete(key);
  if (tab.sessionId) void api.sessionClose(tab.sessionId).catch(() => {});
  useSessions.getState().removeTab(key);
  disposeTerminal(key);
  const next = activeKeyOf(useSessions.getState());
  if (next) requestAnimationFrame(() => focusTerminal(next));
}

export async function respondPrompt(key: string, requestId: string, response: PromptResponse) {
  const tab = tabOf(key);
  useSessions.getState().updateTab(key, (t) => ({
    prompts: t.prompts.filter((p) => p.requestId !== requestId),
  }));
  if (!tab?.sessionId) return;
  try {
    await api.sessionRespond(tab.sessionId, requestId, response);
  } catch (err) {
    notifyError(err);
  }
  requestAnimationFrame(() => focusTerminal(key));
}

/**
 * Types text into a session. `run` appends Enter. Never called automatically:
 * only from explicit user actions (snippet buttons, palette, history).
 */
export function sendText(key: string, text: string, run: boolean) {
  const tab = tabOf(key);
  if (!tab?.sessionId || !isLive(tab)) {
    notifyError({ kind: "session_closed", message: "The session is not connected" });
    return false;
  }
  const entry = getTerminal(key);
  const payload = run ? `${text.replace(/\r?\n$/, "")}\r` : text;
  // Use bracketed paste when the remote application requested it.
  if (entry && !run) entry.term.paste(text);
  else sendInput(key, payload);
  focusTerminal(key);
  return true;
}

export function clearTerminal(key: string) {
  getTerminal(key)?.term.clear();
}

export function activeTab(): SessionTab | undefined {
  const s = useSessions.getState();
  const key = activeKeyOf(s);
  return s.tabs.find((t) => t.key === key);
}

/** Closes all sessions (used on window close). */
export function closeAll() {
  for (const t of useSessions.getState().tabs)
    if (t.sessionId) void api.sessionClose(t.sessionId).catch(() => {});
}
