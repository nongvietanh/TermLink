import { Moon, Search, Settings, Sun, Zap } from "lucide-react";

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
  return (
    <header className="relative z-10 flex h-11 shrink-0 items-center gap-3 border-b border-line bg-rail px-3">
      <div className="flex w-[180px] shrink-0 items-center" aria-label="TermLink">
        <LogoMark className="size-5" />
      </div>
      <div className="flex flex-1 justify-center">
        <button
          type="button"
          onClick={() => openPalette()}
          className="group flex h-7 w-full max-w-[460px] items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 text-xs text-faint transition-colors hover:border-line-strong hover:text-muted"
          aria-label={t("Search connections and commands")}
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">
            {t("Search connections, sessions and commands…")}
          </span>
          <Kbd keys={SHORTCUTS.palette.keys} />
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <Tooltip content={t("Quick connect")} shortcut={SHORTCUTS.quickConnect.keys}>
          <Button variant="primary" size="sm" onClick={quickConnect}>
            <Zap />
            {t("Quick connect")}
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
      </div>
    </header>
  );
}
