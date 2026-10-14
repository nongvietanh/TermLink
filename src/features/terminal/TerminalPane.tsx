import {
  ChevronDown,
  ChevronUp,
  Clipboard,
  Copy,
  Eraser,
  Files,
  KeyRound,
  Loader2,
  RotateCw,
  Save,
  Search,
  ShieldAlert,
  TextSelect,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/menu";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/ipc";
import { notifyError, notifySuccess } from "@/lib/notify";
import { SHORTCUTS, shortcutLabel } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { useLibrary } from "@/stores/library";
import { useSessions, type SessionTab } from "@/stores/sessions";
import { resolveTheme, useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";

import { clearTerminal, closeTab, reconnect } from "./controller";
import {
  attachTerminal,
  detachTerminal,
  fitTerminal,
  focusTerminal,
  getTerminal,
  getTerminalSelection,
  readTerminalText,
} from "./registry";
import { getScheme } from "./themes";

function TerminalSearch({ tabKey, onClose }: { tabKey: string; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [result, setResult] = useState<{ index: number; count: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const entry = getTerminal(tabKey);
    if (!entry) return;
    const sub = entry.search.onDidChangeResults((r) =>
      setResult(r ? { index: r.resultIndex, count: r.resultCount } : null),
    );
    return () => {
      sub.dispose();
      entry.search.clearDecorations();
    };
  }, [tabKey]);

  const options = {
    caseSensitive,
    regex,
    decorations: {
      matchBackground: "#164e63",
      matchOverviewRuler: "#22d3ee",
      activeMatchBackground: "#0e7490",
      activeMatchColorOverviewRuler: "#67e8f9",
    },
  };
  const find = (dir: 1 | -1, incremental = false) => {
    const entry = getTerminal(tabKey);
    if (!entry || !query) {
      entry?.search.clearDecorations();
      setResult(null);
      return;
    }
    try {
      if (dir === 1) entry.search.findNext(query, { ...options, incremental });
      else entry.search.findPrevious(query, options);
    } catch {
      setResult({ index: -1, count: 0 });
    }
  };

  return (
    <div
      role="search"
      className="absolute top-2 right-4 z-20 flex items-center gap-1 rounded-lg border border-line-strong bg-surface-2 p-1 shadow-panel animate-pop-in"
    >
      <Input
        ref={inputRef}
        value={query}
        aria-label="Find in terminal"
        placeholder="Find"
        className="h-7 w-52 text-xs"
        onChange={(e) => {
          setQuery(e.target.value);
          requestAnimationFrame(() => find(1, true));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") find(e.shiftKey ? -1 : 1);
          if (e.key === "Escape") onClose();
        }}
      />
      <span className="min-w-14 px-1 text-center text-[11px] text-faint tabular-nums">
        {query && result
          ? result.count
            ? `${result.index + 1}/${result.count}`
            : "No results"
          : ""}
      </span>
      <button
        type="button"
        aria-pressed={caseSensitive}
        aria-label="Match case"
        title="Match case"
        onClick={() => setCaseSensitive((v) => !v)}
        className={cn(
          "h-6 rounded px-1.5 text-[11px] font-semibold text-muted hover:bg-hover",
          caseSensitive && "bg-accent-soft text-accent",
        )}
      >
        Aa
      </button>
      <button
        type="button"
        aria-pressed={regex}
        aria-label="Use regular expression"
        title="Use regular expression"
        onClick={() => setRegex((v) => !v)}
        className={cn(
          "h-6 rounded px-1.5 font-mono text-[11px] text-muted hover:bg-hover",
          regex && "bg-accent-soft text-accent",
        )}
      >
        .*
      </button>
      <Button variant="ghost" size="icon-sm" aria-label="Previous match" onClick={() => find(-1)}>
        <ChevronUp />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Next match" onClick={() => find(1)}>
        <ChevronDown />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Close search" onClick={onClose}>
        <X />
      </Button>
    </div>
  );
}

function StatusOverlay({ tab }: { tab: SessionTab }) {
  const connecting = ["connecting", "verifying", "authenticating"].includes(tab.state);
  if (connecting && tab.connectedAt === null) {
    const label =
      tab.state === "verifying"
        ? "Waiting for host key confirmation"
        : tab.state === "authenticating"
          ? "Authenticating…"
          : (tab.message ?? "Connecting…");
    const Icon =
      tab.state === "verifying" ? ShieldAlert : tab.state === "authenticating" ? KeyRound : Loader2;
    return (
      <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
        <div className="flex items-center gap-2 rounded-full border border-line-strong bg-surface-2/95 px-3 py-1 text-xs text-muted shadow-panel">
          <Icon className={cn("size-3.5 text-warning", Icon === Loader2 && "animate-spin")} />
          {label}
        </div>
      </div>
    );
  }
  if (tab.state === "disconnected" || tab.state === "failed") {
    return (
      <div className="absolute inset-x-0 bottom-4 z-10 flex justify-center">
        <div className="flex items-center gap-3 rounded-lg border border-line-strong bg-surface-2/95 py-1.5 pr-1.5 pl-3 text-xs shadow-panel animate-pop-in">
          <span
            className={cn(
              "max-w-md truncate",
              tab.state === "failed" ? "text-danger" : "text-muted",
            )}
          >
            {tab.state === "failed"
              ? (tab.error?.message ?? "Connection failed")
              : (tab.closedReason ?? "Disconnected")}
          </span>
          <Button size="sm" variant="primary" onClick={() => void reconnect(tab.key)}>
            <RotateCw />
            Reconnect
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void closeTab(tab.key, { force: true })}>
            Close
          </Button>
        </div>
      </div>
    );
  }
  return null;
}

export function TerminalPane({
  tabKey,
  focused,
  onFocus,
}: {
  tabKey: string;
  focused: boolean;
  onFocus: () => void;
}) {
  const t = useT();
  const [hasSelection, setHasSelection] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const tab = useSessions((s) => s.tabs.find((t) => t.key === tabKey));
  const findOpenFor = useUi((s) => s.findOpenFor);
  const setFindOpenFor = useUi((s) => s.setFindOpenFor);
  const settings = useSettings((s) => s.settings);
  const profileTheme = useLibrary(
    (s) => s.profiles.find((p) => p.id === tab?.profileId)?.terminal.theme,
  );
  const scheme = getScheme(
    profileTheme || settings.terminal.colorScheme,
    resolveTheme(settings.appearance.theme) === "dark",
  );

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    attachTerminal(tabKey, host);
    const ro = new ResizeObserver(() => fitTerminal(tabKey));
    ro.observe(host);
    return () => {
      ro.disconnect();
      detachTerminal(tabKey, host);
    };
  }, [tabKey]);

  useEffect(() => {
    if (focused) {
      requestAnimationFrame(() => focusTerminal(tabKey));
      if (tab?.unread) useSessions.getState().updateTab(tabKey, { unread: false });
    }
  }, [focused, tabKey, tab?.unread]);

  const copy = async () => {
    const text = getTerminalSelection(tabKey);
    if (text)
      await navigator.clipboard
        .writeText(text)
        .catch(() => notifyError({ kind: "internal", message: "Clipboard unavailable" }));
  };
  const copyAll = async () => {
    const text = readTerminalText(tabKey);
    if (text)
      await navigator.clipboard
        .writeText(text)
        .catch(() => notifyError({ kind: "internal", message: "Clipboard unavailable" }));
  };
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) getTerminal(tabKey)?.el.dispatchEvent(pasteEvent(text));
    } catch {
      notifyError({
        kind: "internal",
        message: `Clipboard access was denied. Use ${shortcutLabel("paste")} to paste.`,
      });
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    const selected = getTerminalSelection(tabKey).length > 0;
    setHasSelection(selected);
    // A selection opens the terminal action menu even when right-click paste
    // is enabled. Empty-space right-click keeps the existing quick-paste option.
    if (!selected && settings.terminal.rightClickPaste) {
      e.preventDefault();
      e.stopPropagation();
      void paste();
    }
  };

  const saveOutput = async () => {
    const content = readTerminalText(tabKey);
    if (!content) return;
    try {
      const path = await api.saveTextFile(`${tab?.title ?? "termlink"}-terminal.txt`, content);
      if (path) notifySuccess(t("Terminal output saved"), path);
    } catch (err) {
      notifyError(err, t("Could not save terminal output"));
    }
  };

  if (!tab) return null;
  const searchOpen = findOpenFor === tabKey;

  return (
    <div
      className={cn("relative flex h-full min-h-0 flex-col", focused ? "" : "opacity-[0.92]")}
      onMouseDownCapture={onFocus}
      style={{ background: scheme.theme.background }}
      data-testid={`terminal-pane-${tab.title}`}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="relative min-h-0 flex-1 py-1.5 pl-2.5" onContextMenu={onContextMenu}>
            <div ref={hostRef} className="h-full w-full" />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            icon={<Copy />}
            shortcut={shortcutLabel("copy")}
            disabled={!hasSelection}
            onSelect={() => void copy()}
          >
            {t("Copy")}
          </ContextMenuItem>
          <ContextMenuItem icon={<Files />} onSelect={() => void copyAll()}>
            {t("Copy all")}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Clipboard />}
            shortcut={shortcutLabel("paste")}
            onSelect={() => void paste()}
          >
            {t("Paste")}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<TextSelect />}
            onSelect={() => getTerminal(tabKey)?.term.selectAll()}
          >
            {t("Select all")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            icon={<Search />}
            shortcut={shortcutLabel("find")}
            onSelect={() => setFindOpenFor(tabKey)}
          >
            {t("Find…")}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Eraser />}
            shortcut={shortcutLabel("clearTerminal")}
            onSelect={() => clearTerminal(tabKey)}
          >
            {t("Clear terminal")}
          </ContextMenuItem>
          <ContextMenuItem icon={<Save />} onSelect={() => void saveOutput()}>
            {t("Save terminal output…")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {searchOpen && (
        <TerminalSearch
          tabKey={tabKey}
          onClose={() => {
            setFindOpenFor(null);
            focusTerminal(tabKey);
          }}
        />
      )}
      <StatusOverlay tab={tab} />
      {focused && (
        <span className="sr-only">Press {SHORTCUTS.find.keys} to search the terminal output</span>
      )}
    </div>
  );
}

/** Synthesizes a paste event so pastes from menus go through the same confirmation path. */
function pasteEvent(text: string): Event {
  const data = new DataTransfer();
  data.setData("text/plain", text);
  return new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
}
