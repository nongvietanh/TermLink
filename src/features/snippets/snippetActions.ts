// Sending snippet / history commands to a terminal. Commands only ever run
// from an explicit user action, and potentially destructive ones are confirmed.
import type { CommandSource } from "@/domain/types";
import { api } from "@/lib/ipc";
import { notifyError } from "@/lib/notify";
import { confirm } from "@/stores/confirm";
import { isLive, useSessions } from "@/stores/sessions";
import { useSettings } from "@/stores/settings";

import { activeTab, sendText } from "../terminal/controller";

// Mirrors is_potentially_destructive in src-tauri/src/domain/mod.rs.
const DESTRUCTIVE = [
  "rm -rf",
  "rm -fr",
  "rm -r ",
  "rm --recursive",
  "mkfs",
  "dd if=",
  "dd of=",
  "> /dev/sd",
  "shutdown",
  "reboot",
  "poweroff",
  "halt",
  "init 0",
  "init 6",
  ":(){",
  "chmod -r 777",
  "chown -r",
  "drop database",
  "drop table",
  "truncate table",
  "kill -9 -1",
  "killall",
  "systemctl stop",
  "format c:",
  "remove-item -recurse",
  "del /s",
  "rd /s",
  "git push --force",
  "git push -f",
  "git reset --hard",
  "docker system prune",
  "kubectl delete",
  "terraform destroy",
  "wipefs",
  "fdisk",
  "parted",
];

export function isPotentiallyDestructive(command: string): boolean {
  const c = command.toLowerCase();
  return DESTRUCTIVE.some((p) => c.includes(p));
}

export interface SendOptions {
  command: string;
  run: boolean;
  source: CommandSource;
  confirmBeforeRun?: boolean;
  label?: string;
  /** Target tab; defaults to the active session. */
  tabKey?: string;
}

/** Inserts (or runs) a command in a live session. Returns true if sent. */
export async function sendCommand(opts: SendOptions): Promise<boolean> {
  const tab = opts.tabKey
    ? useSessions.getState().tabs.find((t) => t.key === opts.tabKey)
    : activeTab();
  if (!tab || !isLive(tab)) {
    notifyError({
      kind: "session_closed",
      message: "Open a connected session first, then insert the command.",
    });
    return false;
  }
  const { confirmDestructiveSnippets } = useSettings.getState().settings.safety;
  const destructive = isPotentiallyDestructive(opts.command);
  const multiline = opts.command.trim().includes("\n");
  if (
    opts.run &&
    (opts.confirmBeforeRun || (confirmDestructiveSnippets && destructive) || multiline)
  ) {
    const ok = await confirm({
      title: destructive
        ? "Run a potentially destructive command?"
        : `Run ${opts.label ? `"${opts.label}"` : "command"}?`,
      description: `This sends the command to ${tab.title} and presses Enter.`,
      detail: opts.command,
      confirmLabel: "Run command",
      tone: destructive ? "danger" : "default",
    });
    if (!ok) return false;
  }
  const sent = sendText(tab.key, opts.command, opts.run);
  if (sent) {
    void api
      .commandHistoryRecord(tab.profileId, tab.title, opts.command, opts.source)
      .catch(() => {});
  }
  return sent;
}
