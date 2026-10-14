import { describe, expect, it } from "vitest";

import type { Group, Profile } from "@/domain/types";

import {
  buildTree,
  descendantIds,
  groupOptions,
  groupPath,
  recentProfiles,
  searchProfiles,
} from "./tree";

const group = (id: string, name: string, parentId: string | null = null): Group => ({
  id,
  name,
  parentId,
  sortOrder: 0,
  expanded: true,
  createdAt: 0,
  updatedAt: 0,
});

const profile = (id: string, name: string, patch: Partial<Profile> = {}): Profile => ({
  id,
  groupId: null,
  name,
  protocol: "ssh",
  host: `${name}.example.com`,
  port: 22,
  username: "deploy",
  authMethod: "password",
  keyPath: null,
  passwordSaved: false,
  passphraseSaved: false,
  favorite: false,
  notes: "",
  color: null,
  tags: [],
  terminal: {},
  ssh: { connectTimeoutSecs: 15, keepaliveIntervalSecs: 30, keepaliveMax: 3, env: [] },
  sortOrder: 0,
  lastConnectedAt: null,
  createdAt: 0,
  updatedAt: 0,
  ...patch,
});

const groups = [
  group("prod", "Production"),
  group("web", "Web", "prod"),
  group("db", "Databases", "prod"),
  group("stg", "Staging"),
];
const profiles = [
  profile("1", "web-2", { groupId: "web", tags: ["nginx"] }),
  profile("2", "web-10", { groupId: "web", lastConnectedAt: 50 }),
  profile("3", "pg", {
    groupId: "db",
    username: "postgres",
    host: "10.0.0.7",
    lastConnectedAt: 100,
  }),
  profile("4", "laptop", { protocol: "local" }),
  profile("5", "orphan", { groupId: "missing" }),
];

describe("buildTree", () => {
  it("nests groups, sorts naturally and counts descendants", () => {
    const tree = buildTree(groups, profiles);
    expect(tree.roots.map((n) => n.group.name)).toEqual(["Production", "Staging"]);
    const prod = tree.roots[0]!;
    expect(prod.children.map((c) => c.group.name)).toEqual(["Databases", "Web"]);
    expect(prod.count).toBe(3);
    // Natural sort: web-2 before web-10.
    expect(prod.children[1]!.profiles.map((p) => p.name)).toEqual(["web-2", "web-10"]);
    // Profiles in unknown groups are shown at the root.
    expect(tree.ungrouped.map((p) => p.name)).toEqual(["laptop", "orphan"]);
  });

  it("survives cyclic group data", () => {
    const cyclic = [group("a", "A", "b"), group("b", "B", "a")];
    expect(() => buildTree(cyclic, [])).not.toThrow();
  });
});

describe("search", () => {
  it("matches name, host, user and tags", () => {
    expect(searchProfiles(profiles, "postgres").map((p) => p.id)).toEqual(["3"]);
    expect(searchProfiles(profiles, "10.0.0").map((p) => p.id)).toEqual(["3"]);
    expect(searchProfiles(profiles, "#nginx").map((p) => p.id)).toEqual(["1"]);
    expect(searchProfiles(profiles, "tag:nginx").map((p) => p.id)).toEqual(["1"]);
    expect(searchProfiles(profiles, "WEB example").map((p) => p.id)).toEqual(["1", "2"]);
    expect(searchProfiles(profiles, "nothing-matches")).toEqual([]);
  });
});

describe("group helpers", () => {
  it("builds paths and descendant sets", () => {
    expect(groupPath(groups, "web")).toBe("Production / Web");
    expect(groupPath(groups, null)).toBe("");
    expect([...descendantIds(groups, "prod")].sort()).toEqual(["db", "prod", "web"]);
    expect(groupOptions(groups).map((g) => `${g.depth}:${g.label}`)).toEqual([
      "0:Production",
      "1:Databases",
      "1:Web",
      "0:Staging",
    ]);
  });

  it("orders recent connections by last use", () => {
    expect(recentProfiles(profiles).map((p) => p.id)).toEqual(["3", "2"]);
  });
});
