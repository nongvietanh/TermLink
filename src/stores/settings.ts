// Application settings, persisted through the backend (validated there).
import { create } from "zustand";

import type { AppInfo, AppSettings, ShellInfo, ThemeMode } from "@/domain/types";
import { api } from "@/lib/ipc";
import { notifyError } from "@/lib/notify";
import { debounce } from "@/lib/utils";

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  appearance: { theme: "dark", language: "vietnamese", reduceMotion: false, uiScale: 100 },
  terminal: {
    fontFamily:
      '"Noto Sans Mono", "Cascadia Mono", "JetBrains Mono", Consolas, "Courier New", monospace',
    fontSize: 14,
    lineHeight: 1.2,
    cursorStyle: "block",
    cursorBlink: true,
    scrollback: 10000,
    colorScheme: "auto",
    copyOnSelect: false,
    rightClickPaste: true,
    termType: "xterm-256color",
    webgl: true,
  },
  ssh: { connectTimeoutSecs: 15, keepaliveIntervalSecs: 30, defaultUsername: "" },
  localTerminal: { defaultShell: null },
  safety: {
    confirmDestructiveSnippets: true,
    confirmMultilinePaste: true,
    confirmCloseConnectedSession: true,
  },
  layout: {
    sidebarCollapsed: false,
    explorerVisible: true,
    explorerWidth: 280,
    statusBarVisible: true,
    splitMode: "single",
    lastView: "dashboard",
  },
};

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  appInfo: AppInfo | null;
  shells: ShellInfo[];
  load: () => Promise<void>;
  /** Applies an update locally right away and persists it (debounced). */
  update: (fn: (s: AppSettings) => AppSettings) => void;
}

const persist = debounce((settings: AppSettings) => {
  api.settingsUpdate(settings).catch((e) => notifyError(e, "Settings could not be saved"));
}, 400);

export const useSettings = create<SettingsState>()((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  appInfo: null,
  shells: [],
  load: async () => {
    const [settings, appInfo, shells] = await Promise.all([
      api.settingsGet(),
      api.appInfo(),
      api.localShells().catch(() => [] as ShellInfo[]),
    ]);
    set({ settings, appInfo, shells, loaded: true });
  },
  update: (fn) => {
    const next = fn(get().settings);
    set({ settings: next });
    persist(next);
  },
}));

export function resolveTheme(mode: ThemeMode): "dark" | "light" {
  if (mode !== "system") return mode;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
