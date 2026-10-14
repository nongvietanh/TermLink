import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Maximize, Minus, Moon, Search, Settings, Sun, X, Zap } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { StatusDot } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import { goTo, quickConnect, setTheme } from "@/lib/actions";
import { useT } from "@/lib/i18n";
import { SHORTCUTS } from "@/lib/shortcuts";
import { useSessions } from "@/stores/sessions";
import { resolveTheme, useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";

import { LogoMark } from "./Logo";

function ConnectionStatus() {
  const t = useT();
  const tabs = useSessions((s) => s.tabs);
  const connected = tabs.filter((t) => t.state === "connected").length;
  const pending = tabs.filter((t) =>
    ["connecting", "verifying", "authenticating"].includes(t.state),
  ).length;
  const failed = tabs.filter((t) => t.state === "failed").length;
  const tone = pending ? "connecting" : connected ? "connected" : failed ? "error" : "idle";
  const label = tabs.length
    ? `${connected} ${t("connected")}${pending ? ` · ${pending} ${t("connecting")}` : ""}${failed ? ` · ${failed} ${t("failed")}` : ""}`
    : t("No active sessions");
  return (
    <button
      type="button"
      onClick={() => goTo("workspace")}
      className="flex h-7 items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 text-xs text-muted transition-colors hover:border-line-strong hover:text-fg"
      aria-label={`${t("Connection status")}: ${label}`}
    >
      <StatusDot tone={tone} />
      <span className="hidden lg:inline">{label}</span>
      <span className="lg:hidden">{connected}</span>
    </button>
  );
}

export function TopBar() {
  const t = useT();
  const openPalette = useUi((s) => s.openPalette);
  const theme = useSettings((s) => s.settings.appearance.theme);
  const isDark = resolveTheme(theme) === "dark";
  const isDesktop = "__TAURI_INTERNALS__" in window;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isDesktop) return;
    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void appWindow
      .isMaximized()
      .then((value) => {
        if (!disposed) setMaximized(value);
      })
      .catch(() => {});
    void appWindow
      .onResized(() => {
        void appWindow
          .isMaximized()
          .then((value) => {
            if (!disposed) setMaximized(value);
          })
          .catch(() => {});
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [isDesktop]);

  const handleTitlebarMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (!isDesktop || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button, input, a, [role=button]")) return;
    void getCurrentWindow()
      .startDragging()
      .catch(() => {});
  };

  const handleTitlebarDoubleClick = (event: MouseEvent<HTMLElement>) => {
    if (!isDesktop || (event.target as HTMLElement).closest("button, input, a, [role=button]"))
      return;
    void getCurrentWindow()
      .toggleMaximize()
      .then(() => getCurrentWindow().isMaximized())
      .then(setMaximized)
      .catch(() => {});
  };

  return (
    <header
      className="relative z-10 flex h-10 shrink-0 items-center gap-2 border-b border-line bg-rail px-2"
      onMouseDown={handleTitlebarMouseDown}
      onDoubleClick={handleTitlebarDoubleClick}
    >
      <div
        className="flex w-[142px] shrink-0 items-center gap-2 pl-1"
        aria-label="TermLink"
        data-tauri-drag-region
      >
        <LogoMark className="size-5" />
        <span className="text-[13px] font-semibold tracking-tight text-fg">
          Term<span className="text-accent">Link</span>
        </span>
      </div>
      <div className="flex min-w-0 flex-1 justify-center">
        <button
          type="button"
          onClick={() => openPalette()}
          className="group flex h-7 w-full max-w-[420px] min-w-0 items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 text-xs text-faint transition-colors hover:border-line-strong hover:text-muted"
          aria-label={t("Search connections and commands")}
        >
          <Search className="size-3.5 shrink-0" />
          <span className="flex-1 truncate text-left">
            {t("Search connections, sessions and commands…")}
          </span>
          <Kbd keys={SHORTCUTS.palette.keys} className="hidden shrink-0 sm:inline-flex" />
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Tooltip content={t("Quick connect")} shortcut={SHORTCUTS.quickConnect.keys}>
          <Button variant="primary" size="sm" onClick={quickConnect}>
            <Zap />
            <span className="hidden sm:inline">{t("Quick connect")}</span>
          </Button>
        </Tooltip>
        <ConnectionStatus />
        <Tooltip content={t(isDark ? "Switch to light theme" : "Switch to dark theme")}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Toggle theme")}
            onClick={() => setTheme(isDark ? "light" : "dark")}
          >
            {isDark ? <Sun /> : <Moon />}
          </Button>
        </Tooltip>
        <Tooltip content={t("Settings")} shortcut={SHORTCUTS.settings.keys}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Settings")}
            onClick={() => goTo("settings")}
          >
            <Settings />
          </Button>
        </Tooltip>
        {isDesktop && (
          <div
            className="ml-1 flex h-8 items-center border-l border-line pl-1"
            role="group"
            aria-label={t("Window controls")}
          >
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded text-muted transition-colors hover:bg-hover hover:text-fg"
              aria-label={t("Minimize window")}
              onClick={() =>
                void getCurrentWindow()
                  .minimize()
                  .catch(() => {})
              }
            >
              <Minus className="size-4" />
            </button>
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded text-muted transition-colors hover:bg-hover hover:text-fg"
              aria-label={t(maximized ? "Restore window" : "Maximize window")}
              onClick={() =>
                void getCurrentWindow()
                  .toggleMaximize()
                  .then(() => getCurrentWindow().isMaximized())
                  .then(setMaximized)
                  .catch(() => {})
              }
            >
              {maximized ? <Copy className="size-3.5" /> : <Maximize className="size-3.5" />}
            </button>
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded text-muted transition-colors hover:bg-danger hover:text-white"
              aria-label={t("Close window")}
              onClick={() =>
                void getCurrentWindow()
                  .close()
                  .catch(() => {})
              }
            >
              <X className="size-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
