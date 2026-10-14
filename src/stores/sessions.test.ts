import { beforeEach, describe, expect, it } from "vitest";

import { activeKeyOf, useSessions, type SessionTab } from "./sessions";

const tab = (key: string): SessionTab => ({
  key,
  title: key,
  kind: "ssh",
  request: { kind: "local" },
  profileId: null,
  color: null,
  sessionId: null,
  generation: 1,
  state: "connecting",
  message: null,
  info: null,
  metrics: null,
  metricsHistory: [],
  metricsUnavailable: false,
  error: null,
  exit: null,
  closedReason: null,
  prompts: [],
  connectedAt: null,
  createdAt: 0,
  unread: false,
});

const s = () => useSessions.getState();

beforeEach(() => {
  useSessions.setState({ tabs: [], split: "single", panes: [null, null], focusedPane: 0 });
});

describe("sessions store", () => {
  it("activates new tabs and cycles", () => {
    s().addTab(tab("a"));
    s().addTab(tab("b"));
    s().addTab(tab("c"));
    expect(activeKeyOf(s())).toBe("c");
    s().cycle(1);
    expect(activeKeyOf(s())).toBe("a");
    s().cycle(-1);
    expect(activeKeyOf(s())).toBe("c");
  });

  it("selects a neighbour when the active tab closes", () => {
    s().addTab(tab("a"));
    s().addTab(tab("b"));
    s().addTab(tab("c"));
    s().activate("b");
    s().removeTab("b");
    expect(activeKeyOf(s())).toBe("c");
    s().removeTab("c");
    expect(activeKeyOf(s())).toBe("a");
    s().removeTab("a");
    expect(activeKeyOf(s())).toBeNull();
  });

  it("manages split panes", () => {
    s().addTab(tab("a"));
    s().addTab(tab("b"));
    s().setSplit("horizontal");
    expect(s().panes).toEqual(["b", "a"]);
    // Activating a tab shown in the other pane moves focus instead of duplicating it.
    s().activate("a");
    expect(s().focusedPane).toBe(1);
    expect(s().panes).toEqual(["b", "a"]);
    s().addTab(tab("c"));
    expect(s().panes).toEqual(["b", "c"]);
    // Closing a visible tab fills the pane with a tab that is not already shown.
    s().removeTab("c");
    expect(s().panes).toEqual(["b", "a"]);
    s().setSplit("single");
    expect(s().panes).toEqual(["a", null]);
  });

  it("reorders tabs", () => {
    s().addTab(tab("a"));
    s().addTab(tab("b"));
    s().addTab(tab("c"));
    s().reorder("c", "a");
    expect(s().tabs.map((t) => t.key)).toEqual(["c", "a", "b"]);
  });
});
