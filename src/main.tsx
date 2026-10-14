import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./index.css";

async function bootstrap() {
  // UI test mode only: replace the Tauri IPC with an in-memory backend.
  // This branch is removed from production builds (MODE is a build-time constant).
  if (import.meta.env.MODE === "e2e") {
    const { installMockBackend } = await import("./test/mock-backend");
    installMockBackend();
  }
  // Native-looking app: no browser context menu outside our own menus.
  if (!import.meta.env.DEV) {
    window.addEventListener("contextmenu", (e) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest("input, textarea, .selectable")) e.preventDefault();
    });
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
