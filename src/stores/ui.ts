// Transient UI state: current view, open dialogs, explorer filter.
import { create } from "zustand";

export type View =
  | "workspace"
  | "dashboard"
  | "connections"
  | "groups"
  | "credentials"
  | "forwarding"
  | "transfers"
  | "snippets"
  | "history"
  | "settings";

export const VIEWS: View[] = [
  "workspace",
  "dashboard",
  "connections",
  "groups",
  "credentials",
  "forwarding",
  "transfers",
  "snippets",
  "history",
  "settings",
];

export type ProfileEditorState =
  | {
      mode: "create";
      groupId?: string | null;
      prefill?: { host?: string; username?: string; port?: number };
    }
  | { mode: "edit"; profileId: string };

export type GroupEditorState =
  { mode: "create"; parentId: string | null } | { mode: "edit"; groupId: string };

export type SnippetEditorState = { mode: "create" } | { mode: "edit"; snippetId: string };

interface UiState {
  view: View;
  paletteOpen: boolean;
  paletteQuery: string;
  quickConnectOpen: boolean;
  profileEditor: ProfileEditorState | null;
  groupEditor: GroupEditorState | null;
  snippetEditor: SnippetEditorState | null;
  explorerQuery: string;
  findOpenFor: string | null;

  setView: (v: View) => void;
  openPalette: (query?: string) => void;
  closePalette: () => void;
  setQuickConnect: (open: boolean) => void;
  editProfile: (s: ProfileEditorState | null) => void;
  editGroup: (s: GroupEditorState | null) => void;
  editSnippet: (s: SnippetEditorState | null) => void;
  setExplorerQuery: (q: string) => void;
  setFindOpenFor: (tabKey: string | null) => void;
}

export const useUi = create<UiState>()((set) => ({
  view: "dashboard",
  paletteOpen: false,
  paletteQuery: "",
  quickConnectOpen: false,
  profileEditor: null,
  groupEditor: null,
  snippetEditor: null,
  explorerQuery: "",
  findOpenFor: null,

  setView: (view) => set({ view }),
  openPalette: (query = "") => set({ paletteOpen: true, paletteQuery: query }),
  closePalette: () => set({ paletteOpen: false }),
  setQuickConnect: (quickConnectOpen) => set({ quickConnectOpen }),
  editProfile: (profileEditor) => set({ profileEditor }),
  editGroup: (groupEditor) => set({ groupEditor }),
  editSnippet: (snippetEditor) => set({ snippetEditor }),
  setExplorerQuery: (explorerQuery) => set({ explorerQuery }),
  setFindOpenFor: (findOpenFor) => set({ findOpenFor }),
}));
