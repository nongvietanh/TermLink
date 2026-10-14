import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

import { renderUi, setupMock } from "@/test/render";

import { TopBar } from "./TopBar";

const { appWindow } = vi.hoisted(() => ({
  appWindow: {
    close: vi.fn(() => Promise.resolve()),
    isMaximized: vi.fn(() => Promise.resolve(false)),
    minimize: vi.fn(() => Promise.resolve()),
    onResized: vi.fn(() => Promise.resolve(() => {})),
    startDragging: vi.fn(() => Promise.resolve()),
    toggleMaximize: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => appWindow,
}));

describe("desktop title bar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appWindow.isMaximized.mockResolvedValue(false);
    appWindow.onResized.mockResolvedValue(() => {});
    vi.stubGlobal("__TAURI_INTERNALS__", {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows one TermLink brand with the main navigation actions", () => {
    setupMock();

    renderUi(<TopBar />);

    expect(screen.getAllByLabelText("TermLink")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Search connections and commands" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Quick connect" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Settings" })).toBeVisible();
  });

  it("routes the custom window buttons to Tauri window controls", async () => {
    setupMock();
    const user = userEvent.setup();

    renderUi(<TopBar />);

    await user.click(screen.getByRole("button", { name: "Minimize window" }));
    await user.click(screen.getByRole("button", { name: "Maximize window" }));
    await user.click(screen.getByRole("button", { name: "Close window" }));

    expect(appWindow.minimize).toHaveBeenCalledOnce();
    expect(appWindow.toggleMaximize).toHaveBeenCalledOnce();
    expect(appWindow.close).toHaveBeenCalledOnce();
  });
});
