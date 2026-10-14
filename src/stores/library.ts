// Persistent library: connection profiles, groups, snippets and known hosts.
// The backend is the source of truth; this store caches its results and
// applies the response of each mutation.
import { create } from "zustand";

import type {
  Group,
  GroupInput,
  KnownHost,
  Profile,
  ProfileInput,
  Snippet,
  SnippetInput,
} from "@/domain/types";
import { api } from "@/lib/ipc";

interface LibraryState {
  loaded: boolean;
  profiles: Profile[];
  groups: Group[];
  snippets: Snippet[];
  knownHosts: KnownHost[];

  load: () => Promise<void>;
  reloadProfiles: () => Promise<void>;
  reloadKnownHosts: () => Promise<void>;

  createProfile: (input: ProfileInput) => Promise<Profile>;
  updateProfile: (id: string, input: ProfileInput) => Promise<Profile>;
  duplicateProfile: (id: string) => Promise<Profile>;
  deleteProfiles: (ids: string[]) => Promise<number>;
  setFavorite: (id: string, favorite: boolean) => Promise<void>;
  moveProfiles: (ids: string[], groupId: string | null) => Promise<void>;
  patchProfile: (id: string, patch: Partial<Profile>) => void;

  createGroup: (input: GroupInput) => Promise<Group>;
  updateGroup: (id: string, input: GroupInput) => Promise<Group>;
  setGroupExpanded: (id: string, expanded: boolean) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;

  createSnippet: (input: SnippetInput) => Promise<Snippet>;
  updateSnippet: (id: string, input: SnippetInput) => Promise<Snippet>;
  deleteSnippet: (id: string) => Promise<void>;
  restoreDefaultSnippets: () => Promise<number>;

  deleteKnownHost: (id: number) => Promise<void>;
}

const upsert = <T extends { id: string }>(list: T[], item: T) =>
  list.some((x) => x.id === item.id)
    ? list.map((x) => (x.id === item.id ? item : x))
    : [...list, item];

export const useLibrary = create<LibraryState>()((set, get) => ({
  loaded: false,
  profiles: [],
  groups: [],
  snippets: [],
  knownHosts: [],

  load: async () => {
    const [profiles, groups, snippets, knownHosts] = await Promise.all([
      api.profilesList(),
      api.groupsList(),
      api.snippetsList(),
      api.knownHostsList(),
    ]);
    set({ profiles, groups, snippets, knownHosts, loaded: true });
  },
  reloadProfiles: async () => {
    const [profiles, groups] = await Promise.all([api.profilesList(), api.groupsList()]);
    set({ profiles, groups });
  },
  reloadKnownHosts: async () => set({ knownHosts: await api.knownHostsList() }),

  createProfile: async (input) => {
    const p = await api.profileCreate(input);
    set({ profiles: upsert(get().profiles, p) });
    return p;
  },
  updateProfile: async (id, input) => {
    const p = await api.profileUpdate(id, input);
    set({ profiles: upsert(get().profiles, p) });
    return p;
  },
  duplicateProfile: async (id) => {
    const p = await api.profileDuplicate(id);
    set({ profiles: upsert(get().profiles, p) });
    return p;
  },
  deleteProfiles: async (ids) => {
    const n = await api.profilesDelete(ids);
    const gone = new Set(ids);
    set({ profiles: get().profiles.filter((p) => !gone.has(p.id)) });
    return n;
  },
  setFavorite: async (id, favorite) => {
    const p = await api.profileSetFavorite(id, favorite);
    set({ profiles: upsert(get().profiles, p) });
  },
  moveProfiles: async (ids, groupId) => {
    await api.profilesMove(ids, groupId);
    const moved = new Set(ids);
    set({ profiles: get().profiles.map((p) => (moved.has(p.id) ? { ...p, groupId } : p)) });
  },
  patchProfile: (id, patch) =>
    set({ profiles: get().profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)) }),

  createGroup: async (input) => {
    const g = await api.groupCreate(input);
    set({ groups: upsert(get().groups, g) });
    return g;
  },
  updateGroup: async (id, input) => {
    const g = await api.groupUpdate(id, input);
    set({ groups: upsert(get().groups, g) });
    return g;
  },
  setGroupExpanded: async (id, expanded) => {
    set({ groups: get().groups.map((g) => (g.id === id ? { ...g, expanded } : g)) });
    await api.groupSetExpanded(id, expanded);
  },
  deleteGroup: async (id) => {
    await api.groupDelete(id);
    // Children were re-parented by the backend; reload to reflect it.
    await get().reloadProfiles();
  },

  createSnippet: async (input) => {
    const s = await api.snippetCreate(input);
    set({ snippets: upsert(get().snippets, s) });
    return s;
  },
  updateSnippet: async (id, input) => {
    const s = await api.snippetUpdate(id, input);
    set({ snippets: upsert(get().snippets, s) });
    return s;
  },
  deleteSnippet: async (id) => {
    await api.snippetDelete(id);
    set({ snippets: get().snippets.filter((s) => s.id !== id) });
  },
  restoreDefaultSnippets: async () => {
    const before = get().snippets.length;
    const snippets = await api.snippetsRestoreDefaults();
    set({ snippets });
    return Math.max(0, snippets.length - before);
  },

  deleteKnownHost: async (id) => {
    await api.knownHostDelete(id);
    set({ knownHosts: get().knownHosts.filter((k) => k.id !== id) });
  },
}));

/** Profile input from an existing profile (for editing). */
export function toProfileInput(p: Profile): ProfileInput {
  return {
    groupId: p.groupId,
    name: p.name,
    protocol: p.protocol,
    host: p.host,
    port: p.port,
    username: p.username,
    authMethod: p.authMethod,
    keyPath: p.keyPath,
    favorite: p.favorite,
    notes: p.notes,
    color: p.color,
    tags: p.tags,
    terminal: p.terminal,
    ssh: p.ssh,
  };
}
