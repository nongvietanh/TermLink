import {
  Columns2,
  Copy,
  Eraser,
  KeyRound,
  Plug,
  PlugZap,
  Plus,
  RotateCw,
  Rows2,
  Search,
  Server,
  ShieldCheck,
  Square,
  SquareTerminal,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import { useState, type DragEvent } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { Badge, StatusDot } from "@/components/ui/misc";
import { ServerMetricsPanel } from "@/components/layout/ServerMetrics";
import { Tooltip } from "@/components/ui/tooltip";
import { findInActive, newConnection, quickConnect, setSplit } from "@/lib/actions";
import { SHORTCUTS, shortcutLabel } from "@/lib/shortcuts";
import { cn, endpointLabel } from "@/lib/utils";
import { useLibrary } from "@/stores/library";
import { activeKeyOf, isLive, tabTone, useSessions, type SessionTab } from "@/stores/sessions";
import { useSettings } from "@/stores/settings";

import { recentProfiles } from "../connections/tree";
import { ProtocolIcon } from "../connections/ConnectionExplorer";
import {
  clearTerminal,
  closeTab,
  connectProfile,
  disconnect,
  openLocalTerminal,
  openSession,
  reconnect,
} from "./controller";
import { TerminalPane } from "./TerminalPane";

const TAB_DRAG = "application/x-termlink-tab";

function SessionTabButton({
  tab,
  active,
  visibleElsewhere,
}: {
  tab: SessionTab;
  active: boolean;
  visibleElsewhere: boolean;
}) {
  const activate = useSessions((s) => s.activate);
  const reorder = useSessions((s) => s.reorder);
  const [over, setOver] = useState(false);
  const Icon = tab.kind === "local" ? Terminal : Server;
  const needsAttention = tab.prompts.length > 0;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="tab"
          aria-selected={active}
          tabIndex={0}
          draggable
          onDragStart={(e: DragEvent) => e.dataTransfer.setData(TAB_DRAG, tab.key)}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(TAB_DRAG)) {
              e.preventDefault();
              setOver(true);
            }
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            setOver(false);
            const from = e.dataTransfer.getData(TAB_DRAG);
            if (from) reorder(from, tab.key);
          }}
          onClick={() => activate(tab.key)}
          onAuxClick={(e) => e.button === 1 && void closeTab(tab.key)}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && activate(tab.key)}
          title={
            tab.info
              ? `${tab.title} — ${endpointLabel(tab.info.username, tab.info.host, tab.info.port)}`
              : tab.title
          }
          className={cn(
            "group relative flex h-full max-w-[220px] min-w-[120px] cursor-default items-center gap-2 border-r border-line pr-1.5 pl-3 text-xs text-muted transition-colors select-none hover:bg-surface-2 hover:text-fg",
            active && "bg-surface text-fg",
            visibleElsewhere && !active && "text-fg/80",
            over && "bg-accent-soft",
          )}
        >
          {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" />}
          {tab.color && (
            <span className="absolute inset-y-0 left-0 w-0.5" style={{ background: tab.color }} />
          )}
          <StatusDot tone={tabTone(tab)} className="size-1.5" />
          <Icon className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{tab.title}</span>
          {needsAttention && (
            <KeyRound
              className="size-3 animate-pulse-soft text-warning"
              aria-label="Waiting for input"
            />
          )}
          {tab.unread && !active && !needsAttention && (
            <span className="size-1.5 rounded-full bg-accent" aria-label="New output" />
          )}
          <button
            type="button"
            aria-label={`Close ${tab.title}`}
            onClick={(e) => {
              e.stopPropagation();
              void closeTab(tab.key);
            }}
            className="flex size-5 shrink-0 items-center justify-center rounded text-faint opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-fg focus:opacity-100 aria-selected:opacity-100"
          >
            <X className="size-3" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          icon={<RotateCw />}
          onSelect={() => void reconnect(tab.key)}
          shortcut={shortcutLabel("reconnect")}
        >
          Reconnect
        </ContextMenuItem>
        <ContextMenuItem
          icon={<Plug />}
          disabled={!isLive(tab)}
          onSelect={() => disconnect(tab.key)}
        >
          Disconnect
        </ContextMenuItem>
        <ContextMenuItem
          icon={<Copy />}
          onSelect={() =>
            openSession(tab.request, {
              title: tab.title,
              kind: tab.kind,
              profile: useLibrary.getState().profiles.find((p) => p.id === tab.profileId),
            })
          }
        >
          Duplicate session
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          icon={<X />}
          onSelect={() => void closeTab(tab.key)}
          shortcut={shortcutLabel("closeTab")}
        >
          Close
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={async () => {
            for (const t of useSessions.getState().tabs)
              if (t.key !== tab.key) await closeTab(t.key);
          }}
        >
          Close other sessions
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function NewSessionMenu() {
  const profiles = useLibrary((s) => s.profiles);
  const shells = useSettings((s) => s.shells);
  const recent = recentProfiles(profiles, 6);
  return (
    <DropdownMenu>
      <Tooltip content="New session">
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-full rounded-none"
            aria-label="New session"
          >
            <Plus />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem
          icon={<Zap />}
          onSelect={quickConnect}
          shortcut={shortcutLabel("quickConnect")}
        >
          Quick connect…
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<Plus />}
          onSelect={() => newConnection()}
          shortcut={shortcutLabel("newConnection")}
        >
          New connection profile…
        </DropdownMenuItem>
        {shells.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Local terminal</DropdownMenuLabel>
            {shells.map((s) => (
              <DropdownMenuItem
                key={s.id}
                icon={<Terminal />}
                onSelect={() => openLocalTerminal(s.id)}
              >
                {s.name}
              </DropdownMenuItem>
            ))}
          </>
        )}
        {recent.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Recent</DropdownMenuLabel>
            {recent.map((p) => (
              <DropdownMenuItem
                key={p.id}
                icon={<ProtocolIcon profile={p} />}
                onSelect={() => connectProfile(p)}
              >
                {p.name}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SessionToolbar({ tab }: { tab: SessionTab }) {
  const split = useSessions((s) => s.split);
  const live = isLive(tab);
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-xs">
        <StatusDot tone={tabTone(tab)} />
        <span className="truncate font-medium text-fg">{tab.title}</span>
        {tab.info && tab.kind === "ssh" && (
          <span className="truncate font-mono text-[11px] text-muted">
            {endpointLabel(tab.info.username, tab.info.host, tab.info.port)}
          </span>
        )}
        {tab.kind === "local" && <Badge>local</Badge>}
        {tab.info?.hostKeyFingerprint && (
          <Tooltip
            content={
              <span className="font-mono">
                {tab.info.hostKeyAlgorithm} {tab.info.hostKeyFingerprint}
              </span>
            }
          >
            <span className="flex items-center gap-1 text-[11px] text-success">
              <ShieldCheck className="size-3.5" />
              Verified host
            </span>
          </Tooltip>
        )}
        {tab.exit && tab.exit.code !== null && (
          <Badge tone={tab.exit.code === 0 ? "neutral" : "danger"}>exit {tab.exit.code}</Badge>
        )}
      </div>
      <div className="flex items-center gap-0.5">
        <Tooltip content="Find" shortcut={SHORTCUTS.find.keys}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Find in terminal"
            onClick={findInActive}
          >
            <Search />
          </Button>
        </Tooltip>
        <Tooltip content="Clear terminal" shortcut={SHORTCUTS.clearTerminal.keys}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Clear terminal"
            onClick={() => clearTerminal(tab.key)}
          >
            <Eraser />
          </Button>
        </Tooltip>
        <div className="mx-1 h-4 w-px bg-line" />
        <Tooltip
          content={split === "single" ? "Split right" : "Single pane"}
          shortcut={SHORTCUTS.toggleSplit.keys}
        >
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Toggle split view"
            aria-pressed={split !== "single"}
            onClick={() => setSplit(split === "single" ? "horizontal" : "single")}
          >
            {split === "single" ? <Columns2 /> : <Square />}
          </Button>
        </Tooltip>
        {split !== "single" && (
          <Tooltip
            content={split === "horizontal" ? "Stack panes vertically" : "Place panes side by side"}
          >
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Change split orientation"
              onClick={() => setSplit(split === "horizontal" ? "vertical" : "horizontal")}
            >
              {split === "horizontal" ? <Rows2 /> : <Columns2 />}
            </Button>
          </Tooltip>
        )}
        <div className="mx-1 h-4 w-px bg-line" />
        {live ? (
          <Button variant="ghost" size="sm" onClick={() => disconnect(tab.key)}>
            <Plug />
            Disconnect
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => void reconnect(tab.key)}>
            <PlugZap />
            Reconnect
          </Button>
        )}
      </div>
    </div>
  );
}

function PanePlaceholder({ onPick }: { onPick: (key: string) => void }) {
  const tabs = useSessions((s) => s.tabs);
  const panes = useSessions((s) => s.panes);
  const available = tabs.filter((t) => !panes.includes(t.key));
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-terminal p-6 text-center">
      <SquareTerminal className="size-6 text-faint" />
      <p className="text-xs text-muted">Choose a session for this pane</p>
      <div className="flex max-w-sm flex-wrap justify-center gap-1.5">
        {available.map((t) => (
          <Button key={t.key} size="sm" variant="secondary" onClick={() => onPick(t.key)}>
            {t.title}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => openLocalTerminal()}>
          <Terminal />
          Local terminal
        </Button>
      </div>
    </div>
  );
}

function Pane({ index }: { index: 0 | 1 }) {
  const key = useSessions((s) => s.panes[index]);
  const split = useSessions((s) => s.split);
  const focused = useSessions((s) => s.split === "single" || s.focusedPane === index);
  const focusPane = useSessions((s) => s.focusPane);
  const activate = useSessions((s) => s.activate);
  return (
    <div
      className={cn(
        "h-full min-h-0 min-w-0",
        split !== "single" && "border border-transparent",
        split !== "single" && focused && "border-accent/40",
      )}
    >
      {key ? (
        <TerminalPane tabKey={key} focused={focused} onFocus={() => focusPane(index)} />
      ) : (
        <PanePlaceholder
          onPick={(k) => {
            focusPane(index);
            activate(k);
          }}
        />
      )}
    </div>
  );
}

function WelcomeScreen() {
  const profiles = useLibrary((s) => s.profiles);
  const recent = recentProfiles(profiles, 6);
  const favorites = profiles.filter((p) => p.favorite).slice(0, 6);
  const list = favorites.length ? favorites : recent;
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-bg p-8">
      <div className="w-full max-w-xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl border border-line bg-surface text-accent">
            <SquareTerminal className="size-6" />
          </div>
          <h2 className="text-lg font-semibold text-fg">No open sessions</h2>
          <p className="mt-1 text-[13px] text-muted">
            Connect to a server or start a local terminal.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            {
              icon: <Zap />,
              label: "Quick connect",
              keys: SHORTCUTS.quickConnect.keys,
              onClick: quickConnect,
            },
            {
              icon: <Plus />,
              label: "New connection",
              keys: SHORTCUTS.newConnection.keys,
              onClick: () => newConnection(),
            },
            {
              icon: <Terminal />,
              label: "Local terminal",
              keys: SHORTCUTS.localTerminal.keys,
              onClick: () => openLocalTerminal(),
            },
          ].map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={a.onClick}
              className="flex flex-col items-center gap-2 rounded-xl border border-line bg-surface px-3 py-4 text-[13px] text-fg transition-colors hover:border-accent/50 hover:bg-surface-2 [&>svg]:size-5 [&>svg]:text-accent"
            >
              {a.icon}
              {a.label}
              <Kbd keys={a.keys} />
            </button>
          ))}
        </div>
        {list.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-faint uppercase">
              {favorites.length ? "Favorites" : "Recent connections"}
            </h3>
            <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {list.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => connectProfile(p)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-[13px] transition-colors hover:bg-surface-2"
                >
                  <ProtocolIcon profile={p} className="text-muted" />
                  <span className="flex-1 truncate text-fg">{p.name}</span>
                  {p.protocol === "ssh" && (
                    <span className="truncate font-mono text-[11px] text-faint">
                      {endpointLabel(p.username, p.host, p.port)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Workspace() {
  const tabs = useSessions((s) => s.tabs);
  const split = useSessions((s) => s.split);
  const panes = useSessions((s) => s.panes);
  const activeKey = useSessions((s) => activeKeyOf(s));
  const active = tabs.find((t) => t.key === activeKey);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div
        role="tablist"
        aria-label="Open sessions"
        className="flex h-9 shrink-0 items-stretch border-b border-line bg-rail"
      >
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {tabs.map((t) => (
            <SessionTabButton
              key={t.key}
              tab={t}
              active={t.key === activeKey}
              visibleElsewhere={split !== "single" && panes.includes(t.key)}
            />
          ))}
        </div>
        <NewSessionMenu />
      </div>
      {tabs.length === 0 ? (
        <WelcomeScreen />
      ) : (
        <>
          {active && <SessionToolbar tab={active} />}
          {active?.kind === "ssh" && <ServerMetricsPanel tab={active} />}
          <div className="min-h-0 flex-1">
            {split === "single" ? (
              <Pane index={0} />
            ) : (
              <Group
                orientation={split === "horizontal" ? "horizontal" : "vertical"}
                className="h-full"
              >
                <Panel id="pane-0" minSize={200}>
                  <Pane index={0} />
                </Panel>
                <Separator
                  className={cn(
                    "bg-line transition-colors hover:bg-accent/60 data-[separator=active]:bg-accent",
                    split === "horizontal" ? "w-1" : "h-1",
                  )}
                />
                <Panel id="pane-1" minSize={200}>
                  <Pane index={1} />
                </Panel>
              </Group>
            )}
          </div>
        </>
      )}
    </div>
  );
}
