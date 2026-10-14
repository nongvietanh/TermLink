// Keyboard shortcut definitions.
//
// Global shortcuts are captured before the terminal sees them, so they avoid
// keys that shells and terminal programs depend on (Ctrl+K/N/B/W/L/R...). Most
// use Ctrl+Shift, following common terminal-emulator conventions.
import { isMac } from "./utils";

export type ShortcutId =
  | "palette"
  | "quickConnect"
  | "newConnection"
  | "localTerminal"
  | "closeTab"
  | "nextTab"
  | "prevTab"
  | "find"
  | "toggleExplorer"
  | "toggleSplit"
  | "focusOtherPane"
  | "reconnect"
  | "clearTerminal"
  | "settings"
  | "copy"
  | "paste";

export interface ShortcutDef {
  keys: string;
  label: string;
  group: "General" | "Sessions" | "Terminal";
  /** Handled inside the terminal rather than globally. */
  terminalOnly?: boolean;
}

export const SHORTCUTS: Record<ShortcutId, ShortcutDef> = {
  palette: { keys: "Mod+Shift+P", label: "Command palette", group: "General" },
  quickConnect: { keys: "Mod+Shift+O", label: "Quick connect", group: "General" },
  newConnection: { keys: "Mod+Shift+N", label: "New connection", group: "General" },
  toggleExplorer: { keys: "Mod+Shift+B", label: "Toggle connection explorer", group: "General" },
  settings: { keys: "Mod+,", label: "Settings", group: "General" },
  localTerminal: { keys: "Mod+Shift+T", label: "New local terminal", group: "Sessions" },
  closeTab: { keys: "Mod+Shift+W", label: "Close session", group: "Sessions" },
  nextTab: { keys: "Ctrl+Tab", label: "Next session", group: "Sessions" },
  prevTab: { keys: "Ctrl+Shift+Tab", label: "Previous session", group: "Sessions" },
  toggleSplit: { keys: "Mod+Shift+D", label: "Toggle split view", group: "Sessions" },
  focusOtherPane: { keys: "Mod+Shift+E", label: "Focus other pane", group: "Sessions" },
  reconnect: { keys: "Mod+Shift+R", label: "Reconnect session", group: "Sessions" },
  find: { keys: "Mod+Shift+F", label: "Find in terminal", group: "Terminal" },
  clearTerminal: { keys: "Mod+Shift+L", label: "Clear terminal", group: "Terminal" },
  copy: { keys: "Mod+Shift+C", label: "Copy selection", group: "Terminal", terminalOnly: true },
  paste: { keys: "Mod+Shift+V", label: "Paste", group: "Terminal", terminalOnly: true },
};

interface ParsedKeys {
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

export function parseKeys(keys: string): ParsedKeys {
  const parts = keys.split("+");
  const key = (parts.pop() ?? "").toLowerCase();
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  const mod = mods.has("mod");
  return {
    ctrl: mods.has("ctrl") || (mod && !isMac),
    meta: mods.has("meta") || (mod && isMac),
    shift: mods.has("shift"),
    alt: mods.has("alt"),
    key,
  };
}

function eventKey(e: KeyboardEvent): string {
  // Use the physical key for letters/digits so Shift and layouts don't matter.
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
  if (e.code === "Comma") return ",";
  return e.key.toLowerCase();
}

export function matches(e: KeyboardEvent, keys: string): boolean {
  const p = parseKeys(keys);
  return (
    e.ctrlKey === p.ctrl &&
    e.metaKey === p.meta &&
    e.shiftKey === p.shift &&
    e.altKey === p.alt &&
    eventKey(e) === p.key
  );
}

export function matchShortcut(e: KeyboardEvent, id: ShortcutId): boolean {
  return matches(e, SHORTCUTS[id].keys);
}

export function isComposingKeyEvent(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229;
}

/** Display tokens for a key combination, e.g. ["Ctrl", "Shift", "P"]. */
export function formatKeys(keys: string): string[] {
  return keys.split("+").map((part) => {
    switch (part.toLowerCase()) {
      case "mod":
        return isMac ? "⌘" : "Ctrl";
      case "ctrl":
        return isMac ? "⌃" : "Ctrl";
      case "shift":
        return isMac ? "⇧" : "Shift";
      case "alt":
        return isMac ? "⌥" : "Alt";
      case "meta":
        return "⌘";
      case "tab":
        return "Tab";
      default:
        return part.length === 1 ? part.toUpperCase() : part;
    }
  });
}

export function shortcutLabel(id: ShortcutId): string {
  return formatKeys(SHORTCUTS[id].keys).join(isMac ? "" : "+");
}
