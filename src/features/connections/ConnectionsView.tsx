import {
  Download,
  FolderInput,
  Lock,
  Pencil,
  Play,
  Plus,
  Search,
  Server,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { Badge, EmptyState, PageHeader } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import type { AuthMethod, Profile } from "@/domain/types";
import { exportProfiles, importProfiles, newConnection } from "@/lib/actions";
import { useT } from "@/lib/i18n";
import { attempt } from "@/lib/notify";
import { endpointLabel, formatRelative } from "@/lib/utils";
import { useLibrary } from "@/stores/library";
import { useUi } from "@/stores/ui";

import { connectProfile } from "../terminal/controller";
import { deleteProfilesWithConfirm, ProtocolIcon } from "./ConnectionExplorer";
import { groupOptions, groupPath, searchProfiles } from "./tree";

const AUTH_LABEL: Record<AuthMethod, string> = {
  password: "Password",
  public_key: "Key",
  agent: "Agent",
  keyboard_interactive: "Interactive",
};

type SortKey = "name" | "host" | "lastConnectedAt";

export function ConnectionsView() {
  const t = useT();
  const profiles = useLibrary((s) => s.profiles);
  const groups = useLibrary((s) => s.groups);
  const editProfile = useUi((s) => s.editProfile);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });

  const rows = useMemo(() => {
    const list = searchProfiles(profiles, query);
    const val = (p: Profile) =>
      sort.key === "lastConnectedAt" ? (p.lastConnectedAt ?? 0) : p[sort.key].toLowerCase();
    return [...list].sort((a, b) => (val(a) < val(b) ? -sort.dir : val(a) > val(b) ? sort.dir : 0));
  }, [profiles, query, sort]);

  const selectedProfiles = rows.filter((p) => selected.has(p.id));
  const allChecked = rows.length > 0 && selectedProfiles.length === rows.length;
  const someChecked = selectedProfiles.length > 0 && !allChecked;
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const header = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}
      className="font-semibold hover:text-fg"
      aria-label={`${t("Sort by")} ${t(label)}`}
    >
      {t(label)}
      {sort.key === key && <span className="ml-1 text-accent">{sort.dir === 1 ? "↑" : "↓"}</span>}
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t("Connections")}
        icon={<Server />}
        description={`${profiles.length} ${t(profiles.length === 1 ? "saved connection" : "saved connections")}`}
        actions={
          <>
            <Button variant="ghost" onClick={() => void importProfiles()}>
              <Download />
              {t("Import")}
            </Button>
            <Tooltip
              content={t("Exports hostnames, usernames and settings. Never passwords or keys.")}
            >
              <Button
                variant="ghost"
                onClick={() => void exportProfiles()}
                disabled={!profiles.length}
              >
                <Upload />
                {t("Export")}
              </Button>
            </Tooltip>
            <Button variant="primary" onClick={() => newConnection()}>
              <Plus />
              {t("New connection")}
            </Button>
          </>
        }
      />
      <div className="flex items-center gap-2 border-b border-line px-6 py-2.5">
        <div className="relative w-80">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Search name, host, user, #tag")}
            className="pl-8"
            aria-label={t("Search connections")}
          />
        </div>
        {selectedProfiles.length > 0 && (
          <div className="flex items-center gap-1.5 animate-fade-in">
            <span className="px-2 text-xs text-muted">
              {selectedProfiles.length} {t("selected")}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm">
                  <FolderInput />
                  {t("Move to")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="max-h-72 overflow-y-auto">
                <DropdownMenuItem
                  onSelect={() =>
                    void attempt(() =>
                      useLibrary.getState().moveProfiles(
                        selectedProfiles.map((p) => p.id),
                        null,
                      ),
                    )
                  }
                >
                  {t("No group")}
                </DropdownMenuItem>
                {groupOptions(groups).map((g) => (
                  <DropdownMenuItem
                    key={g.id}
                    onSelect={() =>
                      void attempt(() =>
                        useLibrary.getState().moveProfiles(
                          selectedProfiles.map((p) => p.id),
                          g.id,
                        ),
                      )
                    }
                  >
                    <span style={{ paddingLeft: g.depth * 12 }}>{g.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              onClick={() =>
                void attempt(async () => {
                  const fav = !selectedProfiles.every((p) => p.favorite);
                  for (const p of selectedProfiles)
                    await useLibrary.getState().setFavorite(p.id, fav);
                })
              }
            >
              <Star />
              {t("Toggle favorite")}
            </Button>
            <Button
              size="sm"
              variant="danger-outline"
              onClick={async () => {
                await deleteProfilesWithConfirm(selectedProfiles);
                setSelected(new Set());
              }}
            >
              <Trash2 />
              {t("Delete")}
            </Button>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <EmptyState
            icon={<Server />}
            title={t(profiles.length ? "No matching connections" : "No saved connections")}
            description={
              profiles.length
                ? t("Try a different search.")
                : t("Create a profile or import an export file.")
            }
            action={
              !profiles.length && (
                <Button variant="primary" onClick={() => newConnection()}>
                  <Plus />
                  {t("New connection")}
                </Button>
              )
            }
          />
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 z-10 bg-surface text-left text-[11px] tracking-wide text-faint uppercase">
              <tr className="border-b border-line">
                <th className="w-10 py-2 pl-6">
                  <Checkbox
                    aria-label={t("Select all")}
                    checked={allChecked ? true : someChecked ? "indeterminate" : false}
                    onCheckedChange={() =>
                      setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))
                    }
                  />
                </th>
                <th className="py-2">{header("name", "Name")}</th>
                <th className="py-2">{header("host", "Endpoint")}</th>
                <th className="py-2 font-semibold">{t("Auth")}</th>
                <th className="py-2 font-semibold">{t("Group")}</th>
                <th className="py-2 font-semibold">{t("Tags")}</th>
                <th className="py-2">{header("lastConnectedAt", "Last used")}</th>
                <th className="w-28 py-2 pr-6" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr
                  key={p.id}
                  className="group border-b border-line/70 hover:bg-surface-2"
                  onDoubleClick={() => connectProfile(p)}
                  aria-selected={selected.has(p.id)}
                >
                  <td className="py-1.5 pl-6">
                    <Checkbox
                      aria-label={`${t("Select")} ${p.name}`}
                      checked={selected.has(p.id)}
                      onCheckedChange={() => toggle(p.id)}
                    />
                  </td>
                  <td className="py-1.5">
                    <div className="flex items-center gap-2">
                      <ProtocolIcon profile={p} className="text-muted" />
                      <span className="font-medium text-fg">{p.name}</span>
                      {p.favorite && <Star className="size-3 fill-warning text-warning" />}
                    </div>
                  </td>
                  <td className="py-1.5 font-mono text-xs text-muted">
                    {p.protocol === "local"
                      ? t("local shell")
                      : endpointLabel(p.username, p.host, p.port)}
                  </td>
                  <td className="py-1.5 text-xs text-muted">
                    {p.protocol === "ssh" ? (
                      <span className="flex items-center gap-1">
                        {t(AUTH_LABEL[p.authMethod])}
                        {(p.passwordSaved || p.passphraseSaved) && (
                          <Lock
                            className="size-3 text-success"
                            aria-label={t("Credential saved")}
                          />
                        )}
                      </span>
                    ) : (
                      <Badge>{p.protocol}</Badge>
                    )}
                  </td>
                  <td className="py-1.5 text-xs text-muted">
                    {groupPath(groups, p.groupId) || "—"}
                  </td>
                  <td className="py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {p.tags.slice(0, 4).map((t) => (
                        <Badge key={t} tone="accent">
                          {t}
                        </Badge>
                      ))}
                      {p.tags.length > 4 && <Badge>+{p.tags.length - 4}</Badge>}
                    </div>
                  </td>
                  <td className="py-1.5 text-xs text-muted">{formatRelative(p.lastConnectedAt)}</td>
                  <td className="py-1.5 pr-6">
                    <div className="flex justify-end gap-0.5 opacity-60 group-hover:opacity-100">
                      <Tooltip content={t("Connect")}>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${t("Connect to")} ${p.name}`}
                          onClick={() => connectProfile(p)}
                        >
                          <Play />
                        </Button>
                      </Tooltip>
                      <Tooltip content={t("Edit")}>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${t("Edit")} ${p.name}`}
                          onClick={() => editProfile({ mode: "edit", profileId: p.id })}
                        >
                          <Pencil />
                        </Button>
                      </Tooltip>
                      <Tooltip content={t("Delete")}>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${t("Delete")} ${p.name}`}
                          onClick={() => void deleteProfilesWithConfirm([p])}
                        >
                          <Trash2 />
                        </Button>
                      </Tooltip>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
