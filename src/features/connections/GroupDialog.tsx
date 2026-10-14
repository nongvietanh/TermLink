import { FolderTree } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/controls";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { fieldErrors, groupInputSchema } from "@/domain/schemas";
import type { Group } from "@/domain/types";
import { notifyError } from "@/lib/notify";
import { useLibrary } from "@/stores/library";
import { useUi, type GroupEditorState } from "@/stores/ui";

import { descendantIds, groupOptions } from "./tree";

function GroupForm({
  state,
  group,
  onClose,
}: {
  state: GroupEditorState;
  group?: Group;
  onClose: () => void;
}) {
  const groups = useLibrary((s) => s.groups);
  const [name, setName] = useState(group?.name ?? "");
  const [parentId, setParentId] = useState<string | null>(
    group ? group.parentId : state.mode === "create" ? state.parentId : null,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  // A group cannot move into itself or its descendants.
  const excluded = group ? descendantIds(groups, group.id) : new Set<string>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const input = { name, parentId, expanded: group?.expanded ?? true };
    const parsed = groupInputSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    try {
      const lib = useLibrary.getState();
      if (group) await lib.updateGroup(group.id, parsed.data);
      else await lib.createGroup(parsed.data);
      onClose();
    } catch (err) {
      notifyError(err, "Could not save the group");
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="contents" noValidate>
      <DialogHeader icon={<FolderTree />}>
        <DialogTitle>{group ? "Edit group" : "New group"}</DialogTitle>
        <DialogDescription>Groups organize connections into nested folders.</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <Field label="Name" htmlFor="grp-name" error={errors.name} required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Production"
            autoFocus
          />
        </Field>
        <Field label="Parent group" htmlFor="grp-parent">
          <Select
            value={parentId ?? "__root"}
            onValueChange={(v) => setParentId(v === "__root" ? null : v)}
            options={[
              { value: "__root", label: "Top level" },
              ...groupOptions(groups)
                .filter((g) => !excluded.has(g.id))
                .map((g) => ({ value: g.id, label: `${" ".repeat(g.depth)}${g.label}` })),
            ]}
          />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          {group ? "Save" : "Create group"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function GroupDialog() {
  const state = useUi((s) => s.groupEditor);
  const close = () => useUi.getState().editGroup(null);
  const group = useLibrary((s) =>
    state?.mode === "edit" ? s.groups.find((g) => g.id === state.groupId) : undefined,
  );
  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && close()}>
      {state && (state.mode === "create" || group) && (
        <DialogContent size="sm">
          <GroupForm state={state} group={group} onClose={close} />
        </DialogContent>
      )}
    </Dialog>
  );
}
