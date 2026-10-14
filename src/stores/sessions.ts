// Open session tabs and the split-pane layout.
import { create } from "zustand";

import type {
  AppError,
  AuthPromptEvent,
  ConnectionInfo,
  HostKeyPromptEvent,
  OpenRequest,
  SessionKind,
  SessionState,
  SplitMode,
} from "@/domain/types";

export type Prompt = HostKeyPromptEvent | AuthPromptEvent;

export interface SessionTab {
  /** Stable UI key; survives reconnects (the backend session id changes). */
  key: string;
  title: string;
  kind: SessionKind;
  request: OpenRequest;
  profileId: string | null;
  color: string | null;
  sessionId: string | null;
  /** Incremented on every (re)connect; events from older generations are ignored. */
  generation: number;
  state: SessionState | "idle";
  message: string | null;
  info: ConnectionInfo | null;
  error: AppError | null;
  exit: { code: number | null; signal: string | null } | null;
  closedReason: string | null;
  prompts: Prompt[];
  connectedAt: number | null;
  createdAt: number;
  unread: boolean;
}

interface SessionsState {
  tabs: SessionTab[];
  split: SplitMode;
  panes: [string | null, string | null];
  focusedPane: 0 | 1;

  addTab: (tab: SessionTab) => void;
  updateTab: (
    key: string,
    patch: Partial<SessionTab> | ((t: SessionTab) => Partial<SessionTab>),
  ) => void;
  removeTab: (key: string) => void;
  activate: (key: string) => void;
  focusPane: (pane: 0 | 1) => void;
  setSplit: (mode: SplitMode) => void;
  cycle: (dir: 1 | -1) => void;
  reorder: (from: string, to: string) => void;
}

export const activeKeyOf = (s: Pick<SessionsState, "panes" | "focusedPane" | "split">) =>
  s.split === "single" ? s.panes[0] : s.panes[s.focusedPane];

export const useSessions = create<SessionsState>()((set, get) => ({
  tabs: [],
  split: "single",
  panes: [null, null],
  focusedPane: 0,

  addTab: (tab) => {
    const { tabs, split, focusedPane, panes } = get();
    const next: [string | null, string | null] = [...panes];
    next[split === "single" ? 0 : focusedPane] = tab.key;
    set({ tabs: [...tabs, tab], panes: next });
  },

  updateTab: (key, patch) =>
    set({
      tabs: get().tabs.map((t) =>
        t.key === key ? { ...t, ...(typeof patch === "function" ? patch(t) : patch) } : t,
      ),
    }),

  removeTab: (key) => {
    const { tabs, panes } = get();
    const idx = tabs.findIndex((t) => t.key === key);
    const remaining = tabs.filter((t) => t.key !== key);
    const shown = new Set(panes.filter((p): p is string => !!p && p !== key));
    const replacement = () => {
      // Prefer the neighbour of the closed tab that isn't already shown.
      const candidates = [...remaining.slice(idx), ...remaining.slice(0, idx).reverse()];
      return candidates.find((t) => !shown.has(t.key))?.key ?? null;
    };
    const next = panes.map((p) => (p === key ? replacement() : p)) as [
      string | null,
      string | null,
    ];
    set({ tabs: remaining, panes: next });
  },

  activate: (key) => {
    const { split, panes, focusedPane } = get();
    if (split === "single") {
      set({ panes: [key, panes[1]] });
      return;
    }
    const other = focusedPane === 0 ? 1 : 0;
    if (panes[other] === key) {
      set({ focusedPane: other });
      return;
    }
    const next: [string | null, string | null] = [...panes];
    next[focusedPane] = key;
    set({ panes: next });
  },

  focusPane: (pane) => set({ focusedPane: get().split === "single" ? 0 : pane }),

  setSplit: (mode) => {
    const { tabs, panes, split, focusedPane } = get();
    if (mode === "single") {
      const keep = split === "single" ? panes[0] : panes[focusedPane];
      set({ split: mode, panes: [keep, null], focusedPane: 0 });
      return;
    }
    const first = panes[0] ?? tabs[0]?.key ?? null;
    const second =
      panes[1] && panes[1] !== first ? panes[1] : (tabs.find((t) => t.key !== first)?.key ?? null);
    set({ split: mode, panes: [first, second] });
  },

  cycle: (dir) => {
    const s = get();
    const active = activeKeyOf(s);
    if (!s.tabs.length) return;
    const idx = Math.max(
      0,
      s.tabs.findIndex((t) => t.key === active),
    );
    const next = s.tabs[(idx + dir + s.tabs.length) % s.tabs.length];
    if (next) s.activate(next.key);
  },

  reorder: (from, to) => {
    const tabs = [...get().tabs];
    const a = tabs.findIndex((t) => t.key === from);
    const b = tabs.findIndex((t) => t.key === to);
    if (a < 0 || b < 0 || a === b) return;
    const [moved] = tabs.splice(a, 1);
    tabs.splice(b, 0, moved!);
    set({ tabs });
  },
}));

export function tabTone(t: SessionTab): "idle" | "connecting" | "connected" | "error" {
  switch (t.state) {
    case "connected":
      return "connected";
    case "connecting":
    case "verifying":
    case "authenticating":
      return "connecting";
    case "failed":
      return "error";
    default:
      return "idle";
  }
}

export const isLive = (t: SessionTab) =>
  !!t.sessionId && t.state !== "disconnected" && t.state !== "failed";
