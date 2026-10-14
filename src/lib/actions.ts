// Application-level actions shared by buttons, the command palette and
// keyboard shortcuts.
import type { SplitMode, ThemeMode } from "@/domain/types";
import {
  activeTab,
  clearTerminal,
  closeTab,
  openLocalTerminal,
  reconnect,
} from "@/features/terminal/controller";
import { focusTerminal } from "@/features/terminal/registry";
import { useLibrary } from "@/stores/library";
import { activeKeyOf, useSessions } from "@/stores/sessions";
import { useSettings } from "@/stores/settings";
import { useUi, type View } from "@/stores/ui";

import { api } from "./ipc";
import { notifyError, notifySuccess } from "./notify";
import type { ShortcutId } from "./shortcuts";

export function goTo(view: View) {
  useUi.getState().setView(view);
  useSettings
    .getState()
    .update((s) =>
      view === "workspace" || s.layout.lastView === view
        ? s
        : { ...s, layout: { ...s.layout, lastView: view } },
    );
}

export function newConnection(groupId: string | null = null) {
  useUi.getState().editProfile({ mode: "create", groupId });
}

export function quickConnect() {
  useUi.getState().setQuickConnect(true);
}

export function newLocalTerminal() {
  openLocalTerminal();
}

export function toggleExplorer() {
  useSettings.getState().update((s) => ({
    ...s,
    layout: { ...s.layout, explorerVisible: !s.layout.explorerVisible },
  }));
}

export function setSplit(mode: SplitMode) {
  useSessions.getState().setSplit(mode);
  useSettings.getState().update((s) => ({ ...s, layout: { ...s.layout, splitMode: mode } }));
  useUi.getState().setView("workspace");
}

export function toggleSplit() {
  setSplit(useSessions.getState().split === "single" ? "horizontal" : "single");
}

export function setTheme(theme: ThemeMode) {
  useSettings.getState().update((s) => ({ ...s, appearance: { ...s.appearance, theme } }));
}

export function closeActiveTab() {
  const t = activeTab();
  if (t) void closeTab(t.key);
}

export function reconnectActive() {
  const t = activeTab();
  if (t) void reconnect(t.key);
}

export function clearActive() {
  const t = activeTab();
  if (t) clearTerminal(t.key);
}

export function findInActive() {
  const t = activeTab();
  if (!t) return;
  useUi.getState().setView("workspace");
  useUi.getState().setFindOpenFor(t.key);
}

export function focusOtherPane() {
  const s = useSessions.getState();
  if (s.split === "single") return;
  const pane = s.focusedPane === 0 ? 1 : 0;
  s.focusPane(pane);
  const key = activeKeyOf(useSessions.getState());
  if (key) focusTerminal(key);
}

export async function importProfiles() {
  try {
    const summary = await api.profilesImport();
    if (!summary) return;
    await useLibrary.getState().reloadProfiles();
    const parts = [`${summary.profilesImported} imported`];
    if (summary.profilesSkipped) parts.push(`${summary.profilesSkipped} duplicates skipped`);
    if (summary.groupsCreated) parts.push(`${summary.groupsCreated} groups created`);
    if (summary.issues.length) {
      notifyError(
        {
          kind: "validation",
          message: summary.issues
            .slice(0, 3)
            .map((i) => `${i.name}: ${i.message}`)
            .join("\n"),
        },
        `${parts.join(", ")} · ${summary.issues.length} entries could not be imported`,
      );
    } else {
      notifySuccess("Profiles imported", parts.join(", "));
    }
  } catch (err) {
    notifyError(err, "Import failed");
  }
}

export async function exportProfiles() {
  try {
    const result = await api.profilesExport();
    if (result) {
      notifySuccess(
        `Exported ${result.profiles} profiles`,
        `Saved to ${result.path}. The file contains hostnames and usernames but no passwords or keys.`,
      );
    }
  } catch (err) {
    notifyError(err, "Export failed");
  }
}

/** Global shortcut handlers (terminal-only shortcuts are handled by xterm). */
export const SHORTCUT_ACTIONS: Partial<Record<ShortcutId, () => void>> = {
  palette: () => useUi.getState().openPalette(),
  quickConnect,
  newConnection: () => newConnection(),
  localTerminal: newLocalTerminal,
  closeTab: closeActiveTab,
  nextTab: () => useSessions.getState().cycle(1),
  prevTab: () => useSessions.getState().cycle(-1),
  find: findInActive,
  toggleExplorer,
  toggleSplit,
  focusOtherPane,
  reconnect: reconnectActive,
  clearTerminal: clearActive,
  settings: () => goTo("settings"),
};
