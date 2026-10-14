// Helpers for component tests.
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { setTransport } from "@/lib/ipc";
import { useLibrary } from "@/stores/library";
import { useSessions } from "@/stores/sessions";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";

import { createMockBackend, type MockState } from "./mock-backend";

/** Resets all stores and installs a fresh mock backend. */
export function setupMock(seed: Partial<MockState> = {}) {
  const mock = createMockBackend(seed);
  setTransport(mock.transport);
  useLibrary.setState({ loaded: false, profiles: [], groups: [], snippets: [], knownHosts: [] });
  useSessions.setState({ tabs: [], split: "single", panes: [null, null], focusedPane: 0 });
  useSettings.setState({
    settings: structuredClone(mock.state.settings),
    loaded: false,
    appInfo: null,
    shells: [],
  });
  useUi.setState({
    view: "dashboard",
    paletteOpen: false,
    quickConnectOpen: false,
    profileEditor: null,
    groupEditor: null,
    snippetEditor: null,
    explorerQuery: "",
    findOpenFor: null,
  });
  return mock;
}

export function renderUi(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}
