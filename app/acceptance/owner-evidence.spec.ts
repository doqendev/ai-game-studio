import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const electronExecutable = require("electron") as string;
const appRoot = resolve(__dirname, "..");
const fixtureProject = resolve(appRoot, "test", "fixtures", "comprehensive");
const ownerProject = process.env.STUDIO_OWNER_PROJECT ?? "";
const ownerAppData = process.env.STUDIO_OWNER_APP_DATA ?? "";
const evidenceRoot = process.env.STUDIO_EVIDENCE_ROOT ?? "";
const configured = Boolean(ownerProject && ownerAppData && evidenceRoot);
const screenshotRoot = configured ? join(evidenceRoot, "screenshots") : "";

test.describe("explicit owner evidence capture", () => {
  test.skip(!configured, "Set STUDIO_OWNER_PROJECT, STUDIO_OWNER_APP_DATA, and STUDIO_EVIDENCE_ROOT to capture owner evidence.");

  test.beforeAll(async () => {
    await mkdir(screenshotRoot, { recursive: true });
    await mkdir(ownerAppData, { recursive: true });
  });

  test("captures the corrected controlled-fixture views", async () => {
    const app = await launch(fixtureProject, join(ownerAppData, "controlled-fixture"));
    try {
      const page = await app.firstWindow();
      await page.getByTestId("trust-project-button").click();
      await expect(page.locator(".metric-card").filter({ hasText: "Inventory state" })).toContainText(/Inventory complete|Inventory partial/u, { timeout: 30_000 });
      await page.getByLabel("Game brief").fill("A compact fixture for proving the corrected read-only project cockpit.");
      await page.getByLabel("Current objective").fill("Keep project source, generated output, warnings and limitations distinct.");
      await page.getByTestId("save-notes-button").click();
      await expect(page.getByText("Saving to application data…")).toBeHidden();
      await page.waitForTimeout(350);
      await page.screenshot({ path: join(screenshotRoot, "studio-controlled-fixture.png"), animations: "disabled" });

      await page.getByRole("button", { name: "Project", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Project source stays separate from generated output" })).toBeVisible();
      await page.waitForTimeout(350);
      await page.screenshot({ path: join(screenshotRoot, "project-controlled-fixture.png"), animations: "disabled" });

      await page.getByRole("button", { name: "Builds", exact: true }).click();
      await expect(page.getByRole("heading", { name: "No builds recorded" })).toBeVisible();
      await page.waitForTimeout(350);
      await page.screenshot({ path: join(screenshotRoot, "builds-controlled-fixture.png"), animations: "disabled" });
    } finally {
      await app.close();
    }
  });

  test("captures the corrected owner-project Studio and Project views", async () => {
    const app = await launch(ownerProject, join(ownerAppData, "owner-project"));
    try {
      const page = await app.firstWindow();
      await page.getByTestId("trust-project-button").click();
      await expect(page.locator(".metric-card").filter({ hasText: "Inventory state" })).toContainText(/Inventory complete|Inventory partial/u, { timeout: 45_000 });
      await page.getByLabel("Game brief").fill("A mobile portrait sorting game set in a bakery.");
      await page.getByLabel("Current objective").fill("Review the corrected source inventory before choosing the next improvement.");
      await page.getByTestId("save-notes-button").click();
      await expect(page.getByText("Saving to application data…")).toBeHidden();
      await page.waitForTimeout(350);
      await page.screenshot({ path: join(screenshotRoot, "studio-bakery-sort.png"), animations: "disabled" });

      await page.getByRole("button", { name: "Project", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Project source stays separate from generated output" })).toBeVisible();
      await expect(page.getByText("android/build", { exact: true })).toBeVisible();
      await page.waitForTimeout(350);
      await page.screenshot({ path: join(screenshotRoot, "project-bakery-sort.png"), animations: "disabled", fullPage: false });
    } finally {
      await app.close();
    }
  });
});

async function launch(project: string, userData: string) {
  return electron.launch({
    executablePath: electronExecutable,
    args: [appRoot, `--project=${project}`, `--studio-user-data=${userData}`],
    cwd: appRoot,
    env: { ...process.env, ELECTRON_ENABLE_SECURITY_WARNINGS: "true" },
  });
}
