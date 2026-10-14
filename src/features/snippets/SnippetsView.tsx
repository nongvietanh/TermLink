import {
  AlertTriangle,
  Copy,
  CornerDownLeft,
  Pencil,
  Plus,
  Search,
  TextCursorInput,
  Trash2,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
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
import { Input, Textarea } from "@/components/ui/input";
import { Badge, EmptyState, Notice, PageHeader } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import { fieldErrors, parseTags, snippetInputSchema } from "@/domain/schemas";
import type { Snippet, SnippetInput } from "@/domain/types";
import { attempt, notifyError, notifySuccess } from "@/lib/notify";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { confirm } from "@/stores/confirm";
import { useLibrary } from "@/stores/library";
import { activeKeyOf, isLive, useSessions } from "@/stores/sessions";
import { useUi } from "@/stores/ui";

import { isPotentiallyDestructive, sendCommand } from "./snippetActions";

function SnippetForm({ snippet, onClose }: { snippet?: Snippet; onClose: () => void }) {
  const t = useT();
  const [form, setForm] = useState<SnippetInput>(
    snippet
      ? {
          name: snippet.name,
          command: snippet.command,
          description: snippet.description,
          category: snippet.category,
          tags: snippet.tags,
          confirmBeforeRun: snippet.confirmBeforeRun,
        }
      : { name: "", command: "", description: "", category: "", tags: [], confirmBeforeRun: false },
  );
  const [tagsText, setTagsText] = useState(form.tags.join(", "));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const destructive = isPotentiallyDestructive(form.command);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const candidate = { ...form, tags: parseTags(tagsText) };
    const parsed = snippetInputSchema.safeParse(candidate);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    try {
      const lib = useLibrary.getState();
      if (snippet) await lib.updateSnippet(snippet.id, parsed.data);
      else await lib.createSnippet(parsed.data);
      notifySuccess(t(snippet ? "Snippet updated" : "Snippet saved"));
      onClose();
    } catch (err) {
      notifyError(err, t("Could not save the snippet"));
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="contents" noValidate>
      <DialogHeader icon={<TextCursorInput />}>
        <DialogTitle>{t(snippet ? "Edit snippet" : "New snippet")}</DialogTitle>
        <DialogDescription>
          {t("Snippets are only sent to a terminal when you click Insert or Run.")}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Name")} htmlFor="sn-name" error={errors.name} required>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Disk usage"
              autoFocus
            />
          </Field>
          <Field label={t("Category")} htmlFor="sn-cat" error={errors.category}>
            <Input
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="Diagnostics"
            />
          </Field>
        </div>
        <Field label={t("Command")} htmlFor="sn-cmd" error={errors.command} required>
          <Textarea
            value={form.command}
            onChange={(e) => setForm({ ...form, command: e.target.value })}
            placeholder="df -h --exclude-type=tmpfs"
            className="font-mono text-xs"
            rows={5}
          />
        </Field>
        {destructive && (
          <Notice tone="warning" icon={<AlertTriangle />}>
            {t(
              "This command looks potentially destructive. TermLink will ask for confirmation before running it.",
            )}
          </Notice>
        )}
        <Field label={t("Description")} htmlFor="sn-desc" error={errors.description}>
          <Input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="What it does"
          />
        </Field>
        <Field
          label={t("Tags")}
          htmlFor="sn-tags"
          error={errors.tags ?? Object.entries(errors).find(([k]) => k.startsWith("tags."))?.[1]}
          hint={t("Comma separated")}
        >
          <Input
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="disk, linux"
          />
        </Field>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
          <Checkbox
            checked={form.confirmBeforeRun}
            onCheckedChange={(v) => setForm({ ...form, confirmBeforeRun: v === true })}
          />
          {t("Always ask for confirmation before running")}
        </label>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {t("Cancel")}
        </Button>
        <Button type="submit" variant="primary">
          {t(snippet ? "Save changes" : "Save snippet")}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function SnippetDialog() {
  const state = useUi((s) => s.snippetEditor);
  const close = () => useUi.getState().editSnippet(null);
  const snippet = useLibrary((s) =>
    state?.mode === "edit" ? s.snippets.find((x) => x.id === state.snippetId) : undefined,
  );
  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && close()}>
      {state && (state.mode === "create" || snippet) && (
        <DialogContent size="md" key={state.mode === "edit" ? state.snippetId : "new"}>
          <SnippetForm snippet={snippet} onClose={close} />
        </DialogContent>
      )}
    </Dialog>
  );
}

export function SnippetsView() {
  const t = useT();
  const snippets = useLibrary((s) => s.snippets);
  const editSnippet = useUi((s) => s.editSnippet);
  const active = useSessions((s) => s.tabs.find((t) => t.key === activeKeyOf(s)));
  const target = active && isLive(active) ? active : undefined;
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);

  const categories = useMemo(
    () =>
      [...new Set(snippets.map((s) => s.category).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [snippets],
  );
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return snippets.filter(
      (s) =>
        (!category || s.category === category) &&
        (!q || [s.name, s.command, s.description, ...s.tags].join(" ").toLowerCase().includes(q)),
    );
  }, [snippets, query, category]);

  const remove = async (s: Snippet) => {
    const ok = await confirm({
      title: `${t("Delete snippet")} "${s.name}"?`,
      confirmLabel: t("Delete"),
      tone: "danger",
    });
    if (ok) await attempt(() => useLibrary.getState().deleteSnippet(s.id));
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t("Snippets")}
        icon={<TextCursorInput />}
        description={
          target ? (
            <>
              {t("Commands are inserted into")}{" "}
              <span className="font-medium text-fg">{target.title}</span>.
            </>
          ) : (
            t("Reusable commands. Open a connected session to insert or run them.")
          )
        }
        actions={
          <Button variant="primary" onClick={() => editSnippet({ mode: "create" })}>
            <Plus />
            {t("New snippet")}
          </Button>
        }
      />
      <div className="flex items-center gap-2 border-b border-line px-6 py-2.5">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Search snippets")}
            className="pl-8"
            aria-label={t("Search snippets")}
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {[null, ...categories].map((c) => (
            <button
              key={c ?? "__all"}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                "h-7 rounded-md px-2.5 text-xs text-muted transition-colors hover:bg-hover hover:text-fg",
                category === c &&
                  "bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent",
              )}
            >
              {c ?? t("All")}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-6">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<TextCursorInput />}
            title={t(snippets.length ? "No matching snippets" : "No snippets yet")}
            description={
              snippets.length
                ? t("Try another search or category.")
                : t("Save commands you run often, such as health checks or log tails.")
            }
            action={
              !snippets.length && (
                <Button variant="primary" onClick={() => editSnippet({ mode: "create" })}>
                  <Plus />
                  {t("New snippet")}
                </Button>
              )
            }
          />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3">
            {filtered.map((s) => (
              <div
                key={s.id}
                className="group flex flex-col rounded-xl border border-line bg-surface p-3 transition-colors hover:border-line-strong"
              >
                <div className="mb-2 flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-fg">{s.name}</span>
                      {s.potentiallyDestructive && (
                        <Tooltip content={t("Potentially destructive: confirmation required")}>
                          <AlertTriangle
                            className="size-3.5 text-warning"
                            aria-label={t("Potentially destructive")}
                          />
                        </Tooltip>
                      )}
                    </div>
                    {s.description && (
                      <p className="truncate text-xs text-muted">{s.description}</p>
                    )}
                  </div>
                  {s.category && <Badge>{s.category}</Badge>}
                </div>
                <pre className="selectable mb-3 max-h-28 flex-1 overflow-auto rounded-md border border-line bg-terminal px-2.5 py-2 font-mono text-xs whitespace-pre-wrap text-fg">
                  {s.command}
                </pre>
                <div className="flex items-center gap-1">
                  {s.tags.map((t) => (
                    <Badge key={t} tone="accent">
                      {t}
                    </Badge>
                  ))}
                  <span className="flex-1" />
                  <Tooltip content={t("Copy")}>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${t("Copy")} ${s.name}`}
                      onClick={() =>
                        void navigator.clipboard.writeText(s.command).then(
                          () => notifySuccess(t("Copied to clipboard")),
                          () => notifyError({ kind: "internal", message: "Clipboard unavailable" }),
                        )
                      }
                    >
                      <Copy />
                    </Button>
                  </Tooltip>
                  <Tooltip content={t("Edit")}>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${t("Edit")} ${s.name}`}
                      onClick={() => editSnippet({ mode: "edit", snippetId: s.id })}
                    >
                      <Pencil />
                    </Button>
                  </Tooltip>
                  <Tooltip content={t("Delete")}>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${t("Delete")} ${s.name}`}
                      onClick={() => void remove(s)}
                    >
                      <Trash2 />
                    </Button>
                  </Tooltip>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!target}
                    onClick={() =>
                      void sendCommand({
                        command: s.command,
                        run: false,
                        source: "snippet",
                        label: s.name,
                      })
                    }
                  >
                    {t("Insert")}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!target}
                    onClick={() =>
                      void sendCommand({
                        command: s.command,
                        run: true,
                        source: "snippet",
                        label: s.name,
                        confirmBeforeRun: s.confirmBeforeRun,
                      })
                    }
                  >
                    <CornerDownLeft />
                    {t("Run")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
