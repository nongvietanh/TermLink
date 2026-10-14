import { FolderOpen, Zap } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/controls";
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
import { fieldErrors, parseTarget, quickConnectSchema } from "@/domain/schemas";
import type { AuthMethod } from "@/domain/types";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/ipc";
import { notifyError } from "@/lib/notify";
import { endpointLabel } from "@/lib/utils";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";

import { openSession } from "../terminal/controller";

function QuickConnectForm({ onClose }: { onClose: () => void }) {
  const t = useT();
  const defaultUser = useSettings((s) => s.settings.ssh.defaultUsername);
  const [target, setTarget] = useState("");
  const [username, setUsername] = useState(defaultUser);
  const [portText, setPortText] = useState("22");
  const [auth, setAuth] = useState<AuthMethod>("password");
  const [keyPath, setKeyPath] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const parsed = parseTarget(target);
  const submit = (e: FormEvent, save = false) => {
    e.preventDefault();
    const result = quickConnectSchema.safeParse({
      target,
      username,
      port: Number(portText),
      authMethod: auth,
      keyPath: keyPath || null,
    });
    if (!result.success) {
      setErrors(fieldErrors(result.error));
      return;
    }
    const v = result.data;
    onClose();
    if (save) {
      useUi.getState().editProfile({
        mode: "create",
        prefill: { host: v.host, username: v.username, port: v.port },
      });
      return;
    }
    openSession(
      {
        kind: "quick",
        host: v.host,
        port: v.port,
        username: v.username,
        authMethod: v.authMethod,
        keyPath: v.keyPath,
      },
      { title: endpointLabel(v.username, v.host, v.port), kind: "ssh" },
    );
  };

  return (
    <form onSubmit={submit} className="contents" noValidate>
      <DialogHeader icon={<Zap />}>
        <DialogTitle>{t("Quick connect")}</DialogTitle>
        <DialogDescription>{t("Open an SSH session without saving a profile.")}</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <Field
          label={t("Destination")}
          htmlFor="qc-target"
          error={errors.target}
          hint="host, user@host or user@host:port"
        >
          <Input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="deploy@server.example.com:2222"
            autoFocus
            className="font-mono"
          />
        </Field>
        <div className="grid grid-cols-[1fr_96px] gap-3">
          <Field
            label={t("Username")}
            htmlFor="qc-user"
            error={errors.username}
            hint={parsed.username ? "Taken from the destination" : undefined}
          >
            <Input
              value={parsed.username ?? username}
              disabled={!!parsed.username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="root"
            />
          </Field>
          <Field label={t("Port")} htmlFor="qc-port" error={errors.port}>
            <Input
              value={parsed.port ? String(parsed.port) : portText}
              disabled={!!parsed.port}
              inputMode="numeric"
              onChange={(e) => setPortText(e.target.value.replace(/[^\d]/g, ""))}
            />
          </Field>
        </div>
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted">{t("Authentication")}</span>
          <Segmented
            aria-label="Authentication method"
            value={auth}
            onChange={setAuth}
            className="w-full"
            options={[
              { value: "password", label: t("Password") },
              { value: "public_key", label: t("Key file") },
              { value: "agent", label: t("Agent") },
              { value: "keyboard_interactive", label: t("Interactive") },
            ]}
          />
        </div>
        {auth === "public_key" && (
          <Field label={t("Private key file")} error={errors.keyPath}>
            <div className="flex gap-2">
              <Input
                value={keyPath}
                aria-label={t("Private key file")}
                onChange={(e) => setKeyPath(e.target.value)}
                placeholder="~/.ssh/id_ed25519"
                className="font-mono text-xs"
              />
              <Button
                variant="secondary"
                onClick={async () => {
                  try {
                    const p = await api.keyFilePick();
                    if (p) setKeyPath(p);
                  } catch (err) {
                    notifyError(err);
                  }
                }}
              >
                <FolderOpen />
                {t("Browse")}
              </Button>
            </div>
          </Field>
        )}
        <p className="text-xs text-faint">
          {t(
            auth === "public_key" || auth === "agent"
              ? "Key-based login will not fall back to an account password. Encrypted keys may ask for their passphrase. The host key is verified before authentication."
              : "Passwords are requested when needed and are not stored for quick connections. The host key is verified before any credential is sent.",
          )}
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {t("Cancel")}
        </Button>
        <Button variant="secondary" onClick={(e) => submit(e as unknown as FormEvent, true)}>
          {t("Save as profile…")}
        </Button>
        <Button type="submit" variant="primary">
          <Zap />
          {t("Connect")}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function QuickConnectDialog() {
  const open = useUi((s) => s.quickConnectOpen);
  const setOpen = useUi((s) => s.setQuickConnect);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {open && (
        <DialogContent size="md">
          <QuickConnectForm onClose={() => setOpen(false)} />
        </DialogContent>
      )}
    </Dialog>
  );
}
