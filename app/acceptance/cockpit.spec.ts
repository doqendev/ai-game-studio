import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const electronExecutable = require("electron") as string;
const appRoot = resolve(__dirname, "..");
const fixtureProject = resolve(appRoot, "test", "fixtures", "comprehensive");
let acceptanceAppData: string;

test.beforeAll(async () => {
  acceptanceAppData = await mkdtemp(join(tmpdir(), "ai-game-studio-portable-acceptance-"));
});

test.afterAll(async () => rm(acceptanceAppData, { recursive: true, force: true }));

test("controlled fixture supports the complete portable read-only cockpit flow", async ({}, testInfo) => {
  const app = await launch(null, resolve(acceptanceAppData, "fixture"));
  try {
    await app.evaluate(({ dialog }, selectedPath) => {
      Object.defineProperty(dialog, "showOpenDialog", {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: [selectedPath], bookmarks: [] }),
      });
    }, fixtureProject);
    const page = await app.firstWindow();
    await expect(page.getByRole("heading", { name: "See what is really in a Godot project." })).toBeVisible();
    const invokingButton = page.getByRole("button", { name: "Choose project", exact: true }).first();
    await invokingButton.click();
    await expect(page.getByTestId("trust-dialog")).toBeVisible();
    await expect(page.getByText("Open only a project that you created or trust.")).toBeVisible();
    await expect(page.getByTestId("cancel-trust-button")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByTestId("trust-project-button")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("cancel-trust-button")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(invokingButton).toBeFocused();
    await expect(page.getByText("Scanning is paused").first()).toBeVisible();
    await page.getByRole("button", { name: "Review trust" }).click();
    await page.getByTestId("trust-project-button").click();
    await expect(page.locator(".metric-card").filter({ hasText: "Inventory state" })).toContainText(/Inventory complete|Inventory partial/u, { timeout: 30_000 });

    expect(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe("undefined");
    expect(await page.evaluate(() => typeof (window as unknown as { process?: unknown }).process)).toBe("undefined");
    expect(await page.evaluate(() => Object.keys(window.studio).sort())).toEqual([
      "cancelScan",
      "chooseProject",
      "getSnapshot",
      "removeSelectedProjectTrust",
      "rescanSelectedProject",
      "saveNotes",
      "trustSelectedProject",
    ]);

    await page.getByLabel("Game brief").fill("A compact fixture for proving the read-only project cockpit.");
    await page.getByLabel("Current objective").fill("Confirm facts, warnings and limits remain distinct.");
    await expect(page.getByLabel("Game brief")).toHaveAttribute("maxlength", "5000");
    await expect(page.getByLabel("Current objective")).toHaveAttribute("maxlength", "2000");
    await expect(page.getByText(/\/ 5,000 characters/u)).toBeVisible();
    await expect(page.getByText(/\/ 2,000 characters/u)).toBeVisible();
    await page.getByTestId("save-notes-button").click();
    await expect(page.getByText("Saving to application data…")).toBeHidden();
    await page.waitForTimeout(350);
    await page.screenshot({ path: testInfo.outputPath("studio-controlled-fixture.png"), animations: "disabled" });

    await page.getByRole("button", { name: "Project", exact: true }).click();
    await expect(page.getByTestId("project-page")).toBeVisible();
    await expect(page.getByText("scenes/main.tscn", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Enabled editor plugin detected")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Project source stays separate from generated output" })).toBeVisible();
    await expect(page.getByText("android/build", { exact: true })).toBeVisible();
    await page.waitForTimeout(350);
    await page.screenshot({ path: testInfo.outputPath("project-controlled-fixture.png"), animations: "disabled" });

    await page.getByRole("button", { name: "Builds", exact: true }).click();
    await expect(page.getByTestId("builds-page")).toBeVisible();
    await expect(page.getByRole("heading", { name: "No builds recorded" })).toBeVisible();
    await page.waitForTimeout(350);
    await page.screenshot({ path: testInfo.outputPath("builds-controlled-fixture.png"), animations: "disabled" });

    await page.getByRole("button", { name: "Rescan" }).click();
    await page.getByRole("button", { name: "Studio", exact: true }).click();
    await expect(page.locator(".metric-card").filter({ hasText: "Inventory state" })).toContainText(/Inventory complete|Inventory partial/u, { timeout: 30_000 });
    await page.getByRole("button", { name: "Remove stored trust" }).click();
    await expect(page.getByText("Scanning is paused").first()).toBeVisible();
    await page.getByRole("button", { name: "Review trust" }).click();
    await page.getByTestId("trust-project-button").click();
    await expect(page.locator(".metric-card").filter({ hasText: "Inventory state" })).toContainText(/Inventory complete|Inventory partial/u, { timeout: 30_000 });
  } finally {
    await app.close();
  }
});

async function launch(project: string | null, userData: string) {
  return electron.launch({
    executablePath: electronExecutable,
    args: [appRoot, ...(project ? [`--project=${project}`] : []), `--studio-user-data=${userData}`],
    cwd: appRoot,
    env: { ...process.env, ELECTRON_ENABLE_SECURITY_WARNINGS: "true" },
  });
}
