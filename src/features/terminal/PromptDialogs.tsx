import { Eye, EyeOff, KeyRound, ShieldAlert, ShieldQuestion } from "lucide-react";
import { useState, type FormEvent } from "react";

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
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/misc";
import type { AuthPromptEvent, HostKeyPromptEvent } from "@/domain/types";
import { useT } from "@/lib/i18n";
import { useSessions, type SessionTab } from "@/stores/sessions";
import { useSettings } from "@/stores/settings";

import { respondPrompt } from "./controller";

/** Splits "SHA256:abcd..." into readable groups. */
function Fingerprint({ value }: { value: string }) {
  const [alg, hash] = value.includes(":")
    ? [value.slice(0, value.indexOf(":")), value.slice(value.indexOf(":") + 1)]
    : ["", value];
  return (
    <code className="selectable block rounded-md border border-line bg-terminal px-3 py-2 font-mono text-[12px] leading-relaxed break-all text-fg">
      {alg && <span className="text-faint">{alg}:</span>}
      {hash}
    </code>
  );
}

function HostKeyDialog({ tab, prompt }: { tab: SessionTab; prompt: HostKeyPromptEvent }) {
  const t = useT();
  const [verified, setVerified] = useState(false);
  const changed = prompt.status === "changed";
  const endpoint = prompt.port === 22 ? prompt.host : `${prompt.host}:${prompt.port}`;
  const respond = (decision: "reject" | "accept_once" | "accept_and_save") =>
    void respondPrompt(tab.key, prompt.requestId, { type: "hostKey", decision });

  return (
    <DialogContent
      size="md"
      hideClose
      onEscapeKeyDown={() => respond("reject")}
      onInteractOutside={(e) => e.preventDefault()}
      aria-describedby={undefined}
    >
      <DialogHeader
        icon={changed ? <ShieldAlert /> : <ShieldQuestion />}
        tone={changed ? "danger" : "warning"}
      >
        <DialogTitle>{t(changed ? "Host key has changed" : "Unknown host")}</DialogTitle>
        <DialogDescription>
          {tab.title} · {endpoint}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        {changed ? (
          <Notice
            tone="danger"
            icon={<ShieldAlert />}
            title={t("Possible man-in-the-middle attack")}
          >
            {t(
              "The key presented by this server does not match the key you trusted before. Confirm the new fingerprint with the server administrator before continuing.",
            )}
          </Notice>
        ) : (
          <p className="text-[13px] text-muted">
            {t(
              "This is the first connection to this server. Verify the host key fingerprint with the server administrator before trusting it.",
            )}{" "}
            ({endpoint})
          </p>
        )}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-muted">
              {t(changed ? "New fingerprint" : "Fingerprint")}
            </span>
            <span className="font-mono text-faint">{prompt.algorithm}</span>
          </div>
          <Fingerprint value={prompt.fingerprint} />
        </div>
        {changed && prompt.previous.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted">{t("Previously trusted")}</span>
            {prompt.previous.map((p) => (
              <div key={p.fingerprint} className="opacity-70">
                <div className="mb-1 font-mono text-[11px] text-faint">{p.algorithm}</div>
                <Fingerprint value={p.fingerprint} />
              </div>
            ))}
          </div>
        )}
        {changed && (
          <label className="flex cursor-pointer items-start gap-2 text-xs text-muted">
            <Checkbox
              checked={verified}
              onCheckedChange={(v) => setVerified(v === true)}
              className="mt-px"
            />
            <span>
              {t(
                "I have verified the new fingerprint through a trusted channel and want to replace the stored key.",
              )}
            </span>
          </label>
        )}
      </DialogBody>
      <DialogFooter>
        {changed ? (
          <>
            <Button
              variant="danger-outline"
              disabled={!verified}
              onClick={() => respond("accept_and_save")}
            >
              {t("Replace key and connect")}
            </Button>
            <Button variant="primary" autoFocus onClick={() => respond("reject")}>
              {t("Disconnect")}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => respond("reject")}>
              {t("Cancel")}
            </Button>
            <Button variant="secondary" onClick={() => respond("accept_once")}>
              {t("Connect once")}
            </Button>
            <Button variant="primary" autoFocus onClick={() => respond("accept_and_save")}>
              {t("Trust and connect")}
            </Button>
          </>
        )}
      </DialogFooter>
    </DialogContent>
  );
}

function AuthDialog({ tab, prompt }: { tab: SessionTab; prompt: AuthPromptEvent }) {
  const t = useT();
  const backend = useSettings((s) => s.appInfo?.credentialBackend ?? "the system credential store");
  const [values, setValues] = useState<string[]>(() => prompt.fields.map(() => ""));
  const [reveal, setReveal] = useState<boolean[]>(() => prompt.fields.map(() => false));
  const [save, setSave] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const answer = values;
    // Clear local copies right away; the backend zeroizes its copy after use.
    setValues(prompt.fields.map(() => ""));
    void respondPrompt(tab.key, prompt.requestId, { type: "credentials", values: answer, save });
  };
  const cancel = () => void respondPrompt(tab.key, prompt.requestId, { type: "cancel" });

  return (
    <DialogContent
      size="sm"
      hideClose
      onEscapeKeyDown={cancel}
      onInteractOutside={(e) => e.preventDefault()}
      aria-describedby={undefined}
    >
      <form onSubmit={submit} className="contents">
        <DialogHeader icon={<KeyRound />}>
          <DialogTitle>{prompt.title}</DialogTitle>
          <DialogDescription>{tab.title}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {prompt.error && <Notice tone="danger">{prompt.error}</Notice>}
          {prompt.instructions && (
            <p className="selectable text-xs whitespace-pre-wrap text-muted">
              {prompt.instructions}
            </p>
          )}
          {prompt.fields.map((f, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <label htmlFor={`prompt-${i}`} className="text-xs font-medium text-muted">
                {t(f.label.replace(/:\s*$/, "") || "Response")}
              </label>
              <div className="relative">
                <Input
                  id={`prompt-${i}`}
                  type={f.echo || reveal[i] ? "text" : "password"}
                  value={values[i] ?? ""}
                  autoFocus={i === 0}
                  autoComplete="off"
                  className="pr-8"
                  onChange={(e) =>
                    setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))
                  }
                />
                {!f.echo && (
                  <button
                    type="button"
                    aria-label={t(reveal[i] ? "Hide" : "Show")}
                    onClick={() => setReveal((r) => r.map((x, j) => (j === i ? !x : x)))}
                    className="absolute top-1/2 right-2 -translate-y-1/2 text-faint hover:text-fg"
                  >
                    {reveal[i] ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                )}
              </div>
            </div>
          ))}
          {prompt.canSave && (
            <label className="flex cursor-pointer items-start gap-2 pt-1 text-xs text-muted">
              <Checkbox
                checked={save}
                onCheckedChange={(v) => setSave(v === true)}
                className="mt-px"
              />
              <span>
                {t("Save in")} {backend}
                <span className="block text-faint">
                  {t("Stored only after a successful login.")}
                </span>
              </span>
            </label>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={cancel}>
            {t("Cancel")}
          </Button>
          <Button type="submit" variant="primary">
            {t(prompt.kind === "passphrase" ? "Unlock key" : "Continue")}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/** Shows the oldest pending security prompt across all sessions. */
export function PromptDialogs() {
  const tabs = useSessions((s) => s.tabs);
  const tab = tabs.find((t) => t.prompts.length > 0);
  const prompt = tab?.prompts[0];
  return (
    <Dialog open={!!prompt}>
      {tab && prompt?.type === "hostKeyPrompt" && (
        <HostKeyDialog key={prompt.requestId} tab={tab} prompt={prompt} />
      )}
      {tab && prompt?.type === "authPrompt" && (
        <AuthDialog key={prompt.requestId} tab={tab} prompt={prompt} />
      )}
    </Dialog>
  );
}
