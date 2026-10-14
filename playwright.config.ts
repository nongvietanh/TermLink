import { defineConfig } from "@playwright/test";

/**
 * End-to-end UI tests run against the Vite dev server in "e2e" mode, where the
 * Tauri IPC layer is replaced by an in-browser mock (see src/test/e2e-ipc-mock.ts).
 * They cover UI navigation and critical workflows; real protocol behaviour is
 * covered by the Rust integration tests in src-tauri/tests.
 *
 * Uses the locally installed Microsoft Edge so no browser download is needed.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:1430",
    channel: process.env.PW_CHANNEL ?? "msedge",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx vite --mode e2e --port 1430 --strictPort",
    url: "http://localhost:1430",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
