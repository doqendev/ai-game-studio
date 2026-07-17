import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StateStore } from "../src/main/state-store";
import { createIntegritySnapshot } from "../scripts/support/integrity";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("application-owned project memory", () => {
  it("stores trust and owner notes outside the selected project", async () => {
    const project = await temporary("project");
    const appData = await temporary("app-data");
    await writeFile(join(project, "project.godot"), "[application]\nconfig/name=\"State Fixture\"\n", "utf8");
    const before = await createIntegritySnapshot(project);
    const store = new StateStore(appData);
    await store.initialize();
    await store.selectProject(project);
    await store.trustProject(project);
    await store.saveNotes(project, { gameBrief: "A precise test brief.", currentObjective: "Verify read-only state." });
    const after = await createIntegritySnapshot(project);
    expect(after.treeSha256).toBe(before.treeSha256);
    expect(store.stateFile.startsWith(appData)).toBe(true);
    const stored = JSON.parse(await readFile(store.stateFile, "utf8")) as { projects: Record<string, { gameBrief: string; currentObjective: string; trustedAt: string }> };
    const record = Object.values(stored.projects)[0];
    expect(record?.gameBrief).toBe("A precise test brief.");
    expect(record?.currentObjective).toBe("Verify read-only state.");
    expect(record?.trustedAt).toBeTruthy();
  });

  it("removes stored trust without deleting owner notes", async () => {
    const project = await temporary("project");
    const appData = await temporary("app-data");
    const store = new StateStore(appData);
    await store.initialize();
    await store.selectProject(project);
    await store.trustProject(project);
    await store.saveNotes(project, { gameBrief: "Keep this", currentObjective: "Keep this too" });
    const record = await store.removeTrust(project);
    expect(record.trustedAt).toBeNull();
    expect(record.gameBrief).toBe("Keep this");
    expect(record.currentObjective).toBe("Keep this too");
  });
});

async function temporary(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `ai-game-studio-${label}-`));
  roots.push(root);
  return root;
}
