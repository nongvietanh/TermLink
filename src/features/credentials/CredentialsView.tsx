import { Fingerprint, KeyRound, Lock, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/field";
import { EmptyState, Notice, PageHeader, Panel } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import { api } from "@/lib/ipc";
import { useT } from "@/lib/i18n";
import { attempt, notifySuccess } from "@/lib/notify";
import { endpointLabel, formatDateTime, formatRelative } from "@/lib/utils";
import { confirm } from "@/stores/confirm";
import { useLibrary } from "@/stores/library";
import { useSettings } from "@/stores/settings";

export function CredentialsView() {
  const t = useT();
  const profiles = useLibrary((s) => s.profiles);
  const knownHosts = useLibrary((s) => s.knownHosts);
  const backend = useSettings((s) => s.appInfo?.credentialBackend ?? "system credential store");
  const withSecrets = profiles.filter((p) => p.passwordSaved || p.passphraseSaved);

  useEffect(() => {
    void useLibrary
      .getState()
      .reloadKnownHosts()
      .catch(() => {});
  }, []);

  const removeSecret = async (profileId: string, name: string, kind: "password" | "passphrase") => {
    const ok = await confirm({
      title: `${t("Remove saved")} ${t(kind)} ${t("for")} "${name}"?`,
      description: t("You will be asked for it the next time you connect."),
      confirmLabel: t("Remove"),
      tone: "danger",
    });
    if (!ok) return;
    await attempt(async () => {
      await api.credentialDelete(profileId, kind);
      useLibrary
        .getState()
        .patchProfile(
          profileId,
          kind === "password" ? { passwordSaved: false } : { passphraseSaved: false },
        );
      notifySuccess(`Saved ${kind} removed`);
    });
  };

  const forgetHost = async (id: number, label: string) => {
    const ok = await confirm({
      title: `${t("Forget host key for")} ${label}?`,
      description: t("The next connection will show the key again and ask you to verify it."),
      confirmLabel: t("Forget key"),
      tone: "danger",
    });
    if (ok) await attempt(() => useLibrary.getState().deleteKnownHost(id));
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t("Saved Credentials")}
        icon={<KeyRound />}
        description={t(
          "Secrets saved for your connections and the SSH host keys you have trusted.",
        )}
      />
      <div className="min-h-0 flex-1 space-y-6 overflow-auto px-6 py-5">
        <Notice tone="info" icon={<Lock />} title={`${t("Secrets are stored in")} ${backend}`}>
          {t(
            "TermLink never writes passwords, passphrases or private keys to its own database or logs. Private keys stay in their files; only the file path is saved with a profile.",
          )}
        </Notice>

        <section className="space-y-2">
          <SectionTitle>{t("Saved secrets")}</SectionTitle>
          <Panel>
            {withSecrets.length === 0 ? (
              <EmptyState
                icon={<KeyRound />}
                title={t("No saved secrets")}
                description={t(
                  'Tick "Save" when TermLink asks for a password or passphrase, or add a password in the connection editor.',
                )}
              />
            ) : (
              <div className="divide-y divide-line">
                {withSecrets.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                    <Lock className="size-4 text-success" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-fg">{p.name}</div>
                      <div className="font-mono text-[11px] text-faint">
                        {endpointLabel(p.username, p.host, p.port)}
                      </div>
                    </div>
                    {p.passwordSaved && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void removeSecret(p.id, p.name, "password")}
                      >
                        <Trash2 />
                        {t("Password")}
                      </Button>
                    )}
                    {p.passphraseSaved && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void removeSecret(p.id, p.name, "passphrase")}
                      >
                        <Trash2 />
                        {t("Key passphrase")}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </section>

        <section className="space-y-2">
          <SectionTitle>{t("Trusted host keys")}</SectionTitle>
          <Panel>
            {knownHosts.length === 0 ? (
              <EmptyState
                icon={<Fingerprint />}
                title={t("No trusted hosts yet")}
                description={t("Host keys appear here after you choose “Trust and connect”.")}
              />
            ) : (
              <table className="w-full text-[13px]">
                <thead className="text-left text-[11px] tracking-wide text-faint uppercase">
                  <tr className="border-b border-line">
                    <th className="px-4 py-2 font-semibold">{t("Host")}</th>
                    <th className="py-2 font-semibold">{t("Key")}</th>
                    <th className="py-2 font-semibold">{t("Fingerprint")}</th>
                    <th className="py-2 font-semibold">{t("Last seen")}</th>
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {knownHosts.map((k) => {
                    const label = k.port === 22 ? k.host : `${k.host}:${k.port}`;
                    return (
                      <tr key={k.id} className="border-b border-line/70 last:border-0">
                        <td className="px-4 py-2 font-medium text-fg">
                          <span className="flex items-center gap-2">
                            <ShieldCheck className="size-3.5 text-success" />
                            {label}
                          </span>
                        </td>
                        <td className="py-2 font-mono text-xs text-muted">{k.algorithm}</td>
                        <td
                          className="selectable max-w-[320px] truncate py-2 font-mono text-xs text-muted"
                          title={k.fingerprint}
                        >
                          {k.fingerprint}
                        </td>
                        <td
                          className="py-2 text-xs text-muted"
                          title={`Added ${formatDateTime(k.addedAt)}`}
                        >
                          {formatRelative(k.lastSeenAt ?? k.addedAt)}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          <Tooltip content={t("Forget this key")}>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`${t("Forget host key for")} ${label}`}
                              onClick={() => void forgetHost(k.id, label)}
                            >
                              <Trash2 />
                            </Button>
                          </Tooltip>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Panel>
        </section>
      </div>
    </div>
  );
}
