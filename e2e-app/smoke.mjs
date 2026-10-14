// End-to-end smoke test of the REAL desktop app (Windows).
//
// Builds (if needed) and launches the Tauri app with WebView2 remote debugging,
// starts the local dev SSH server (src-tauri/examples/dev_ssh_server.rs), then
// drives the UI with Playwright over CDP:
//   quick connect -> save as profile -> host key verification -> password
//   (wrong, then right, saved to Windows Credential Manager) -> live terminal
//   I/O -> disconnect/reconnect without prompts -> real local PowerShell ->
//   known hosts -> delete profile (removes the stored credential).
//
// The app uses a throwaway data directory and the debug-only "TermLink-dev"
// credential namespace. Usage:  node e2e-app/smoke.mjs [--build]
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, expect } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exe = join(root, "src-tauri", "target", "debug", "termlink.exe");
const serverExe = join(root, "src-tauri", "target", "debug", "examples", "dev_ssh_server.exe");
const artifacts = join(root, "e2e-app", "artifacts");
const SSH_PORT = 2299;
const CDP_PORT = 9333;
// Test credential of the local dev server (see dev_ssh_server.rs).
const DEV_PASSWORD = "termlink-dev";

const log = (msg) => console.log(`\u001b[36m›\u001b[0m ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function credentialEntries() {
  try {
    return execFileSync("cmdkey", ["/list"], { encoding: "utf8" })
      .split(/\r?\n/)
      .filter((l) => l.includes("TermLink-dev"));
  } catch {
    return [];
  }
}

if (process.platform !== "win32") {
  console.error("The app smoke test drives WebView2 and currently runs on Windows only.");
  process.exit(2);
}

if (process.argv.includes("--build") || !existsSync(exe)) {
  log("building debug app with embedded frontend (tauri build --debug --no-bundle)");
  execFileSync(
    process.execPath,
    [
      join(root, "node_modules", "@tauri-apps", "cli", "tauri.js"),
      "build",
      "--debug",
      "--no-bundle",
    ],
    { cwd: root, stdio: "inherit" },
  );
}
if (process.argv.includes("--build") || !existsSync(serverExe)) {
  log("building dev SSH server");
  execFileSync("cargo", ["build", "--example", "dev_ssh_server"], {
    cwd: join(root, "src-tauri"),
    stdio: "inherit",
  });
}

const children = [];
const dataDir = mkdtempSync(join(tmpdir(), "termlink-smoke-"));
let browser;
let failed = false;

async function startServer() {
  const server = spawn(serverExe, [String(SSH_PORT)], { stdio: ["ignore", "pipe", "inherit"] });
  children.push(server);
  return new Promise((resolveFp, reject) => {
    let out = "";
    server.stdout.on("data", (d) => {
      out += d.toString();
      const m = out.match(/host key fingerprint: (SHA256:\S+)/);
      if (m) resolveFp(m[1]);
    });
    server.on("exit", (code) => reject(new Error(`dev SSH server exited (${code})`)));
    setTimeout(() => reject(new Error("dev SSH server did not start")), 15000);
  });
}

async function connectCdp() {
  for (let i = 0; i < 60; i++) {
    try {
      const b = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
      for (let j = 0; j < 40; j++) {
        const page = b
          .contexts()
          .flatMap((c) => c.pages())
          .find((p) => /tauri\.localhost/.test(p.url()));
        if (page) {
          page.on("console", (message) => log(`[webview ${message.type()}] ${message.text()}`));
          page.on("pageerror", (error) =>
            log(`[webview uncaught] ${error.stack ?? error.message}`),
          );
          page.on("requestfailed", (request) =>
            log(`[webview request failed] ${request.url()}: ${request.failure()?.errorText}`),
          );
          return { b, page };
        }
        await sleep(250);
      }
      await b.close();
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error("could not attach to the app over CDP");
}

const rows = (page, title) => page.getByTestId(`terminal-pane-${title}`).locator(".xterm-rows");

async function typeInTerminal(page, title, text) {
  await page.getByTestId(`terminal-pane-${title}`).click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

try {
  const fingerprint = await startServer();
  log(`dev SSH server on 127.0.0.1:${SSH_PORT} (${fingerprint})`);

  const before = credentialEntries().length;
  const app = spawn(exe, [], {
    env: {
      ...process.env,
      TERMLINK_DATA_DIR: dataDir,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
    },
    stdio: "ignore",
  });
  children.push(app);
  const { b, page } = await connectCdp();
  browser = b;
  page.setDefaultTimeout(15000);
  log(`attached to ${page.url()}`);

  try {
    await expect(page.getByText("Welcome to TermLink")).toBeVisible({ timeout: 12000 });
  } catch (err) {
    log(`startup diagnostics url=${page.url()} title=${await page.title()}`);
    log(
      `startup body=${(
        await page
          .locator("body")
          .innerText()
          .catch(() => "<unavailable>")
      ).slice(0, 2000)}`,
    );
    log(
      `startup root=${(
        await page
          .locator("#root")
          .innerHTML()
          .catch(() => "<unavailable>")
      ).slice(0, 4000)}`,
    );
    throw err;
  }
  await expect(page.locator("footer")).toContainText("Windows Credential Manager");
  log("app started; credential backend is Windows Credential Manager");

  // Use the DOM renderer so terminal text is readable by the test.
  await page.keyboard.press("Control+Comma");
  const gpu = page.getByRole("switch", { name: "GPU acceleration" });
  if ((await gpu.getAttribute("aria-checked")) === "true") await gpu.click();

  // Quick connect -> save as profile.
  await page.keyboard.press("Control+Shift+O");
  const qc = page.getByRole("dialog", { name: "Quick connect" });
  await qc.getByLabel("Destination").fill(`tester@127.0.0.1:${SSH_PORT}`);
  await qc.getByRole("button", { name: "Save as profile…" }).click();
  const editor = page.getByRole("dialog", { name: "New connection" });
  await expect(editor.getByLabel(/^Host/)).toHaveValue("127.0.0.1");
  await editor.getByLabel("Name", { exact: true }).fill("Dev server");
  await editor.getByRole("button", { name: "Save and connect" }).click();
  log("profile saved, connecting");

  // Host key verification shows the server's real fingerprint.
  const hk = page.getByRole("dialog", { name: "Unknown host" });
  await expect(hk).toBeVisible();
  await expect(hk).toContainText(fingerprint.replace("SHA256:", ""));
  await hk.getByRole("button", { name: "Trust and connect" }).click();
  log("host key matches the server fingerprint and was trusted");

  // Wrong password, then the right one (saved).
  let auth = page.getByRole("dialog", { name: /Password for tester@127\.0\.0\.1/ });
  await auth.getByLabel("Password").fill("not-the-password");
  await auth.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Incorrect password, please try again")).toBeVisible();
  auth = page.getByRole("dialog", { name: /Password for tester@127\.0\.0\.1/ });
  await auth.getByLabel("Password").fill(DEV_PASSWORD);
  await auth.getByRole("checkbox").click();
  await auth.getByRole("button", { name: "Continue" }).click();
  await expect(rows(page, "Dev server")).toContainText("TermLink dev SSH server", {
    timeout: 20000,
  });
  await expect(page.locator("footer")).toContainText("Connected");
  log("authenticated; remote banner received");

  // Live I/O: UTF-8 and terminal size reporting.
  await typeInTerminal(page, "Dev server", "unicode");
  await expect(rows(page, "Dev server")).toContainText("你好");
  await typeInTerminal(page, "Dev server", "size");
  await expect(rows(page, "Dev server")).toContainText(/\d{2,3}x\d{2,3}/);
  log("terminal input/output and UTF-8 verified");

  await expect.poll(() => credentialEntries().length, { timeout: 5000 }).toBeGreaterThan(before);
  log("password stored in Windows Credential Manager");

  // Disconnect, then reconnect without any prompt (trusted key + saved password).
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("button", { name: "Reconnect" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Reconnect" }).first().click();
  await expect(page.locator("footer")).toContainText("Connected", { timeout: 20000 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  log("reconnected with saved credential and trusted host key, no prompts");

  // Real local shell (ConPTY).
  await page.keyboard.press("Control+Shift+T");
  const tabName = await page.getByRole("tab").last().textContent();
  const shellTitle = (tabName ?? "").trim();
  await expect(page.getByTestId(`terminal-pane-${shellTitle}`)).toBeVisible();
  await sleep(1500);
  const marker = shellTitle.includes("Command Prompt") ? "echo TL_42" : 'echo "TL_$(6*7)"';
  await typeInTerminal(page, shellTitle, marker);
  await expect(rows(page, shellTitle)).toContainText("TL_42", { timeout: 20000 });
  log(`local terminal (${shellTitle}) executes commands`);

  // Known hosts lists the trusted server.
  await page.getByRole("button", { name: "Saved Credentials" }).click();
  await expect(page.getByText(`127.0.0.1:${SSH_PORT}`, { exact: true })).toBeVisible();
  const savedSecrets = page.getByRole("heading", { name: "Saved secrets" }).locator("xpath=..");
  await expect(savedSecrets.getByText("Dev server", { exact: true })).toBeVisible();
  log("known host and saved secret listed");

  // Deleting the profile removes its stored password.
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page.getByRole("button", { name: "Delete Dev server" }).click();
  await page
    .getByRole("dialog", { name: 'Delete "Dev server"?' })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect.poll(() => credentialEntries().length, { timeout: 5000 }).toBe(before);
  log("profile deleted and its credential removed from Credential Manager");

  console.log("\n\u001b[32m✔ app smoke test passed\u001b[0m");
} catch (err) {
  failed = true;
  console.error("\n\u001b[31m✖ app smoke test failed\u001b[0m\n", err);
  try {
    mkdirSync(artifacts, { recursive: true });
    const page = browser?.contexts().flatMap((c) => c.pages())[0];
    if (page) await page.screenshot({ path: join(artifacts, "failure.png") });
  } catch {
    // ignore
  }
} finally {
  await browser?.close().catch(() => {});
  for (const c of children) c.kill();
  await sleep(500);
  rmSync(dataDir, { recursive: true, force: true });
  if (!failed) rmSync(join(artifacts, "failure.png"), { force: true });
  process.exit(failed ? 1 : 0);
}
