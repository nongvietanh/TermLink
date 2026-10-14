// Pure helpers for the connection tree and search.
import type { Group, Profile } from "@/domain/types";

export interface GroupNode {
  group: Group;
  children: GroupNode[];
  profiles: Profile[];
  /** Total profiles in this group and all descendants. */
  count: number;
}

export interface ConnectionTree {
  roots: GroupNode[];
  ungrouped: Profile[];
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

const byGroupName = (a: GroupNode, b: GroupNode) => byName(a.group, b.group);

export function buildTree(groups: Group[], profiles: Profile[]): ConnectionTree {
  const nodes = new Map<string, GroupNode>();
  for (const g of groups) nodes.set(g.id, { group: g, children: [], profiles: [], count: 0 });
  const roots: GroupNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.group.parentId ? nodes.get(node.group.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const ungrouped: Profile[] = [];
  for (const p of profiles) {
    const node = p.groupId ? nodes.get(p.groupId) : undefined;
    if (node) node.profiles.push(p);
    else ungrouped.push(p);
  }
  const finish = (node: GroupNode, depth: number): number => {
    node.children.sort(byGroupName);
    node.profiles.sort(byName);
    // Guard against malformed cycles.
    node.count =
      node.profiles.length +
      (depth > 64 ? 0 : node.children.reduce((n, c) => n + finish(c, depth + 1), 0));
    return node.count;
  };
  roots.sort(byGroupName);
  roots.forEach((r) => finish(r, 0));
  ungrouped.sort(byName);
  return { roots, ungrouped };
}

/** Case-insensitive match on name, host, username, tags and notes. */
export function matchesQuery(p: Profile, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = [
    p.name,
    p.host,
    p.username,
    `${p.username}@${p.host}`,
    ...p.tags.map((t) => `#${t} ${t}`),
  ]
    .join(" ")
    .toLowerCase();
  return terms.every((t) => hay.includes(t.replace(/^tag:/, "#")));
}

export function searchProfiles(profiles: Profile[], query: string): Profile[] {
  return profiles.filter((p) => matchesQuery(p, query)).sort(byName);
}

/** "Production / Web" style path of a group. */
export function groupPath(groups: Group[], id: string | null): string {
  if (!id) return "";
  const map = new Map(groups.map((g) => [g.id, g]));
  const parts: string[] = [];
  let cursor = map.get(id);
  let guard = 0;
  while (cursor && guard++ < 64) {
    parts.unshift(cursor.name);
    cursor = cursor.parentId ? map.get(cursor.parentId) : undefined;
  }
  return parts.join(" / ");
}

/** Ids of a group and all its descendants. */
export function descendantIds(groups: Group[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const g of groups) {
      if (g.parentId && out.has(g.parentId) && !out.has(g.id)) {
        out.add(g.id);
        changed = true;
      }
    }
  }
  return out;
}

/** Flattened group options for selects, indented by depth. */
export function groupOptions(groups: Group[]): { id: string; label: string; depth: number }[] {
  const tree = buildTree(groups, []);
  const out: { id: string; label: string; depth: number }[] = [];
  const walk = (nodes: GroupNode[], depth: number) => {
    for (const n of nodes) {
      out.push({ id: n.group.id, label: n.group.name, depth });
      if (depth < 64) walk(n.children, depth + 1);
    }
  };
  walk(tree.roots, 0);
  return out;
}

export function recentProfiles(profiles: Profile[], limit = 5): Profile[] {
  return profiles
    .filter((p) => p.lastConnectedAt)
    .sort((a, b) => (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0))
    .slice(0, limit);
}
