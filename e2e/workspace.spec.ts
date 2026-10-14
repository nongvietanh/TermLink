// UI workflow tests. They run the real frontend in Edge against the in-memory
// mock backend (Vite "e2e" mode); sessions are simulated. Real SSH behaviour
// is covered by src-tauri/tests/ssh_integration.rs and e2e-app/smoke.mjs.
import { expect, test, type Page } from "@playwright/test";

const terminalText = (page: Page, title: string) =>
  page.getByTestId(`terminal-pane-${title}`).locator(".xterm-rows");

async function connectWebWithPassword(page: Page) {
  await page.getByTestId("profile-row-web-01").first().dblclick();
  const hostKey = page.getByRole("dialog", { name: "Unknown host" });
  await expect(hostKey).toBeVisible();
  await expect(hostKey.getByText("SHA256:")).toBeVisible();
  await hostKey.getByRole("button", { name: "Trust and connect" }).click();

  const auth = page.getByRole("dialog", { name: /Password for deploy@web-01/ });
  await expect(auth).toBeVisible();
  await auth.getByLabel("Password").fill("wrong");
  await auth.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Incorrect password, please try again")).toBeVisible();
  await page.getByRole("dialog").getByLabel("Password").fill("secret");
  await page.getByRole("dialog").getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(terminalText(page, "web-01")).toContainText("deploy@web-01.example.test:~$");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Welcome to TermLink")).toBeVisible();
});

test("connects with host key verification and password, then streams input", async ({ page }) => {
  await connectWebWithPassword(page);
  await page.getByTestId("terminal-pane-web-01").click();
  await page.keyboard.type("uname -a");
  await page.keyboard.press("Enter");
  await expect(terminalText(page, "web-01")).toContainText("mock: uname -a");
  await expect(page.locator("footer")).toContainText("Connected");
  await expect(page.locator("footer")).toContainText("deploy@web-01.example.test");
  await expect(page.getByText("Verified host")).toBeVisible();
});

test("a changed host key shows a warning and defaults to disconnecting", async ({ page }) => {
  await page.evaluate(() => {
    window.__termlinkMock!.state.knownHosts.push({
      id: 99,
      host: "web-01.example.test",
      port: 22,
      algorithm: "ssh-ed25519",
      publicKey: "AAAA",
      fingerprint: "SHA256:previouspreviouspreviouspreviouspreviousprev",
      addedAt: 0,
      lastSeenAt: 0,
    });
  });
  await page.getByTestId("profile-row-web-01").first().dblclick();
  const dialog = page.getByRole("dialog", { name: "Host key has changed" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Possible man-in-the-middle attack")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Replace key and connect" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Disconnect" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText("The connection was cancelled because the host key was not trusted").first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Reconnect" }).first()).toBeVisible();
});

test("connection failures are reported with a reconnect option", async ({ page }) => {
  await page.getByTestId("profile-row-offline box").dblclick();
  await expect(page.getByText("Connection refused by unreachable.test:22").first()).toBeVisible();
  await expect(page.getByRole("tab", { name: /offline box/ })).toBeVisible();
  await expect(page.locator("footer")).toContainText("Failed");
});

test("command palette connects and switches sessions", async ({ page }) => {
  await page.keyboard.press("Control+Shift+P");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await page.keyboard.type("staging");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Unknown host" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("tab", { name: /staging/ })).toBeVisible();
});

test("local terminal, split view and session lifecycle", async ({ page }) => {
  await page.keyboard.press("Control+Shift+T");
  await expect(terminalText(page, "Mock shell")).toContainText("mock$");
  await connectWebWithPassword(page);

  await page.keyboard.press("Control+Shift+D");
  await expect(page.getByTestId("terminal-pane-Mock shell")).toBeVisible();
  await expect(page.getByTestId("terminal-pane-web-01")).toBeVisible();
  await page.keyboard.press("Control+Shift+D");
  await expect(page.locator("[data-testid^=terminal-pane-]")).toHaveCount(1);

  // Typing exit ends the session and offers a reconnect.
  await page.getByRole("tab", { name: /Mock shell/ }).click();
  await page.getByTestId("terminal-pane-Mock shell").click();
  await page.keyboard.type("exit");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Shell exited with status 0").first()).toBeVisible();

  // Closing a connected session asks first.
  await page.getByRole("tab", { name: /web-01/ }).click();
  await page.keyboard.press("Control+Shift+W");
  const confirmDialog = page.getByRole("dialog", { name: 'Close "web-01"?' });
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole("button", { name: "Close session" }).click();
  await expect(page.getByRole("tab", { name: /web-01/ })).toHaveCount(0);
});

test("snippets are only sent on explicit action", async ({ page }) => {
  await connectWebWithPassword(page);
  await page.getByRole("button", { name: "Snippets" }).click();
  await expect(page.getByText("Disk usage")).toBeVisible();
  const writesBefore = await page.evaluate(() => window.__termlinkMock!.state.writes.length);
  await page.getByRole("button", { name: "Run" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => window.__termlinkMock!.state.writes.map((w) => w.data).join("")),
    )
    .toContain("df -h\r");
  expect(await page.evaluate(() => window.__termlinkMock!.state.writes.length)).toBeGreaterThan(
    writesBefore,
  );

  // Destructive commands require confirmation.
  await page.getByRole("button", { name: "New snippet" }).click();
  const editor = page.getByRole("dialog", { name: "New snippet" });
  await editor.getByLabel(/^Snippet name|^Name/).fill("Wipe build");
  await editor.getByLabel(/^Command/).fill("rm -rf ./build");
  await expect(editor.getByText(/potentially destructive/)).toBeVisible();
  await editor.getByRole("button", { name: "Save snippet" }).click();
  const card = page.locator("div.group", { hasText: "Wipe build" });
  await card.getByRole("button", { name: "Run" }).click();
  const confirmDialog = page.getByRole("dialog", {
    name: "Run a potentially destructive command?",
  });
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole("button", { name: "Cancel" }).click();
  expect(
    await page.evaluate(() => window.__termlinkMock!.state.writes.map((w) => w.data).join("")),
  ).not.toContain("rm -rf");
});

test("profiles can be created, searched, edited and deleted", async ({ page }) => {
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page.getByRole("button", { name: "New connection" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New connection" });
  await dialog.getByLabel(/^Host/).fill("-oProxyCommand=calc");
  await dialog.getByLabel(/^Username/).fill("ops");
  await dialog.getByRole("button", { name: "Save connection" }).click();
  await expect(dialog.getByText("Enter a valid hostname, IPv4 or IPv6 address")).toBeVisible();
  await dialog.getByLabel(/^Host/).fill("bastion.example.test");
  await dialog.getByLabel("Name", { exact: true }).fill("Bastion");
  await dialog.getByLabel("Tags").fill("jump, prod");
  await dialog.getByRole("button", { name: "Save connection" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("textbox", { name: "Search connections" }).fill("#jump");
  const row = page.getByRole("row", { name: /Bastion/ });
  await expect(row).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(2); // header + 1

  await row.getByRole("button", { name: "Edit Bastion" }).click();
  const edit = page.getByRole("dialog", { name: "Edit Bastion" });
  await edit.getByLabel("Port").fill("2200");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(row).toContainText("ops@bastion.example.test:2200");

  await row.getByRole("button", { name: "Delete Bastion" }).click();
  await page
    .getByRole("dialog", { name: 'Delete "Bastion"?' })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(page.getByText("No matching connections")).toBeVisible();
});

test("settings persist through the backend", async ({ page }) => {
  await page.keyboard.press("Control+Comma");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByRole("radio", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect
    .poll(() => page.evaluate(() => window.__termlinkMock!.state.settings.appearance.theme), {
      timeout: 3000,
    })
    .toBe("light");
});
