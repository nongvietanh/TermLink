import { Command } from "cmdk";
import {
  ArrowLeftRight,
  Columns2,
  Download,
  Eraser,
  FolderTree,
  History,
  KeyRound,
  LayoutDashboard,
  Monitor,
  Moon,
  Network,
  PanelLeft,
  Plus,
  RotateCw,
  Search,
  Server,
  Settings,
  SquareTerminal,
  Sun,
  Terminal,
  TextCursorInput,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { Dialog as D } from "radix-ui";
import { useState, type ReactNode } from "react";

import { Kbd } from "@/components/ui/kbd";
import { StatusDot } from "@/components/ui/misc";
import {
  clearActive,
  closeActiveTab,
  exportProfiles,
  findInActive,
  goTo,
  importProfiles,
  newConnection,
  quickConnect,
  reconnectActive,
  setTheme,
  toggleExplorer,
  toggleSplit,
} from "@/lib/actions";
import { useT } from "@/lib/i18n";
import { SHORTCUTS, type ShortcutId } from "@/lib/shortcuts";
import { endpointLabel } from "@/lib/utils";
import { useLibrary } from "@/stores/library";
import { activeKeyOf, isLive, tabTone, useSessions } from "@/stores/sessions";
import { useSettings } from "@/stores/settings";
import { useUi, type View } from "@/stores/ui";

import { ProtocolIcon } from "../connections/ConnectionExplorer";
import { sendCommand } from "../snippets/snippetActions";
import { connectProfile, openLocalTerminal } from "../terminal/controller";

const itemCls =
  "flex h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 text-[13px] text-fg outline-none select-none data-[selected=true]:bg-hover data-[disabled=true]:opacity-40 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted";
const groupCls =
  "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-faint [&_[cmdk-group-heading]]:uppercase";

function Item({
  icon,
  children,
  hint,
  shortcut,
  onSelect,
  value,
  keywords,
  disabled,
}: {
  icon: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  shortcut?: ShortcutId;
  onSelect: () => void;
  value: string;
  keywords?: string[];
  disabled?: boolean;
}) {
  const t = useT();
  const close = useUi((s) => s.closePalette);
  return (
    <Command.Item
      value={value}
      keywords={keywords}
      disabled={disabled}
      className={itemCls}
      onSelect={() => {
        close();
        // Run after the dialog closes so focus moves to the right place.
        requestAnimationFrame(onSelect);
      }}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">
        {typeof children === "string" ? t(children) : children}
      </span>
      {hint && <span className="truncate text-[11px] text-faint">{hint}</span>}
      {shortcut && <Kbd keys={SHORTCUTS[shortcut].keys} />}
    </Command.Item>
  );
}

const VIEW_ITEMS: { view: View; label: string; icon: ReactNode }[] = [
  { view: "workspace", label: "Sessions", icon: <SquareTerminal /> },
  { view: "dashboard", label: "Dashboard", icon: <LayoutDashboard /> },
  { view: "connections", label: "Connections", icon: <Server /> },
  { view: "groups", label: "Groups", icon: <FolderTree /> },
  { view: "credentials", label: "Saved credentials", icon: <KeyRound /> },
  { view: "forwarding", label: "Port forwarding (planned)", icon: <Network /> },
  { view: "transfers", label: "File transfers (planned)", icon: <ArrowLeftRight /> },
  { view: "snippets", label: "Snippets", icon: <TextCursorInput /> },
  { view: "history", label: "History", icon: <History /> },
  { view: "settings", label: "Settings", icon: <Settings /> },
];

export function CommandPalette() {
  const t = useT();
  const open = useUi((s) => s.paletteOpen);
  const close = useUi((s) => s.closePalette);
  return (
    <D.Root open={open} onOpenChange={(o) => !o && close()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/45 data-[state=open]:animate-fade-in" />
        <D.Content
          aria-describedby={undefined}
          className="fixed top-[14vh] left-1/2 z-50 w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-line-strong bg-surface shadow-panel outline-none data-[state=open]:animate-pop-in"
        >
          <D.Title className="sr-only">{t("Command palette")}</D.Title>
          {open && <PaletteBody />}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function PaletteBody() {
  const t = useT();
  const initialQuery = useUi((s) => s.paletteQuery);
  const [search, setSearch] = useState(initialQuery);
  const profiles = useLibrary((s) => s.profiles);
  const snippets = useLibrary((s) => s.snippets);
  const tabs = useSessions((s) => s.tabs);
  const activate = useSessions((s) => s.activate);
  const active = useSessions((s) => s.tabs.find((t) => t.key === activeKeyOf(s)));
  const shells = useSettings((s) => s.shells);
  const live = !!active && isLive(active);

  return (
    <Command label={t("Command palette")} loop className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3">
        <Search className="size-4 text-faint" />
        <Command.Input
          autoFocus
          value={search}
          onValueChange={setSearch}
          placeholder={t("Type a command or search connections…")}
          className="h-11 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-faint"
        />
        <Kbd keys="Esc" />
      </div>
      <Command.List className="max-h-[min(440px,60vh)] overflow-y-auto p-1.5">
        <Command.Empty className="py-8 text-center text-xs text-muted">
          {t("No results.")}
        </Command.Empty>

        {tabs.length > 0 && (
          <Command.Group heading={t("Open sessions")} className={groupCls}>
            {tabs.map((tab) => (
              <Item
                key={tab.key}
                value={`session ${tab.title} ${tab.key}`}
                icon={<StatusDot tone={tabTone(tab)} className="mx-1" />}
                hint={t(tab.state)}
                onSelect={() => {
                  activate(tab.key);
                  goTo("workspace");
                }}
              >
                {t("Switch to")} {tab.title}
              </Item>
            ))}
          </Command.Group>
        )}

        <Command.Group heading={t("Connections")} className={groupCls}>
          {profiles.map((p) => (
            <Item
              key={p.id}
              value={`connect ${p.name} ${p.id}`}
              keywords={[p.host, p.username, ...p.tags]}
              icon={<ProtocolIcon profile={p} />}
              hint={p.protocol === "ssh" ? endpointLabel(p.username, p.host, p.port) : p.protocol}
              disabled={p.protocol === "rdp" || p.protocol === "vnc"}
              onSelect={() => connectProfile(p)}
            >
              {t("Connect to")} {p.name}
            </Item>
          ))}
          <Item
            value="quick connect"
            icon={<Zap />}
            shortcut="quickConnect"
            onSelect={quickConnect}
          >
            {t("Quick connect…")}
          </Item>
          <Item
            value="new connection profile create"
            icon={<Plus />}
            shortcut="newConnection"
            onSelect={() => newConnection()}
          >
            {t("New connection…")}
          </Item>
        </Command.Group>

        <Command.Group heading={t("Terminal")} className={groupCls}>
          <Item
            value="open local terminal"
            icon={<Terminal />}
            shortcut="localTerminal"
            onSelect={() => openLocalTerminal()}
          >
            Open local terminal
          </Item>
          {shells.map((s) => (
            <Item
              key={s.id}
              value={`local terminal shell ${s.name}`}
              icon={<Terminal />}
              hint={s.program}
              onSelect={() => openLocalTerminal(s.id)}
            >
              {t("Open")} {s.name}
            </Item>
          ))}
          <Item
            value="toggle split view"
            icon={<Columns2 />}
            shortcut="toggleSplit"
            onSelect={toggleSplit}
            disabled={!tabs.length}
          >
            Toggle split view
          </Item>
          <Item
            value="find in terminal search"
            icon={<Search />}
            shortcut="find"
            onSelect={findInActive}
            disabled={!active}
          >
            Find in terminal
          </Item>
          <Item
            value="clear terminal"
            icon={<Eraser />}
            shortcut="clearTerminal"
            onSelect={clearActive}
            disabled={!active}
          >
            Clear terminal
          </Item>
          <Item
            value="reconnect session"
            icon={<RotateCw />}
            shortcut="reconnect"
            onSelect={reconnectActive}
            disabled={!active}
          >
            Reconnect session
          </Item>
          <Item
            value="close session tab"
            icon={<X />}
            shortcut="closeTab"
            onSelect={closeActiveTab}
            disabled={!active}
          >
            Close session
          </Item>
        </Command.Group>

        {live && snippets.length > 0 && (
          <Command.Group
            heading={`${t("Insert snippet into")} ${active?.title}`}
            className={groupCls}
          >
            {snippets.map((s) => (
              <Item
                key={s.id}
                value={`snippet ${s.name} ${s.id}`}
                keywords={[s.command, s.category, ...s.tags]}
                icon={<TextCursorInput />}
                hint={s.command}
                onSelect={() =>
                  void sendCommand({
                    command: s.command,
                    run: false,
                    source: "palette",
                    label: s.name,
                  })
                }
              >
                {s.name}
              </Item>
            ))}
          </Command.Group>
        )}

        <Command.Group heading={t("Go to")} className={groupCls}>
          {VIEW_ITEMS.map((v) => (
            <Item
              key={v.view}
              value={`go to ${v.label}`}
              icon={v.icon}
              onSelect={() => goTo(v.view)}
              shortcut={v.view === "settings" ? "settings" : undefined}
            >
              {v.label}
            </Item>
          ))}
        </Command.Group>

        <Command.Group heading={t("Preferences")} className={groupCls}>
          <Item value="theme dark" icon={<Moon />} onSelect={() => setTheme("dark")}>
            {t("Theme: Dark")}
          </Item>
          <Item value="theme light" icon={<Sun />} onSelect={() => setTheme("light")}>
            {t("Theme: Light")}
          </Item>
          <Item value="theme system" icon={<Monitor />} onSelect={() => setTheme("system")}>
            {t("Theme: System")}
          </Item>
          <Item
            value="toggle connection explorer sidebar"
            icon={<PanelLeft />}
            shortcut="toggleExplorer"
            onSelect={toggleExplorer}
          >
            Toggle connection explorer
          </Item>
          <Item value="import profiles" icon={<Download />} onSelect={() => void importProfiles()}>
            {t("Import connection profiles…")}
          </Item>
          <Item value="export profiles" icon={<Upload />} onSelect={() => void exportProfiles()}>
            {t("Export connection profiles…")}
          </Item>
        </Command.Group>
      </Command.List>
    </Command>
  );
}
