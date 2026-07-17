import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectScanReport } from "../src/shared/contracts";
import { ScanCancelledError, scanGodotProject } from "../src/main/scanner";
import { StateStore } from "../src/main/state-store";
import { StudioController, type ProjectScanner } from "../src/main/studio-controller";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("generation-safe StudioController scanning", () => {
  it("does not let scan A cancellation overwrite scan B", async () => {
    const setup = await setupController();
    const scanA = setup.controller.rescan();
    const scanB = setup.controller.rescan();
    setup.operations[0]!.reject(new ScanCancelledError());
    await expect(scanA).resolves.toBeDefined();
    expect(setup.controller.snapshot().selectedProject?.scanState).toBe("scanning");
    setup.operations[1]!.resolve(namedReport(setup.report, "Latest report"));
    await scanB;
    expect(setup.controller.snapshot().selectedProject).toMatchObject({ name: "Latest report", scanState: "complete" });
  });

  it("invalidates scan A when another project is selected", async () => {
    const setup = await setupController();
    const otherProject = await makeProject("Other project");
    const scanA = setup.controller.rescan();
    await setup.controller.selectProject(otherProject);
    setup.operations[0]!.resolve(namedReport(setup.report, "Stale report"));
    await scanA;
    expect(setup.controller.snapshot().selectedProject).toMatchObject({ path: otherProject, scanState: "not-scanned", scan: null });
  });

  it("invalidates scan A when trust is removed", async () => {
    const setup = await setupController();
    const scanA = setup.controller.rescan();
    await setup.controller.removeSelectedProjectTrust();
    setup.operations[0]!.resolve(namedReport(setup.report, "Stale report"));
    await scanA;
    expect(setup.controller.snapshot().selectedProject).toMatchObject({ trusted: false, scanState: "not-scanned", scan: null });
  });

  it("ignores a late success from scan A after scan B starts", async () => {
    const setup = await setupController();
    const scanA = setup.controller.rescan();
    const scanB = setup.controller.rescan();
    setup.operations[0]!.resolve(namedReport(setup.report, "Stale success"));
    await scanA;
    expect(setup.controller.snapshot().selectedProject?.scanState).toBe("scanning");
    setup.operations[1]!.resolve(namedReport(setup.report, "Current success"));
    await scanB;
    expect(setup.controller.snapshot().selectedProject).toMatchObject({ name: "Current success", scanState: "complete" });
  });

  it("ignores a late failure from scan A after scan B starts", async () => {
    const setup = await setupController();
    const scanA = setup.controller.rescan();
    const scanB = setup.controller.rescan();
    setup.operations[0]!.reject(new Error("late failure"));
    await expect(scanA).resolves.toBeDefined();
    expect(setup.controller.snapshot().selectedProject?.scanState).toBe("scanning");
    setup.operations[1]!.resolve(namedReport(setup.report, "Current success"));
    await scanB;
    expect(setup.controller.snapshot().selectedProject).toMatchObject({ name: "Current success", scanState: "complete" });
  });
});

interface ControlledOperation {
  path: string;
  signal: AbortSignal;
  resolve(value: ProjectScanReport): void;
  reject(reason: unknown): void;
}

async function setupController(): Promise<{
  controller: StudioController;
  operations: ControlledOperation[];
  report: ProjectScanReport;
}> {
  const project = await makeProject("Controller fixture");
  const appData = await temporary("app-data");
  const report = await scanGodotProject(project);
  const operations: ControlledOperation[] = [];
  const scanner: ProjectScanner = (path, { signal }) => new Promise<ProjectScanReport>((resolve, reject) => {
    operations.push({ path, signal, resolve, reject });
  });
  const store = new StateStore(appData);
  await store.initialize();
  const controller = new StudioController(store, scanner);
  await controller.selectProject(project);
  await store.trustProject(project);
  return { controller, operations, report };
}

function namedReport(report: ProjectScanReport, projectName: string): ProjectScanReport {
  return { ...report, projectName };
}

async function makeProject(name: string): Promise<string> {
  const root = await temporary("project");
  await writeFile(join(root, "project.godot"), `[application]\nconfig/name="${name}"\nrun/main_scene="res://main.tscn"\n`, "utf8");
  await writeFile(join(root, "main.tscn"), "[gd_scene format=3]\n[node name=\"Main\" type=\"Node\"]\n", "utf8");
  return root;
}

async function temporary(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `ai-game-studio-controller-${label}-`));
  roots.push(root);
  return root;
}
