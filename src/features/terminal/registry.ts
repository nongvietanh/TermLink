// xterm.js instances live outside React so they survive tab switches, split
// changes and reconnects. Panes attach/detach the terminal's DOM element.
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal, type ITerminalOptions } from "@xterm/xterm";

import type { AppSettings, SessionKind, TerminalPrefs } from "@/domain/types";

import { resolveTheme } from "@/stores/settings";

import { getScheme } from "./themes";

export interface TerminalCallbacks {
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  onPaste: (text: string, paste: (t: string) => void) => void;
  onCopy: (text: string) => void;
}

export interface TerminalEntry {
  key: string;
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  el: HTMLDivElement;
  opened: boolean;
  webgl: WebglAddon | null;
  prefs: TerminalPrefs;
  kind: SessionKind;
  lastSize: { cols: number; rows: number };
  ready: Promise<{ cols: number; rows: number }>;
  markReady: (size: { cols: number; rows: number }) => void;
  disposables: { dispose(): void }[];
}

const entries = new Map<string, TerminalEntry>();
let parking: HTMLDivElement | null = null;

/** Off-screen holder for terminals that are not currently shown. */
function parkingLot(): HTMLDivElement {
  if (!parking) {
    parking = document.createElement("div");
    parking.setAttribute("aria-hidden", "true");
    parking.style.cssText =
      "position:fixed;left:-10000px;top:0;width:800px;height:480px;overflow:hidden;";
    document.body.appendChild(parking);
  }
  return parking;
}

export function terminalOptions(
  settings: AppSettings,
  prefs: TerminalPrefs,
  kind: SessionKind,
): ITerminalOptions {
  const t = settings.terminal;
  return {
    fontFamily: prefs.fontFamily || t.fontFamily,
    fontSize: prefs.fontSize ?? t.fontSize,
    lineHeight: t.lineHeight,
    cursorStyle: t.cursorStyle,
    cursorBlink: t.cursorBlink,
    scrollback: prefs.scrollback ?? t.scrollback,
    theme: getScheme(
      prefs.theme || t.colorScheme,
      resolveTheme(settings.appearance.theme) === "dark",
    ).theme,
    allowProposedApi: true,
    macOptionIsMeta: true,
    drawBoldTextInBrightColors: true,
    smoothScrollDuration: 0,
    rightClickSelectsWord: false,
    windowsPty:
      kind === "local" && navigator.userAgent.includes("Windows")
        ? { backend: "conpty" }
        : undefined,
  };
}

export function createTerminal(
  key: string,
  kind: SessionKind,
  settings: AppSettings,
  prefs: TerminalPrefs,
  callbacks: TerminalCallbacks,
): TerminalEntry {
  const existing = entries.get(key);
  if (existing) return existing;

  const term = new Terminal(terminalOptions(settings, prefs, kind));
  const fit = new FitAddon();
  const search = new SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = "11";

  const el = document.createElement("div");
  el.className = "tl-terminal-host h-full w-full";
  el.dataset.terminalKey = key;
  parkingLot().appendChild(el);

  let markReady!: (size: { cols: number; rows: number }) => void;
  const ready = new Promise<{ cols: number; rows: number }>((resolve) => (markReady = resolve));

  const entry: TerminalEntry = {
    key,
    term,
    fit,
    search,
    el,
    opened: false,
    webgl: null,
    prefs,
    kind,
    lastSize: { cols: term.cols, rows: term.rows },
    ready,
    markReady,
    disposables: [],
  };

  const copySelection = () => {
    const text = term.getSelection();
    if (text) callbacks.onCopy(text);
  };

  entry.disposables.push(
    term.onData((data) => callbacks.onInput(data)),
    term.onResize(({ cols, rows }) => {
      entry.lastSize = { cols, rows };
      callbacks.onResize(cols, rows);
    }),
    term.onSelectionChange(() => {
      if (settingsRef.current?.terminal.copyOnSelect && term.hasSelection()) copySelection();
    }),
  );

  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown") return true;
    if (e.isComposing || e.keyCode === 229) return true;
    const ctrl = e.ctrlKey || e.metaKey;
    // Copy: Ctrl+Shift+C always; Ctrl+C only when text is selected (otherwise it is SIGINT).
    if (ctrl && e.code === "KeyC" && (e.shiftKey || term.hasSelection())) {
      copySelection();
      if (!e.shiftKey) term.clearSelection();
      e.preventDefault();
      return false;
    }
    // Paste: let the browser fire a native paste event, handled below.
    if (ctrl && !e.altKey && e.code === "KeyV") return false;
    return true;
  });

  // Intercept pastes (keyboard, menu) to allow multi-line confirmation.
  el.addEventListener(
    "paste",
    (e) => {
      const text = e.clipboardData?.getData("text/plain") ?? "";
      e.preventDefault();
      e.stopPropagation();
      if (text) callbacks.onPaste(text, (t) => term.paste(t));
    },
    true,
  );

  entries.set(key, entry);
  return entry;
}

// Latest settings for handlers that need them (copy-on-select).
const settingsRef: { current: AppSettings | null } = { current: null };
export function setRegistrySettings(s: AppSettings) {
  settingsRef.current = s;
}

function loadWebgl(entry: TerminalEntry) {
  if (entry.webgl || !settingsRef.current?.terminal.webgl) return;
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => {
      webgl.dispose();
      entry.webgl = null;
    });
    entry.term.loadAddon(webgl);
    entry.webgl = webgl;
  } catch {
    // WebGL unavailable: the DOM renderer is used instead.
    entry.webgl = null;
  }
}

export function getTerminal(key: string): TerminalEntry | undefined {
  return entries.get(key);
}

/** Shows the terminal inside `container` and fits it to the available space. */
export function attachTerminal(key: string, container: HTMLElement) {
  const entry = entries.get(key);
  if (!entry) return;
  if (entry.el.parentElement !== container) container.appendChild(entry.el);
  if (!entry.opened) {
    entry.term.open(entry.el);
    const input = entry.el.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea");
    if (input) {
      input.lang = document.documentElement.lang;
      input.spellcheck = false;
      input.autocapitalize = "off";
    }
    entry.opened = true;
    loadWebgl(entry);
  }
  fitTerminal(key);
}

export function detachTerminal(key: string, container: HTMLElement) {
  const entry = entries.get(key);
  if (entry && entry.el.parentElement === container) parkingLot().appendChild(entry.el);
}

export function fitTerminal(key: string) {
  const entry = entries.get(key);
  if (!entry || !entry.opened) return;
  const host = entry.el.parentElement;
  if (!host || host === parking || host.clientWidth < 20 || host.clientHeight < 20) return;
  try {
    entry.fit.fit();
  } catch {
    return;
  }
  entry.markReady({ cols: entry.term.cols, rows: entry.term.rows });
}

export function focusTerminal(key: string) {
  entries.get(key)?.term.focus();
}

/** Waits for the first fit (so the session starts with the right size). */
export async function waitForSize(
  key: string,
  timeoutMs = 1500,
): Promise<{ cols: number; rows: number }> {
  const entry = entries.get(key);
  if (!entry) return { cols: 100, rows: 30 };
  const fallback = new Promise<{ cols: number; rows: number }>((resolve) =>
    setTimeout(() => resolve({ cols: entry.term.cols, rows: entry.term.rows }), timeoutMs),
  );
  return Promise.race([entry.ready, fallback]);
}

export function writeToTerminal(key: string, data: Uint8Array | string) {
  entries.get(key)?.term.write(data);
}

export function disposeTerminal(key: string) {
  const entry = entries.get(key);
  if (!entry) return;
  entries.delete(key);
  for (const d of entry.disposables) d.dispose();
  entry.webgl?.dispose();
  entry.term.dispose();
  entry.el.remove();
}

/** Re-applies settings to every open terminal. */
export function applySettingsToAll(settings: AppSettings) {
  setRegistrySettings(settings);
  for (const entry of entries.values()) {
    const opts = terminalOptions(settings, entry.prefs, entry.kind);
    const t = entry.term;
    const input = entry.el.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea");
    if (input) input.lang = document.documentElement.lang;
    t.options.fontFamily = opts.fontFamily;
    t.options.fontSize = opts.fontSize;
    t.options.lineHeight = opts.lineHeight;
    t.options.cursorStyle = opts.cursorStyle;
    t.options.cursorBlink = opts.cursorBlink;
    t.options.scrollback = opts.scrollback;
    t.options.theme = opts.theme;
    if (!settings.terminal.webgl && entry.webgl) {
      entry.webgl.dispose();
      entry.webgl = null;
    } else if (settings.terminal.webgl && entry.opened) {
      loadWebgl(entry);
    }
    fitTerminal(entry.key);
  }
}

export function terminalKeys(): string[] {
  return [...entries.keys()];
}
