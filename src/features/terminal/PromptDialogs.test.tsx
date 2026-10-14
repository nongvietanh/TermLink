import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthPromptEvent, HostKeyPromptEvent } from "@/domain/types";
import { setTransport, type Transport } from "@/lib/ipc";
import { useSessions, type SessionTab } from "@/stores/sessions";
import { renderUi, setupMock } from "@/test/render";

import { PromptDialogs } from "./PromptDialogs";

const responses: { cmd: string; args: Record<string, unknown> }[] = [];

function installRecorder() {
  responses.length = 0;
  const t: Transport = {
    invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
      responses.push({ cmd, args: args ?? {} });
      return undefined;
    }) as Transport["invoke"],
    openSession: async () => {
      throw new Error("unused");
    },
  };
  setTransport(t);
}

function withPrompt(prompt: HostKeyPromptEvent | AuthPromptEvent) {
  const tab: SessionTab = {
    key: "tab1",
    title: "prod-db",
    kind: "ssh",
    request: { kind: "local" },
    profileId: null,
    color: null,
    sessionId: "11111111-1111-4111-8111-111111111111",
    generation: 1,
    state: "verifying",
    message: null,
    info: null,
    metrics: null,
    metricsUnavailable: false,
    error: null,
    exit: null,
    closedReason: null,
    prompts: [prompt],
    connectedAt: null,
    createdAt: 0,
    unread: false,
  };
  useSessions.setState({ tabs: [tab], panes: ["tab1", null], split: "single", focusedPane: 0 });
}

const hostKey = (status: "unknown" | "changed"): HostKeyPromptEvent => ({
  type: "hostKeyPrompt",
  requestId: "req-1",
  host: "db.example.com",
  port: 22,
  algorithm: "ssh-ed25519",
  fingerprint: "SHA256:newnewnewnewnewnewnewnewnewnewnewnewnewnew",
  status,
  previous:
    status === "changed"
      ? [
          {
            fingerprint: "SHA256:oldoldoldoldoldoldoldoldoldoldoldoldoldold",
            algorithm: "ssh-ed25519",
          },
        ]
      : [],
});

beforeEach(() => {
  setupMock();
  installRecorder();
});

describe("host key prompt", () => {
  it("offers trust options for an unknown host", async () => {
    withPrompt(hostKey("unknown"));
    const user = userEvent.setup();
    renderUi(<PromptDialogs />);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Unknown host")).toBeInTheDocument();
    expect(within(dialog).getByText(/newnewnew/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Trust and connect" }));
    expect(responses).toContainEqual({
      cmd: "session_respond",
      args: {
        id: "11111111-1111-4111-8111-111111111111",
        requestId: "req-1",
        response: { type: "hostKey", decision: "accept_and_save" },
      },
    });
  });

  it("warns about a changed key and requires explicit acknowledgement", async () => {
    withPrompt(hostKey("changed"));
    const user = userEvent.setup();
    renderUi(<PromptDialogs />);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Possible man-in-the-middle attack")).toBeInTheDocument();
    expect(within(dialog).getByText(/oldoldold/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Connect once" })).not.toBeInTheDocument();
    const replace = within(dialog).getByRole("button", { name: "Replace key and connect" });
    expect(replace).toBeDisabled();
    // Disconnect is the default (focused) action.
    expect(within(dialog).getByRole("button", { name: "Disconnect" })).toHaveFocus();
    await user.click(within(dialog).getByRole("checkbox"));
    expect(replace).toBeEnabled();
    await user.click(replace);
    expect(responses.at(-1)?.args.response).toEqual({
      type: "hostKey",
      decision: "accept_and_save",
    });
  });

  it("rejects on Escape", async () => {
    withPrompt(hostKey("changed"));
    const user = userEvent.setup();
    renderUi(<PromptDialogs />);
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    expect(responses.at(-1)?.args.response).toEqual({ type: "hostKey", decision: "reject" });
  });
});

describe("credential prompt", () => {
  it("submits masked values and the save choice", async () => {
    withPrompt({
      type: "authPrompt",
      requestId: "req-2",
      kind: "password",
      title: "Password for ops@db",
      instructions: "",
      fields: [{ label: "Password", echo: false }],
      canSave: true,
      error: "Incorrect password, please try again",
    });
    const user = userEvent.setup();
    renderUi(<PromptDialogs />);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Incorrect password, please try again")).toBeInTheDocument();
    const input = within(dialog).getByLabelText("Password");
    expect(input).toHaveAttribute("type", "password");
    await user.type(input, "pa55word");
    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(responses.at(-1)).toEqual({
      cmd: "session_respond",
      args: {
        id: "11111111-1111-4111-8111-111111111111",
        requestId: "req-2",
        response: { type: "credentials", values: ["pa55word"], save: true },
      },
    });
  });
});
