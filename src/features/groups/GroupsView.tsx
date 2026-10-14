import { ChevronRight, Folder, FolderPlus, FolderTree, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import { newConnection } from "@/lib/actions";
import { useT } from "@/lib/i18n";
import { useLibrary } from "@/stores/library";
import { useUi } from "@/stores/ui";

import { deleteGroupWithConfirm } from "../connections/ConnectionExplorer";
import { buildTree, type GroupNode } from "../connections/tree";

function GroupItem({ node, depth }: { node: GroupNode; depth: number }) {
  const t = useT();
  const editGroup = useUi((s) => s.editGroup);
  return (
    <>
      <div
        className="group flex items-center gap-2 border-b border-line/70 py-2 pr-6 hover:bg-surface-2"
        style={{ paddingLeft: 24 + depth * 22 }}
      >
        {depth > 0 && <ChevronRight className="size-3 text-faint" />}
        <Folder className="size-4 text-accent" />
        <span className="flex-1 font-medium text-fg">{node.group.name}</span>
        <span className="w-32 text-xs text-muted">
          {node.profiles.length} {t("direct")} · {node.count} {t("total")}
        </span>
        <div className="flex gap-0.5 opacity-60 group-hover:opacity-100">
          <Tooltip content={t("New connection in this group")}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${t("New connection in")} ${node.group.name}`}
              onClick={() => newConnection(node.group.id)}
            >
              <Plus />
            </Button>
          </Tooltip>
          <Tooltip content={t("New subgroup")}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${t("New subgroup in")} ${node.group.name}`}
              onClick={() => editGroup({ mode: "create", parentId: node.group.id })}
            >
              <FolderPlus />
            </Button>
          </Tooltip>
          <Tooltip content={t("Rename or move")}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${t("Edit")} ${node.group.name}`}
              onClick={() => editGroup({ mode: "edit", groupId: node.group.id })}
            >
              <Pencil />
            </Button>
          </Tooltip>
          <Tooltip content={t("Delete group")}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${t("Delete")} ${node.group.name}`}
              onClick={() => void deleteGroupWithConfirm(node.group)}
            >
              <Trash2 />
            </Button>
          </Tooltip>
        </div>
      </div>
      {node.children.map((c) => (
        <GroupItem key={c.group.id} node={c} depth={depth + 1} />
      ))}
    </>
  );
}

export function GroupsView() {
  const t = useT();
  const groups = useLibrary((s) => s.groups);
  const profiles = useLibrary((s) => s.profiles);
  const editGroup = useUi((s) => s.editGroup);
  const tree = useMemo(() => buildTree(groups, profiles), [groups, profiles]);
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t("Groups")}
        icon={<FolderTree />}
        description={t(
          "Organize connections into nested folders. Deleting a group never deletes its connections.",
        )}
        actions={
          <Button variant="primary" onClick={() => editGroup({ mode: "create", parentId: null })}>
            <FolderPlus />
            {t("New group")}
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto text-[13px]">
        {groups.length === 0 ? (
          <EmptyState
            icon={<FolderTree />}
            title={t("No groups yet")}
            description={t(
              "Create groups such as Production, Staging or a customer name, then drag connections into them in the explorer.",
            )}
            action={
              <Button
                variant="primary"
                onClick={() => editGroup({ mode: "create", parentId: null })}
              >
                <FolderPlus />
                {t("New group")}
              </Button>
            }
          />
        ) : (
          <>
            {tree.roots.map((n) => (
              <GroupItem key={n.group.id} node={n} depth={0} />
            ))}
            <div className="flex items-center gap-2 py-2 pr-6 pl-6 text-xs text-faint">
              {tree.ungrouped.length}{" "}
              {t(
                tree.ungrouped.length === 1
                  ? "connection without a group"
                  : "connections without a group",
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
