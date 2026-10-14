import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderUi, setupMock } from "@/test/render";
import { useSessions, type SessionTab } from "@/stores/sessions";

import { StatusBar } from "./StatusBar";

function sshTab(overrides: Partial<SessionTab> = {}): SessionTab {
  return {
    key: "ssh-tab",
    title: "Production",
    kind: "ssh",
    request: { kind: "local" },
    profileId: null,
    color: null,
    sessionId: "session-1",
    generation: 1,
    state: "connected",
    message: null,
    info: {
      host: "server.example.com",
      port: 22,
      username: "deploy",
      hostKeyFingerprint: null,
      hostKeyAlgorithm: null,
      connectMs: null,
      shell: null,
    },
    metrics: {
      cpuPercent: 42,
      memoryUsedBytes: 512 * 1024 ** 2,
      memoryTotalBytes: 2 * 1024 ** 3,
      diskUsedBytes: 25 * 1024 ** 3,
      diskTotalBytes: 100 * 1024 ** 3,
      networkRxBytesPerSecond: 128_000,
      networkTxBytesPerSecond: 12_500,
      uptimeSeconds: 54 * 60 * 60,
    },
    metricsUnavailable: false,
    error: null,
    exit: null,
    closedReason: null,
    prompts: [],
    connectedAt: Date.now(),
    createdAt: Date.now(),
    unread: false,
    ...overrides,
  };
}

describe("server resource status", () => {
  it("shows live CPU, memory, root disk, network and host uptime metrics", () => {
    setupMock();
    useSessions.setState({ tabs: [sshTab()], panes: ["ssh-tab", null], focusedPane: 0 });

    renderUi(<StatusBar />);

    expect(screen.getByText("CPU 42%")).toBeInTheDocument();
    expect(screen.getByText(/RAM 512 MB \/ 2 GB/)).toBeInTheDocument();
    expect(screen.getByText("Disk 25%")).toBeInTheDocument();
    expect(screen.getByText("1.02 Mb/s")).toBeInTheDocument();
    expect(screen.getByText("100 Kb/s")).toBeInTheDocument();
    expect(screen.getByText("54h 0m")).toBeInTheDocument();
  });

  it("clearly marks servers where Linux metrics are unavailable", () => {
    setupMock();
    useSessions.setState({
      tabs: [sshTab({ metrics: null, metricsUnavailable: true })],
      panes: ["ssh-tab", null],
      focusedPane: 0,
    });

    renderUi(<StatusBar />);

    expect(screen.getByText("Metrics unavailable")).toBeInTheDocument();
  });
});
