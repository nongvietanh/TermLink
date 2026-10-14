import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { Toaster } from "sonner";

import { NavRail } from "@/components/layout/NavRail";
import { StatusBar } from "@/components/layout/StatusBar";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { ConfirmHost } from "@/components/ui/confirm-host";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AppError } from "@/domain/types";
import { ConnectionExplorer } from "@/features/connections/ConnectionExplorer";
import { ConnectionsView } from "@/features/connections/ConnectionsView";
import { GroupDialog } from "@/features/connections/GroupDialog";
import { ProfileDialog } from "@/features/connections/ProfileDialog";
import { QuickConnectDialog } from "@/features/connections/QuickConnectDialog";
import { CredentialsView } from "@/features/credentials/CredentialsView";
import { DashboardView } from "@/features/dashboard/DashboardView";
import { GroupsView } from "@/features/groups/GroupsView";
import { HistoryView } from "@/features/history/HistoryView";
import { CommandPalette } from "@/features/palette/CommandPalette";
import { PlannedView } from "@/features/planned/PlannedView";
import { SettingsView } from "@/features/settings/SettingsView";
import { SnippetDialog, SnippetsView } from "@/features/snippets/SnippetsView";
import { closeAll } from "@/features/terminal/controller";
import { PromptDialogs } from "@/features/terminal/PromptDialogs";
import { applySettingsToAll } from "@/features/terminal/registry";
import { Workspace } from "@/features/terminal/Workspace";
import { SHORTCUT_ACTIONS } from "@/lib/actions";
import { toAppError } from "@/lib/ipc";
import { isComposingKeyEvent, matchShortcut, SHORTCUTS, type ShortcutId } from "@/lib/shortcuts";
import { useLibrary } from "@/stores/library";
import { useSessions } from "@/stores/sessions";
import { resolveTheme, useSettings } from "@/stores/settings";
import { useUi, VIEWS, type View } from "@/stores/ui";

function useGlobalShortcuts() {
  useEffect(() => {
    const ids = Object.keys(SHORTCUTS) as ShortcutId[];
    const onKey = (e: KeyboardEvent) => {
      // Let Vietnamese and other IMEs finish composing before shortcuts run.
      if (isComposingKeyEvent(e)) return;
      if (e.repeat && !["nextTab", "prevTab"].some((id) => matchShortcut(e, id as ShortcutId)))
        return;
      for (const id of ids) {
        const action = SHORTCUT_ACTIONS[id];
        if (action && !SHORTCUTS[id].terminalOnly && matchShortcut(e, id)) {
          e.preventDefault();
          e.stopPropagation();
          action();
          return;
        }
      }
      if (e.key === "F1") {
        e.preventDefault();
        useUi.getState().openPalette();
      }
    };
    // Capture phase: runs before the terminal sees the key.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}

function useAppearance() {
  const settings = useSettings((s) => s.settings);
  const { theme, language, reduceMotion, uiScale } = settings.appearance;
  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(theme);
      document.documentElement.lang = language === "vietnamese" ? "vi" : "en";
      applySettingsToAll(useSettings.getState().settings);
    };
    apply();
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme, language]);
  useEffect(() => {
    document.documentElement.dataset.reduceMotion = String(reduceMotion);
  }, [reduceMotion]);
  useEffect(() => {
    // Native webview zoom keeps xterm's mouse/selection coordinates correct
    // (CSS zoom does not).
    if (!("__TAURI_INTERNALS__" in window)) return;
    void import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) => getCurrentWebview().setZoom(uiScale / 100))
      .catch(() => {});
  }, [uiScale]);
  useEffect(() => applySettingsToAll(settings), [settings]);
}

function MainView({ view }: { view: View }) {
  switch (view) {
    case "workspace":
      return null;
    case "dashboard":
      return <DashboardView />;
    case "connections":
      return <ConnectionsView />;
    case "groups":
      return <GroupsView />;
    case "credentials":
      return <CredentialsView />;
    case "forwarding":
      return <PlannedView feature="forwarding" />;
    case "transfers":
      return <PlannedView feature="transfers" />;
    case "snippets":
      return <SnippetsView />;
    case "history":
      return <HistoryView />;
    case "settings":
      return <SettingsView />;
  }
}

function Shell() {
  const view = useUi((s) => s.view);
  const layout = useSettings((s) => s.settings.layout);
  const update = useSettings((s) => s.update);
  const explorerRef = usePanelRef();

  useEffect(() => {
    const panel = explorerRef.current;
    if (!panel) return;
    if (layout.explorerVisible && panel.isCollapsed()) panel.expand();
    if (!layout.explorerVisible && !panel.isCollapsed()) panel.collapse();
  }, [layout.explorerVisible, explorerRef]);

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <NavRail />
        <Group orientation="horizontal" className="min-w-0 flex-1">
          <Panel
            id="explorer"
            panelRef={explorerRef}
            defaultSize={layout.explorerVisible ? layout.explorerWidth : 0}
            minSize={200}
            maxSize={520}
            collapsible
            collapsedSize={0}
            groupResizeBehavior="preserve-pixel-size"
            onResize={(size) => {
              const px = Math.round(size.inPixels);
              const visible = px > 0;
              if (visible && Math.abs(px - layout.explorerWidth) >= 4 && px >= 160 && px <= 800) {
                update((s) => ({
                  ...s,
                  layout: { ...s.layout, explorerWidth: px, explorerVisible: true },
                }));
              } else if (visible !== layout.explorerVisible) {
                update((s) => ({ ...s, layout: { ...s.layout, explorerVisible: visible } }));
              }
            }}
            className="border-r border-line"
          >
            <ConnectionExplorer />
          </Panel>
          <Separator className="w-px bg-line transition-colors hover:bg-accent/60 data-[separator=active]:bg-accent" />
          <Panel id="main" minSize={420}>
            <main className="relative h-full min-w-0 bg-bg">
              {/* The workspace stays mounted so terminals keep their state. */}
              <div className={view === "workspace" ? "h-full" : "hidden"}>
                <Workspace />
              </div>
              {view !== "workspace" && (
                <div key={view} className="h-full animate-fade-in">
                  <MainView view={view} />
                </div>
              )}
            </main>
          </Panel>
        </Group>
      </div>
      {layout.statusBarVisible && <StatusBar />}
    </div>
  );
}

export default function App() {
  const [error, setError] = useState<AppError | null>(null);
  const [ready, setReady] = useState(false);
  const theme = useSettings((s) => s.settings.appearance.theme);
  useGlobalShortcuts();
  useAppearance();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await Promise.all([useSettings.getState().load(), useLibrary.getState().load()]);
        if (cancelled) return;
        const { layout } = useSettings.getState().settings;
        useSessions.getState().setSplit(layout.splitMode);
        const last = layout.lastView as View;
        useUi.getState().setView(VIEWS.includes(last) && last !== "workspace" ? last : "dashboard");
        setReady(true);
      } catch (err) {
        if (!cancelled) setError(toAppError(err));
      }
    })();
    window.addEventListener("beforeunload", closeAll);
    return () => {
      cancelled = true;
      window.removeEventListener("beforeunload", closeAll);
    };
  }, []);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md rounded-xl border border-danger/40 bg-surface p-6 text-center">
          <AlertTriangle className="mx-auto mb-3 size-6 text-danger" />
          <h1 className="text-base font-semibold text-fg">TermLink could not start</h1>
          <p className="mt-2 text-[13px] text-muted">{error.message}</p>
          <Button className="mt-4" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Loader2 className="size-5 animate-spin" aria-label="Loading" />
      </div>
    );
  }
  return (
    <TooltipProvider delayDuration={350} skipDelayDuration={150}>
      <Shell />
      <CommandPalette />
      <QuickConnectDialog />
      <ProfileDialog />
      <GroupDialog />
      <SnippetDialog />
      <PromptDialogs />
      <ConfirmHost />
      <Toaster
        theme={resolveTheme(theme)}
        position="bottom-right"
        offset={36}
        toastOptions={{
          classNames: {
            toast: "!bg-surface-2 !border-line-strong !text-fg !text-[13px] !shadow-panel",
            description: "!text-muted whitespace-pre-line",
          },
        }}
      />
    </TooltipProvider>
  );
}
