import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderUi, setupMock } from "@/test/render";

import { DashboardView } from "./DashboardView";

describe("dashboard server status", () => {
  it("explains where server metrics appear when no SSH session is active", () => {
    setupMock();

    renderUi(<DashboardView />);

    expect(screen.getByText("Server status")).toBeInTheDocument();
    expect(screen.getByText("No active SSH server")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Server metrics are shown here and above the terminal after an SSH connection.",
      ),
    ).toBeInTheDocument();
  });
});
