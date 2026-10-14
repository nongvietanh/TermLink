import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import App from "./App";
import type { Profile } from "./domain/types";
import { setupMock } from "./test/render";

const profile = (name: string, host: string, patch: Partial<Profile> = {}): Profile => ({
  id: crypto.randomUUID(),
  groupId: null,
  name,
  protocol: "ssh",
  host,
  port: 22,
  username: "deploy",
  authMethod: "password",
  keyPath: null,
  passwordSaved: false,
  passphraseSaved: false,
  favorite: false,
  notes: "",
  color: null,
  tags: [],
  terminal: {},
  ssh: { connectTimeoutSecs: 15, keepaliveIntervalSecs: 30, keepaliveMax: 3, env: [] },
  sortOrder: 0,
  lastConnectedAt: null,
  createdAt: 0,
  updatedAt: 0,
  ...patch,
});

describe("App", () => {
  it("boots, shows the dashboard and filters the explorer", async () => {
    setupMock({
      profiles: [
        profile("web-01", "web.example.com", { tags: ["prod"] }),
        profile("db", "db.example.com"),
      ],
    });
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("Welcome to TermLink")).toBeInTheDocument();
    const tree = screen.getByRole("tree", { name: "Connections" });
    expect(within(tree).getByText("web-01")).toBeInTheDocument();
    expect(within(tree).getByText("db")).toBeInTheDocument();

    // jsdom has no layout, so the resizable-panel separator's hit testing
    // would swallow a simulated click; focus the field directly instead.
    screen.getByRole("textbox", { name: "Filter connections" }).focus();
    await user.keyboard("#prod");
    await waitFor(() => expect(within(tree).queryByText("db")).not.toBeInTheDocument());
    expect(within(tree).getByText("1 result")).toBeInTheDocument();
  });

  it("creates a connection through the profile dialog with validation", async () => {
    const mock = setupMock();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Welcome to TermLink");

    await user.click(screen.getAllByRole("button", { name: /new connection/i })[0]!);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save connection" }));
    expect(await within(dialog).findByText("Host is required")).toBeInTheDocument();
    expect(within(dialog).getByText("Username is required")).toBeInTheDocument();
    expect(mock.state.profiles).toHaveLength(0);

    await user.type(within(dialog).getByLabelText(/^Host/), "bastion.example.com");
    await user.type(within(dialog).getByLabelText(/^Username/), "ops");
    await user.click(within(dialog).getByRole("button", { name: "Save connection" }));
    await waitFor(() => expect(mock.state.profiles).toHaveLength(1));
    expect(mock.state.profiles[0]).toMatchObject({
      name: "bastion.example.com",
      host: "bastion.example.com",
      username: "ops",
      port: 22,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("navigates to planned features without pretending they work", async () => {
    setupMock();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Welcome to TermLink");
    await user.click(screen.getByRole("button", { name: "Port Forwarding" }));
    expect(
      await screen.findByText("This feature is not implemented in this version"),
    ).toBeInTheDocument();
    expect(screen.getByText("Planned · not available yet")).toBeInTheDocument();
  });
});
