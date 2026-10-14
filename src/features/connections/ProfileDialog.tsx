import { FolderOpen, KeyRound, Lock, Plus, Server, Star, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Checkbox,
  Select,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/controls";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, SectionTitle } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/misc";
import { fieldErrors, parseTags, profileInputSchema } from "@/domain/schemas";
import type { AuthMethod, Profile, ProfileInput, Protocol } from "@/domain/types";
import { api } from "@/lib/ipc";
import { useT } from "@/lib/i18n";
import { notifyError, notifySuccess } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { toProfileInput, useLibrary } from "@/stores/library";
import { useSettings } from "@/stores/settings";
import { useUi, type ProfileEditorState } from "@/stores/ui";

import { TERMINAL_SCHEMES } from "../terminal/themes";
import { connectProfile } from "../terminal/controller";
import { groupOptions } from "./tree";

const COLORS = [
  "#22d3ee",
  "#60a5fa",
  "#a78bfa",
  "#f472b6",
  "#f87171",
  "#fb923c",
  "#facc15",
  "#34d399",
];

const AUTH_OPTIONS: { value: AuthMethod; label: string; hint: string }[] = [
  { value: "password", label: "Password", hint: "Prompted or saved in the credential store" },
  { value: "public_key", label: "Private key", hint: "OpenSSH, PEM or PuTTY key file" },
  { value: "agent", label: "SSH agent", hint: "OpenSSH agent or Pageant" },
  { value: "keyboard_interactive", label: "Keyboard-interactive", hint: "One-time codes, 2FA" },
];

function blankInput(
  groupId: string | null,
  defaults: { username: string; timeout: number; keepalive: number },
): ProfileInput {
  return {
    groupId,
    name: "",
    protocol: "ssh",
    host: "",
    port: 22,
    username: defaults.username,
    authMethod: "password",
    keyPath: null,
    favorite: false,
    notes: "",
    color: null,
    tags: [],
    terminal: {},
    ssh: {
      connectTimeoutSecs: defaults.timeout,
      keepaliveIntervalSecs: defaults.keepalive,
      keepaliveMax: 3,
      env: [],
    },
  };
}

function numberOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function ProfileForm({
  state,
  profile,
  onClose,
}: {
  state: ProfileEditorState;
  profile: Profile | undefined;
  onClose: () => void;
}) {
  const t = useT();
  const groups = useLibrary((s) => s.groups);
  const sshDefaults = useSettings((s) => s.settings.ssh);
  const backend = useSettings((s) => s.appInfo?.credentialBackend ?? "the system credential store");
  const current = useLibrary((s) =>
    profile ? s.profiles.find((p) => p.id === profile.id) : undefined,
  );

  const initial = useMemo<ProfileInput>(() => {
    if (profile) return toProfileInput(profile);
    const base = blankInput(state.mode === "create" ? (state.groupId ?? null) : null, {
      username: sshDefaults.defaultUsername,
      timeout: sshDefaults.connectTimeoutSecs,
      keepalive: sshDefaults.keepaliveIntervalSecs,
    });
    if (state.mode === "create" && state.prefill) {
      return {
        ...base,
        host: state.prefill.host ?? "",
        username: state.prefill.username ?? base.username,
        port: state.prefill.port ?? 22,
        name: state.prefill.host ?? "",
      };
    }
    return base;
  }, [profile, state, sshDefaults]);

  const [form, setForm] = useState<ProfileInput>(initial);
  const [portText, setPortText] = useState(String(initial.port));
  const [tagsText, setTagsText] = useState(initial.tags.join(", "));
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("general");

  const set = <K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const setSsh = (patch: Partial<ProfileInput["ssh"]>) =>
    setForm((f) => ({ ...f, ssh: { ...f.ssh, ...patch } }));
  const setTerm = (patch: Partial<ProfileInput["terminal"]>) =>
    setForm((f) => ({ ...f, terminal: { ...f.terminal, ...patch } }));

  const isSsh = form.protocol === "ssh";
  const planned = form.protocol === "rdp" || form.protocol === "vnc";

  const browseKey = async () => {
    try {
      const path = await api.keyFilePick();
      if (path) set("keyPath", path);
    } catch (e) {
      notifyError(e);
    }
  };

  const submit = async (e: FormEvent, connectAfter = false) => {
    e.preventDefault();
    const candidate: ProfileInput = {
      ...form,
      name: form.name.trim() || form.host.trim(),
      port: Number(portText),
      tags: parseTags(tagsText),
      keyPath: form.authMethod === "public_key" && isSsh ? form.keyPath : null,
    };
    const parsed = profileInputSchema.safeParse(candidate);
    if (!parsed.success) {
      const errs = fieldErrors(parsed.error);
      setErrors(errs);
      const first = Object.keys(errs)[0] ?? "";
      setTab(
        first.startsWith("terminal")
          ? "terminal"
          : first.startsWith("ssh")
            ? "advanced"
            : "general",
      );
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const lib = useLibrary.getState();
      const saved = profile
        ? await lib.updateProfile(profile.id, candidate)
        : await lib.createProfile(candidate);
      if (
        password &&
        isSsh &&
        (candidate.authMethod === "password" || candidate.authMethod === "keyboard_interactive")
      ) {
        await api.credentialSet(saved.id, "password", password);
        setPassword("");
        lib.patchProfile(saved.id, { passwordSaved: true });
      }
      notifySuccess(profile ? "Connection updated" : "Connection saved", saved.name);
      onClose();
      if (connectAfter)
        connectProfile({ ...saved, passwordSaved: saved.passwordSaved || !!password });
    } catch (err) {
      notifyError(err, "Could not save the connection");
    } finally {
      setSaving(false);
    }
  };

  const removeSecret = async (kind: "password" | "passphrase") => {
    if (!profile) return;
    try {
      await api.credentialDelete(profile.id, kind);
      useLibrary
        .getState()
        .patchProfile(
          profile.id,
          kind === "password" ? { passwordSaved: false } : { passphraseSaved: false },
        );
      notifySuccess(`Saved ${kind} removed`);
    } catch (err) {
      notifyError(err);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="contents" noValidate>
      <DialogHeader icon={<Server />}>
        <DialogTitle>
          {profile ? `${t("Edit connection")}: ${profile.name}` : t("New connection")}
        </DialogTitle>
        <DialogDescription>
          {t("Connection details are stored locally. Passwords go to")} {backend}
          {t(", never to the TermLink database.")}
        </DialogDescription>
      </DialogHeader>
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="px-5">
          <TabsTrigger value="general">{t("General")}</TabsTrigger>
          <TabsTrigger value="terminal">{t("Terminal")}</TabsTrigger>
          <TabsTrigger value="advanced">{t("Advanced")}</TabsTrigger>
        </TabsList>
        <DialogBody className="min-h-[420px]">
          <TabsContent value="general" className="space-y-4 outline-none">
            <div className="grid grid-cols-[1fr_180px] gap-3">
              <Field
                label={t("Name")}
                htmlFor="pf-name"
                error={errors.name}
                hint={t("Defaults to the host")}
              >
                <Input
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="Production web 1"
                  autoFocus
                />
              </Field>
              <Field label={t("Protocol")} htmlFor="pf-protocol">
                <Select
                  value={form.protocol}
                  onValueChange={(v) => {
                    const protocol = v as Protocol;
                    set("protocol", protocol);
                    if (protocol === "rdp" && portText === "22") setPortText("3389");
                    if (protocol === "vnc" && portText === "22") setPortText("5900");
                    if (protocol === "ssh" && (portText === "3389" || portText === "5900"))
                      setPortText("22");
                  }}
                  options={[
                    { value: "ssh", label: "SSH" },
                    { value: "local", label: t("Local terminal") },
                    { value: "rdp", label: "RDP", hint: "planned" },
                    { value: "vnc", label: "VNC", hint: "planned" },
                  ]}
                />
              </Field>
            </div>
            {planned && (
              <Notice tone="info">
                {form.protocol.toUpperCase()} support is planned. You can save the profile now;
                connecting will be enabled once a vetted client integration ships.
              </Notice>
            )}
            {form.protocol !== "local" && (
              <div className="grid grid-cols-[1fr_96px] gap-3">
                <Field label={t("Host")} htmlFor="pf-host" error={errors.host} required>
                  <Input
                    value={form.host}
                    onChange={(e) => set("host", e.target.value)}
                    placeholder="server.example.com or 10.0.0.5"
                  />
                </Field>
                <Field label={t("Port")} htmlFor="pf-port" error={errors.port}>
                  <Input
                    value={portText}
                    onChange={(e) => setPortText(e.target.value.replace(/[^\d]/g, ""))}
                    inputMode="numeric"
                  />
                </Field>
              </div>
            )}
            {isSsh && (
              <>
                <Field label={t("Username")} htmlFor="pf-user" error={errors.username} required>
                  <Input
                    value={form.username}
                    onChange={(e) => set("username", e.target.value)}
                    placeholder="deploy"
                  />
                </Field>
                <div className="space-y-2">
                  <SectionTitle>{t("Authentication")}</SectionTitle>
                  <div
                    className="grid grid-cols-2 gap-2"
                    role="radiogroup"
                    aria-label={t("Authentication")}
                  >
                    {AUTH_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={form.authMethod === o.value}
                        onClick={() => set("authMethod", o.value)}
                        className={cn(
                          "rounded-lg border border-line bg-surface-2 px-3 py-2 text-left transition-colors hover:border-line-strong",
                          form.authMethod === o.value && "border-accent/60 bg-accent-soft",
                        )}
                      >
                        <div className="text-[13px] font-medium text-fg">{t(o.label)}</div>
                        <div className="text-[11px] text-faint">{t(o.hint)}</div>
                      </button>
                    ))}
                  </div>
                </div>
                {form.authMethod === "public_key" && (
                  <Field
                    label={t("Private key file")}
                    error={errors.keyPath}
                    hint={t(
                      "Only the path is stored. If the key is encrypted, TermLink asks for the passphrase.",
                    )}
                  >
                    <div className="flex gap-2">
                      <Input
                        id="pf-key"
                        aria-label={t("Private key file")}
                        value={form.keyPath ?? ""}
                        onChange={(e) => set("keyPath", e.target.value)}
                        placeholder="~/.ssh/id_ed25519"
                        aria-invalid={errors.keyPath ? true : undefined}
                        className="font-mono text-xs"
                      />
                      <Button variant="secondary" onClick={() => void browseKey()}>
                        <FolderOpen />
                        {t("Browse")}
                      </Button>
                    </div>
                  </Field>
                )}
                {(form.authMethod === "password" || form.authMethod === "keyboard_interactive") && (
                  <Field
                    label={
                      current?.passwordSaved
                        ? t("Replace saved password")
                        : t("Password (optional)")
                    }
                    htmlFor="pf-password"
                    hint={
                      current?.passwordSaved
                        ? undefined
                        : `${t("Leave empty to be asked when connecting. Saved passwords are stored in")} ${backend}.`
                    }
                  >
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="new-password"
                    />
                  </Field>
                )}
                {current && (current.passwordSaved || current.passphraseSaved) && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
                    <Lock className="size-3.5 text-success" />
                    <span className="flex-1">
                      {current.passwordSaved && t("A password is saved")}
                      {current.passwordSaved && current.passphraseSaved && " · "}
                      {current.passphraseSaved && t("A key passphrase is saved")} {t("in")}{" "}
                      {backend}.
                    </span>
                    {current.passwordSaved && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void removeSecret("password")}
                      >
                        <Trash2 />
                        {t("Remove password")}
                      </Button>
                    )}
                    {current.passphraseSaved && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void removeSecret("passphrase")}
                      >
                        <Trash2 />
                        {t("Remove passphrase")}
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("Group")} htmlFor="pf-group">
                <Select
                  value={form.groupId ?? "__none"}
                  onValueChange={(v) => set("groupId", v === "__none" ? null : v)}
                  options={[
                    { value: "__none", label: t("No group") },
                    ...groupOptions(groups).map((g) => ({
                      value: g.id,
                      label: `${" ".repeat(g.depth)}${g.label}`,
                    })),
                  ]}
                />
              </Field>
              <Field
                label={t("Tags")}
                htmlFor="pf-tags"
                error={
                  errors.tags ?? Object.entries(errors).find(([k]) => k.startsWith("tags."))?.[1]
                }
                hint={t("Comma separated")}
              >
                <Input
                  value={tagsText}
                  onChange={(e) => setTagsText(e.target.value)}
                  placeholder="prod, web, eu-west"
                />
              </Field>
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted">{t("Color")}</span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    aria-label={t("No color")}
                    aria-pressed={!form.color}
                    onClick={() => set("color", null)}
                    className={cn(
                      "size-5 rounded-full border border-line-strong bg-surface-3",
                      !form.color && "ring-2 ring-accent ring-offset-1 ring-offset-surface",
                    )}
                  />
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Color ${c}`}
                      aria-pressed={form.color === c}
                      onClick={() => set("color", c)}
                      className={cn(
                        "size-5 rounded-full",
                        form.color === c && "ring-2 ring-accent ring-offset-1 ring-offset-surface",
                      )}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                <Checkbox
                  checked={form.favorite}
                  onCheckedChange={(v) => set("favorite", v === true)}
                />
                <Star className="size-3.5 text-warning" />
                {t("Favorite")}
              </label>
            </div>
            <Field label={t("Notes")} htmlFor="pf-notes" error={errors.notes}>
              <Textarea
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="Runbook links, maintenance windows…"
                rows={3}
              />
            </Field>
          </TabsContent>

          <TabsContent value="terminal" className="space-y-4 outline-none">
            <p className="text-xs text-muted">
              {t("Leave a field empty to use the global terminal settings.")}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("Color scheme")} htmlFor="pf-scheme">
                <Select
                  value={form.terminal.theme ?? "__default"}
                  onValueChange={(v) => setTerm({ theme: v === "__default" ? null : v })}
                  options={[
                    { value: "__default", label: t("Use global setting") },
                    { value: "auto", label: t("Match app theme") },
                    ...TERMINAL_SCHEMES.map((s) => ({ value: s.id, label: s.name })),
                  ]}
                />
              </Field>
              <Field
                label="Terminal type ($TERM)"
                htmlFor="pf-term"
                error={errors["terminal.termType"]}
              >
                <Input
                  value={form.terminal.termType ?? ""}
                  onChange={(e) => setTerm({ termType: e.target.value || null })}
                  placeholder="xterm-256color"
                />
              </Field>
              <Field label={t("Font family")} htmlFor="pf-font" className="col-span-2">
                <Input
                  value={form.terminal.fontFamily ?? ""}
                  onChange={(e) => setTerm({ fontFamily: e.target.value || null })}
                  placeholder="Use global setting"
                />
              </Field>
              <Field
                label={t("Font size")}
                htmlFor="pf-fontsize"
                error={errors["terminal.fontSize"]}
              >
                <Input
                  value={form.terminal.fontSize ?? ""}
                  inputMode="numeric"
                  onChange={(e) => setTerm({ fontSize: numberOrNull(e.target.value) })}
                  placeholder="Global"
                />
              </Field>
              <Field
                label="Scrollback lines"
                htmlFor="pf-scrollback"
                error={errors["terminal.scrollback"]}
              >
                <Input
                  value={form.terminal.scrollback ?? ""}
                  inputMode="numeric"
                  onChange={(e) => setTerm({ scrollback: numberOrNull(e.target.value) })}
                  placeholder="Global"
                />
              </Field>
            </div>
            <p className="text-xs text-faint">
              Terminal rows and columns follow the size of the pane and are sent to the server on
              resize.
            </p>
          </TabsContent>

          <TabsContent value="advanced" className="space-y-4 outline-none">
            {!isSsh ? (
              <p className="text-xs text-muted">Advanced options apply to SSH connections.</p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <Field
                    label="Connect timeout (s)"
                    htmlFor="pf-timeout"
                    error={errors["ssh.connectTimeoutSecs"]}
                  >
                    <Input
                      value={form.ssh.connectTimeoutSecs}
                      inputMode="numeric"
                      onChange={(e) => setSsh({ connectTimeoutSecs: Number(e.target.value) || 0 })}
                    />
                  </Field>
                  <Field
                    label="Keepalive interval (s)"
                    htmlFor="pf-keepalive"
                    error={errors["ssh.keepaliveIntervalSecs"]}
                    hint="0 disables"
                  >
                    <Input
                      value={form.ssh.keepaliveIntervalSecs}
                      inputMode="numeric"
                      onChange={(e) =>
                        setSsh({ keepaliveIntervalSecs: Number(e.target.value) || 0 })
                      }
                    />
                  </Field>
                  <Field
                    label="Keepalive attempts"
                    htmlFor="pf-kamax"
                    error={errors["ssh.keepaliveMax"]}
                  >
                    <Input
                      value={form.ssh.keepaliveMax}
                      inputMode="numeric"
                      onChange={(e) => setSsh({ keepaliveMax: Number(e.target.value) || 0 })}
                    />
                  </Field>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <SectionTitle>Environment variables</SectionTitle>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSsh({ env: [...form.ssh.env, { name: "", value: "" }] })}
                    >
                      <Plus />
                      Add variable
                    </Button>
                  </div>
                  <p className="text-xs text-faint">
                    Sent with the shell request. Servers only accept names allowed by their
                    AcceptEnv setting.
                  </p>
                  {form.ssh.env.map((v, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        value={v.name}
                        placeholder="NAME"
                        aria-label="Variable name"
                        aria-invalid={errors[`ssh.env.${i}.name`] ? true : undefined}
                        className="w-40 font-mono text-xs"
                        onChange={(e) =>
                          setSsh({
                            env: form.ssh.env.map((x, j) =>
                              j === i ? { ...x, name: e.target.value } : x,
                            ),
                          })
                        }
                      />
                      <Input
                        value={v.value}
                        placeholder="value"
                        aria-label="Variable value"
                        className="flex-1 font-mono text-xs"
                        onChange={(e) =>
                          setSsh({
                            env: form.ssh.env.map((x, j) =>
                              j === i ? { ...x, value: e.target.value } : x,
                            ),
                          })
                        }
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Remove variable"
                        onClick={() => setSsh({ env: form.ssh.env.filter((_, j) => j !== i) })}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                  {Object.entries(errors).find(([k]) => k.startsWith("ssh.env"))?.[1] && (
                    <p className="text-xs text-danger">
                      {Object.entries(errors).find(([k]) => k.startsWith("ssh.env"))?.[1]}
                    </p>
                  )}
                </div>
                <Notice tone="info" icon={<KeyRound />} title="Host key verification is always on">
                  Unknown or changed host keys always require your confirmation. This cannot be
                  disabled.
                </Notice>
              </>
            )}
          </TabsContent>
        </DialogBody>
      </Tabs>
      <DialogFooter>
        {Object.keys(errors).length > 0 && (
          <span className="mr-auto text-xs text-danger">Please fix the highlighted fields.</span>
        )}
        <Button variant="ghost" onClick={onClose}>
          {t("Cancel")}
        </Button>
        {!planned && (
          <Button
            variant="secondary"
            disabled={saving}
            onClick={(e) => void submit(e as unknown as FormEvent, true)}
          >
            {t("Save and connect")}
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={saving}>
          {profile ? t("Save changes") : t("Save connection")}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ProfileDialog() {
  const state = useUi((s) => s.profileEditor);
  const close = () => useUi.getState().editProfile(null);
  const profile = useLibrary((s) =>
    state?.mode === "edit" ? s.profiles.find((p) => p.id === state.profileId) : undefined,
  );
  const key = state
    ? state.mode === "edit"
      ? state.profileId
      : `new-${state.groupId ?? ""}`
    : "none";
  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && close()}>
      {state && (state.mode === "create" || profile) && (
        <DialogContent size="lg" key={key}>
          <ProfileForm state={state} profile={profile} onClose={close} />
        </DialogContent>
      )}
    </Dialog>
  );
}
