import {
  ChevronRight,
  Clock,
  Copy,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Monitor,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Search,
  Server,
  Star,
  StarOff,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState, type DragEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { Badge, EmptyState, StatusDot, type StatusTone } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import type { Group, Profile } from "@/domain/types";
import { importProfiles, newConnection } from "@/lib/actions";
import { useT } from "@/lib/i18n";
import { attempt } from "@/lib/notify";
import { cn, endpointLabel } from "@/lib/utils";
import { confirm } from "@/stores/confirm";
import { useLibrary } from "@/stores/library";
import { tabTone, useSessions } from "@/stores/sessions";
import { useUi } from "@/stores/ui";

import { connectProfile } from "../terminal/controller";
import { buildTree, groupOptions, recentProfiles, searchProfiles, type GroupNode } from "./tree";

const DRAG_TYPE = "application/x-termlink-profile";

/** Live status per profile, derived from open session tabs. */
function useProfileStatus(): Map<string, StatusTone> {
  const tabs = useSessions((s) => s.tabs);
  return useMemo(() => {
    const rank: Record<StatusTone, number> = { idle: 0, error: 1, connecting: 2, connected: 3 };
    const map = new Map<string, StatusTone>();
    for (const t of tabs) {
      if (!t.profileId) continue;
      const tone = tabTone(t);
      const prev = map.get(t.profileId);
      if (!prev || rank[tone] > rank[prev]) map.set(t.profileId, tone);
    }
    return map;
  }, [tabs]);
}

export function ProtocolIcon({ profile, className }: { profile: Profile; className?: string }) {
  const Icon =
    profile.protocol === "local" ? Terminal : profile.protocol === "ssh" ? Server : Monitor;
  return (
    <Icon
      className={cn("size-3.5 shrink-0", className)}
      style={profile.color ? { color: profile.color } : undefined}
    />
  );
}

export async function deleteProfilesWithConfirm(profiles: Profile[]) {
  if (!profiles.length) return;
  const single = profiles.length === 1;
  const ok = await confirm({
    title: single ? `Delete "${profiles[0]!.name}"?` : `Delete ${profiles.length} connections?`,
    description:
      "Saved passwords and passphrases for these profiles are removed from the credential store. This cannot be undone.",
    confirmLabel: "Delete",
    tone: "danger",
  });
  if (ok)
    await attempt(
      () => useLibrary.getState().deleteProfiles(profiles.map((p) => p.id)),
      "Could not delete",
    );
}

export async function deleteGroupWithConfirm(group: Group) {
  const ok = await confirm({
    title: `Delete group "${group.name}"?`,
    description:
      "Connections and subgroups inside it are moved to the parent group. No connection is deleted.",
    confirmLabel: "Delete group",
    tone: "danger",
  });
  if (ok)
    await attempt(() => useLibrary.getState().deleteGroup(group.id), "Could not delete group");
}

function MoveMenu({ profiles }: { profiles: Profile[] }) {
  const t = useT();
  const groups = useLibrary((s) => s.groups);
  const move = (groupId: string | null) =>
    void attempt(
      () =>
        useLibrary.getState().moveProfiles(
          profiles.map((p) => p.id),
          groupId,
        ),
      "Could not move",
    );
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger icon={<FolderInput />}>{t("Move to")}</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuItem onSelect={() => move(null)}>{t("No group")}</ContextMenuItem>
        {groupOptions(groups).map((g) => (
          <ContextMenuItem key={g.id} onSelect={() => move(g.id)}>
            <span style={{ paddingLeft: g.depth * 12 }}>{g.label}</span>
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

function ProfileRow({
  profile,
  depth,
  status,
  subtitle,
}: {
  profile: Profile;
  depth: number;
  status: StatusTone | undefined;
  subtitle?: ReactNode;
}) {
  const t = useT();
  const editProfile = useUi((s) => s.editProfile);
  const lib = useLibrary.getState;
  const planned = profile.protocol === "rdp" || profile.protocol === "vnc";
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(DRAG_TYPE, profile.id);
    e.dataTransfer.effectAllowed = "move";
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="treeitem"
          aria-selected={false}
          tabIndex={0}
          draggable
          onDragStart={onDragStart}
          onDoubleClick={() => connectProfile(profile)}
          onKeyDown={(e) => {
            if (e.key === "Enter") connectProfile(profile);
            if (e.key === "F2") editProfile({ mode: "edit", profileId: profile.id });
            if (e.key === "Delete") void deleteProfilesWithConfirm([profile]);
          }}
          className="group flex h-7 cursor-default items-center gap-2 rounded-md pr-1 text-[13px] text-fg outline-none hover:bg-hover focus-visible:bg-hover focus-visible:ring-1 focus-visible:ring-accent/50"
          style={{ paddingLeft: 8 + depth * 14 }}
          data-testid={`profile-row-${profile.name}`}
          title={`${profile.name}${profile.protocol === "ssh" ? ` — ${endpointLabel(profile.username, profile.host, profile.port)}` : ""}\n${t("Double-click to connect")}`}
        >
          <StatusDot
            tone={status ?? "idle"}
            className="size-1.5"
            title={status ?? "Not connected"}
          />
          <ProtocolIcon profile={profile} className="text-muted" />
          <span className="min-w-0 flex-1 truncate">
            {profile.name}
            {subtitle ??
              (profile.protocol === "ssh" && (
                <span className="ml-1.5 text-[11px] text-faint">{profile.host}</span>
              ))}
          </span>
          {planned && <Badge className="h-4 text-[10px]">{t("planned")}</Badge>}
          {profile.favorite && (
            <Star className="size-3 fill-warning text-warning" aria-label={t("Favorite")} />
          )}
          <Tooltip content={t("Connect")}>
            <button
              type="button"
              aria-label={`${t("Connect to")} ${profile.name}`}
              onClick={() => connectProfile(profile)}
              className="hidden size-5 items-center justify-center rounded text-muted group-hover:flex hover:bg-surface-3 hover:text-accent"
            >
              <Play className="size-3" />
            </button>
          </Tooltip>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          icon={<Play />}
          onSelect={() => connectProfile(profile)}
          disabled={planned}
        >
          {t("Connect")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          icon={<Pencil />}
          shortcut="F2"
          onSelect={() => editProfile({ mode: "edit", profileId: profile.id })}
        >
          {t("Edit")}
        </ContextMenuItem>
        <ContextMenuItem
          icon={<Copy />}
          onSelect={() => void attempt(() => lib().duplicateProfile(profile.id))}
        >
          {t("Duplicate")}
        </ContextMenuItem>
        <ContextMenuItem
          icon={profile.favorite ? <StarOff /> : <Star />}
          onSelect={() => void attempt(() => lib().setFavorite(profile.id, !profile.favorite))}
        >
          {t(profile.favorite ? "Remove from favorites" : "Add to favorites")}
        </ContextMenuItem>
        <MoveMenu profiles={[profile]} />
        <ContextMenuSeparator />
        <ContextMenuItem
          icon={<Trash2 />}
          danger
          shortcut="Del"
          onSelect={() => void deleteProfilesWithConfirm([profile])}
        >
          {t("Delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function GroupRow({
  node,
  depth,
  status,
}: {
  node: GroupNode;
  depth: number;
  status: Map<string, StatusTone>;
}) {
  const t = useT();
  const { group } = node;
  const editGroup = useUi((s) => s.editGroup);
  const [dragOver, setDragOver] = useState(false);
  const toggle = () =>
    void attempt(() => useLibrary.getState().setGroupExpanded(group.id, !group.expanded));
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const id = e.dataTransfer.getData(DRAG_TYPE);
    if (id)
      void attempt(() => useLibrary.getState().moveProfiles([id], group.id), "Could not move");
  };
  return (
    <div role="group">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            role="treeitem"
            aria-expanded={group.expanded}
            aria-selected={false}
            tabIndex={0}
            onClick={toggle}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggle();
              }
              if (e.key === "ArrowRight" && !group.expanded) toggle();
              if (e.key === "ArrowLeft" && group.expanded) toggle();
              if (e.key === "F2") editGroup({ mode: "edit", groupId: group.id });
            }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(DRAG_TYPE)) {
                e.preventDefault();
                setDragOver(true);
              }
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={cn(
              "flex h-7 cursor-default items-center gap-1.5 rounded-md pr-2 text-[13px] text-muted outline-none hover:bg-hover hover:text-fg focus-visible:bg-hover focus-visible:ring-1 focus-visible:ring-accent/50",
              dragOver && "bg-accent-soft text-accent ring-1 ring-accent/40",
            )}
            style={{ paddingLeft: 4 + depth * 14 }}
          >
            <ChevronRight
              className={cn(
                "size-3.5 shrink-0 transition-transform",
                group.expanded && "rotate-90",
              )}
            />
            {group.expanded ? (
              <FolderOpen className="size-3.5 shrink-0" />
            ) : (
              <Folder className="size-3.5 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate font-medium">{group.name}</span>
            <span className="text-[11px] text-faint">{node.count}</span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem icon={<Plus />} onSelect={() => newConnection(group.id)}>
            {t("New connection here")}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<FolderPlus />}
            onSelect={() => editGroup({ mode: "create", parentId: group.id })}
          >
            {t("New subgroup")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            icon={<Pencil />}
            shortcut="F2"
            onSelect={() => editGroup({ mode: "edit", groupId: group.id })}
          >
            {t("Rename / move")}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Trash2 />}
            danger
            onSelect={() => void deleteGroupWithConfirm(group)}
          >
            {t("Delete group")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {group.expanded && (
        <div>
          {node.children.map((c) => (
            <GroupRow key={c.group.id} node={c} depth={depth + 1} status={status} />
          ))}
          {node.profiles.map((p) => (
            <ProfileRow key={p.id} profile={p} depth={depth + 1} status={status.get(p.id)} />
          ))}
          {!node.children.length && !node.profiles.length && (
            <p className="py-1 text-[11px] text-faint" style={{ paddingLeft: 30 + depth * 14 }}>
              {t("Empty group")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div className="mb-2">
      <div className="flex h-6 items-center gap-1.5 px-2 text-[11px] font-semibold tracking-wider text-faint uppercase [&_svg]:size-3">
        {icon}
        {t(title)}
      </div>
      {children}
    </div>
  );
}

export function ConnectionExplorer() {
  const t = useT();
  const profiles = useLibrary((s) => s.profiles);
  const groups = useLibrary((s) => s.groups);
  const loaded = useLibrary((s) => s.loaded);
  const query = useUi((s) => s.explorerQuery);
  const setQuery = useUi((s) => s.setExplorerQuery);
  const editGroup = useUi((s) => s.editGroup);
  const status = useProfileStatus();
  const [rootDrop, setRootDrop] = useState(false);

  const tree = useMemo(() => buildTree(groups, profiles), [groups, profiles]);
  const favorites = useMemo(() => profiles.filter((p) => p.favorite), [profiles]);
  const recent = useMemo(() => recentProfiles(profiles, 5), [profiles]);
  const results = useMemo(
    () => (query.trim() ? searchProfiles(profiles, query) : null),
    [profiles, query],
  );
  const groupName = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);

  const collapseAll = () => {
    for (const g of groups)
      if (g.expanded) void useLibrary.getState().setGroupExpanded(g.id, false);
  };

  return (
    <aside
      aria-label={t("Connection explorer")}
      className="flex h-full min-w-0 flex-col bg-surface"
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line pr-1.5 pl-3">
        <h2 className="flex-1 text-xs font-semibold tracking-wide text-muted uppercase">
          {t("Connections")}
        </h2>
        <Tooltip content={t("New connection")}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("New connection")}
            onClick={() => newConnection()}
          >
            <Plus />
          </Button>
        </Tooltip>
        <Tooltip content={t("New group")}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("New group")}
            onClick={() => editGroup({ mode: "create", parentId: null })}
          >
            <FolderPlus />
          </Button>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t("More explorer actions")}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={collapseAll}>{t("Collapse all groups")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void importProfiles()}>
              {t("Import profiles…")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="shrink-0 p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder={t("Filter by name, host, user, #tag")}
            aria-label={t("Filter connections")}
            className="h-7 pr-7 pl-7 text-xs"
          />
          {query && (
            <button
              type="button"
              aria-label={t("Clear filter")}
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-faint hover:text-fg"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>
      <div
        role="tree"
        aria-label={t("Connections")}
        className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3"
      >
        {!loaded ? null : results ? (
          results.length ? (
            <Section
              title={`${results.length} ${t(results.length === 1 ? "result" : "results")}`}
              icon={<Search />}
            >
              {results.map((p) => (
                <ProfileRow
                  key={p.id}
                  profile={p}
                  depth={0}
                  status={status.get(p.id)}
                  subtitle={
                    <span className="ml-1.5 text-[11px] text-faint">
                      {p.protocol === "ssh"
                        ? endpointLabel(p.username, p.host, p.port)
                        : p.protocol}
                      {p.groupId && groupName.get(p.groupId)
                        ? ` · ${groupName.get(p.groupId)}`
                        : ""}
                    </span>
                  }
                />
              ))}
            </Section>
          ) : (
            <EmptyState
              icon={<Search />}
              title={t("No matches")}
              description={`${t("Nothing matches")} "${query}".`}
            />
          )
        ) : profiles.length === 0 && groups.length === 0 ? (
          <EmptyState
            icon={<Server />}
            title="No connections yet"
            description={t("Save a server to connect with one click.")}
            action={
              <Button variant="primary" size="sm" onClick={() => newConnection()}>
                <Plus />
                {t("New connection")}
              </Button>
            }
          />
        ) : (
          <>
            {favorites.length > 0 && (
              <Section title="Favorites" icon={<Star />}>
                {favorites.map((p) => (
                  <ProfileRow key={`fav-${p.id}`} profile={p} depth={0} status={status.get(p.id)} />
                ))}
              </Section>
            )}
            {recent.length > 0 && (
              <Section title="Recent" icon={<Clock />}>
                {recent.map((p) => (
                  <ProfileRow
                    key={`recent-${p.id}`}
                    profile={p}
                    depth={0}
                    status={status.get(p.id)}
                  />
                ))}
              </Section>
            )}
            <div
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(DRAG_TYPE)) {
                  e.preventDefault();
                  setRootDrop(true);
                }
              }}
              onDragLeave={() => setRootDrop(false)}
              onDrop={(e) => {
                setRootDrop(false);
                const id = e.dataTransfer.getData(DRAG_TYPE);
                if (id && e.target === e.currentTarget) {
                  e.preventDefault();
                  void attempt(() => useLibrary.getState().moveProfiles([id], null));
                }
              }}
              className={cn("rounded-md", rootDrop && "bg-accent-soft/40")}
            >
              <Section title="All connections" icon={<Server />}>
                {tree.roots.map((n) => (
                  <GroupRow key={n.group.id} node={n} depth={0} status={status} />
                ))}
                {tree.ungrouped.map((p) => (
                  <ProfileRow key={p.id} profile={p} depth={0} status={status.get(p.id)} />
                ))}
              </Section>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
