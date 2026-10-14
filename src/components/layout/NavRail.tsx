import {
  ArrowLeftRight,
  FolderTree,
  History,
  KeyRound,
  LayoutDashboard,
  type LucideIcon,
  Network,
  Server,
  Settings,
  SquareTerminal,
  TextCursorInput,
} from "lucide-react";

import { Tooltip } from "@/components/ui/tooltip";
import { goTo } from "@/lib/actions";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useSessions } from "@/stores/sessions";
import { useUi, type View } from "@/stores/ui";

interface NavItem {
  view: View;
  label: string;
  icon: LucideIcon;
  planned?: boolean;
}

const PRIMARY: NavItem[] = [
  { view: "workspace", label: "Sessions", icon: SquareTerminal },
  { view: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { view: "connections", label: "Connections", icon: Server },
  { view: "groups", label: "Groups", icon: FolderTree },
  { view: "credentials", label: "Saved Credentials", icon: KeyRound },
  { view: "forwarding", label: "Port Forwarding", icon: Network, planned: true },
  { view: "transfers", label: "File Transfers", icon: ArrowLeftRight, planned: true },
  { view: "snippets", label: "Snippets", icon: TextCursorInput },
  { view: "history", label: "History", icon: History },
];

function NavButton({ item, active, badge }: { item: NavItem; active: boolean; badge?: number }) {
  const t = useT();
  const label = t(item.label);
  const Icon = item.icon;
  return (
    <Tooltip content={item.planned ? `${label} (${t("planned")})` : label} side="right">
      <button
        type="button"
        onClick={() => goTo(item.view)}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex size-9 items-center justify-center rounded-lg text-faint transition-colors hover:bg-hover hover:text-fg",
          active && "bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent",
        )}
      >
        {active && (
          <span className="absolute top-2 bottom-2 -left-2 w-0.5 rounded-full bg-accent" />
        )}
        <Icon className="size-[18px]" strokeWidth={1.75} />
        {!!badge && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-fg">
            {badge}
          </span>
        )}
        {item.planned && (
          <span
            className="absolute right-1 bottom-1 size-1.5 rounded-full bg-faint/70"
            aria-hidden
          />
        )}
      </button>
    </Tooltip>
  );
}

export function NavRail() {
  const view = useUi((s) => s.view);
  const sessionCount = useSessions((s) => s.tabs.length);
  return (
    <nav
      aria-label="Main navigation"
      className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-line bg-rail py-2"
    >
      {PRIMARY.map((item, i) => (
        <div key={item.view} className="contents">
          <NavButton
            item={item}
            active={view === item.view}
            badge={item.view === "workspace" ? sessionCount : undefined}
          />
          {i === 0 && <div className="my-1 h-px w-6 bg-line" />}
        </div>
      ))}
      <div className="flex-1" />
      <NavButton
        item={{ view: "settings", label: "Settings", icon: Settings }}
        active={view === "settings"}
      />
    </nav>
  );
}
