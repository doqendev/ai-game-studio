import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const electronExecutable = require("electron") as string;
const appRoot = resolve(__dirname, "..");
const repositoryRoot = resolve(appRoot, "..");
const fixtureProject = resolve(appRoot, "test", "fixtures", "comprehensive");
const realProject = "E:\\doqendev\\GameDev\\bakery-sort";
const screenshotRoot = resolve(repositoryRoot, "docs", "evidence", "milestone1", "screenshots");
const acceptanceAppData = "C:\\Users\\Marcos\\AppData\\Local\\AI Game Studio\\Milestone1Acceptance";

test.beforeAll(async () => {
  await mkdir(screenshotRoot, { recursive: true });
  await rm(acceptanceAppData, { recursive: true, force: true });
});

test("controlled fixture supports the complete read-only cockpit flow", async () => {
  const app = await launch(fixtureProject, resolve(acceptanceAppData, "fixture"));
  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId("trust-dialog")).toBeVisible();
    await expect(page.getByText("Open only a project that you created or trust.")).toBeVisible();
    await page.getByTestId("cancel-trust-button").click();
    await expect(page.getByText("Scanning is paused").first()).toBeVisible();
    await page.getByRole("button", { name: "Review trust" }).click();
    await page.getByTestId("trust-project-button").click();
    await expect(page.locator(".metric-card").filter({ hasText: "Scan state" })).toContainText(/Complete|Partial/u, { timeout: 30_000 });

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
    await page.getByTestId("save-notes-button").click();
    await expect(page.getByText("Saving to application data…")).toBeHidden();
    await page.waitForTimeout(350);
    await page.screenshot({ path: resolve(screenshotRoot, "studio-controlled-fixture.png"), animations: "disabled" });

    await page.getByRole("button", { name: "Project", exact: true }).click();
    await expect(page.getByTestId("project-page")).toBeVisible();
    await expect(page.getByText("scenes/main.tscn", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Enabled editor plugin detected")).toBeVisible();
    await page.waitForTimeout(350);
    await page.screenshot({ path: resolve(screenshotRoot, "project-controlled-fixture.png"), animations: "disabled" });

    await page.getByRole("button", { name: "Builds", exact: true }).click();
    await expect(page.getByTestId("builds-page")).toBeVisible();
    await expect(page.getByRole("heading", { name: "No builds recorded" })).toBeVisible();
    await page.waitForTimeout(350);
    await page.screenshot({ path: resolve(screenshotRoot, "builds-controlled-fixture.png"), animations: "disabled" });
  } finally {
    await app.close();
  }
});

test("real Bakery Sort project opens, scans and exposes its configured state", async () => {
  const app = await launch(realProject, resolve(acceptanceAppData, "bakery-sort"));
  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId("trust-dialog")).toBeVisible();
    await page.getByTestId("trust-project-button").click();
    await expect(page.locator(".metric-card").filter({ hasText: "Scan state" })).toContainText(/Complete|Partial/u, { timeout: 45_000 });
    await expect(page.getByText("Bakery Sort", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("scenes/main.tscn", { exact: true }).first()).toBeVisible();
    await page.getByLabel("Game brief").fill("A mobile portrait sorting game set in a bakery.");
    await page.getByLabel("Current objective").fill("Review the current project inventory before choosing the next improvement.");
    await page.getByTestId("save-notes-button").click();
    await expect(page.getByText("Saving to application data…")).toBeHidden();
    await page.waitForTimeout(350);
    await page.screenshot({ path: resolve(screenshotRoot, "studio-bakery-sort.png"), animations: "disabled" });
    await page.getByRole("button", { name: "Project", exact: true }).click();
    await expect(page.getByText("Enabled editor plugin detected")).toBeVisible();
    await expect(page.getByText("AnalyticsService", { exact: true })).toBeVisible();
  } finally {
    await app.close();
  }
});

async function launch(project: string, userData: string) {
  return electron.launch({
    executablePath: electronExecutable,
    args: [appRoot, `--project=${project}`, `--studio-user-data=${userData}`],
    cwd: appRoot,
    env: { ...process.env, ELECTRON_ENABLE_SECURITY_WARNINGS: "true" },
  });
}
