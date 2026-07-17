import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, truncate, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ScanCancelledError, parseGodotConfig, scanGodotProject, validateGodotProjectRoot } from "../src/main/scanner";
import { createIntegritySnapshot } from "../scripts/support/integrity";

const controlledFixture = fileURLToPath(new URL("./fixtures/comprehensive", import.meta.url));
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("read-only Godot project scanner", () => {
  it("scans a minimal valid project and confirms its main scene", async () => {
    const root = await minimalProject();
    const report = await scanGodotProject(root);
    expect(report.status).toBe("complete");
    expect(report.projectGodot.exists).toBe(true);
    expect(report.projectName).toBe("Minimal Fixture");
    expect(report.configuredMainScene).toBe("main.tscn");
    expect(report.configuredMainSceneExists).toBe(true);
    expect(report.truth.some((item) => item.kind === "limitation" && item.title === "The project was not run")).toBe(true);
  });

  it("reports missing project.godot without inventing a valid project", async () => {
    const root = await temporaryDirectory();
    await writeFile(join(root, "orphan.gd"), "extends Node\n", "utf8");
    const report = await scanGodotProject(root);
    expect(report.status).toBe("partial");
    expect(report.projectGodot.exists).toBe(false);
    await expect(validateGodotProjectRoot(root)).rejects.toThrow("PROJECT_GODOT_REQUIRED");
  });

  it("warns when the configured main scene is missing", async () => {
    const root = await minimalProject();
    await unlink(join(root, "main.tscn"));
    const report = await scanGodotProject(root);
    expect(report.configuredMainSceneExists).toBe(false);
    expect(report.truth.some((item) => item.kind === "warning" && item.title === "Configured main scene is missing")).toBe(true);
  });

  it("labels malformed project.godot as a partial scan", async () => {
    const root = await temporaryDirectory();
    await writeFile(join(root, "project.godot"), "[application\nconfig/name=\"Broken\"\nthis is malformed\n", "utf8");
    const report = await scanGodotProject(root);
    expect(report.status).toBe("partial");
    expect(report.projectGodot.malformed).toBe(true);
    expect(report.projectGodot.diagnostics.length).toBeGreaterThan(0);
  });

  it("parses multiline input assignments conservatively", () => {
    const parsed = parseGodotConfig("[input]\njump={\n\"deadzone\": 0.5,\n\"events\": []\n}\n");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.assignments).toHaveLength(1);
    expect(parsed.assignments[0]?.section).toBe("input");
    expect(parsed.assignments[0]?.key).toBe("jump");
  });

  it("observes scenes, scripts, passive assets, settings, plugins and active content", async () => {
    const root = await copiedComprehensiveFixture();
    const report = await scanGodotProject(root);
    expect(report.groups.scenes.total).toBe(2);
    expect(report.groups.scripts.total).toBe(2);
    expect(report.groups.images.total).toBe(1);
    expect(report.groups.audio.total).toBe(1);
    expect(report.groups.fonts.total).toBe(1);
    expect(report.autoloads).toEqual([{ name: "FixtureState", path: "scripts/fixture_state.gd", singleton: true, exists: true }]);
    expect(report.inputActions).toEqual(["jump", "move_left"]);
    expect(report.enabledPlugins).toEqual(["addons/demo/plugin.cfg"]);
    expect(report.pluginDeclarations.total).toBe(1);
    expect(report.gdExtensions.total).toBe(1);
    expect(report.nativeLibraries.total).toBe(1);
    expect(report.executables.total).toBe(1);
    expect(report.activeContent.some((item) => item.capability === "Editor-executed script")).toBe(true);
    expect(report.activeContent.some((item) => item.capability === "Operating-system command")).toBe(true);
    expect(report.activeContent.some((item) => item.capability === "Editor plugin declaration")).toBe(false);
  });

  it("reports a directly quoted missing local reference", async () => {
    const report = await scanGodotProject(await copiedComprehensiveFixture());
    expect(report.missingReferences).toContainEqual({ sourcePath: "scenes/menu.tscn", referencedPath: "assets/images/missing-banner.png", evidence: "structured-resource" });
  });

  it("separates .gdignore and confirmed Android output from project source", async () => {
    const report = await scanGodotProject(await copiedComprehensiveFixture());
    expect(report.origins["project-source"].files).toBe(13);
    expect(report.origins.tooling.files).toBe(1);
    expect(report.origins["generated-output"].files).toBe(7);
    expect(report.origins["ignored-by-godot"].files).toBe(2);
    expect(report.totals.files).toBe(23);
    expect(report.classifiedRoots).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "android", origin: "tooling" }),
      expect.objectContaining({ path: "android/build", origin: "generated-output" }),
      expect.objectContaining({ path: "art", origin: "ignored-by-godot" }),
    ]));
    expect(report.groups.scenes.total).toBe(2);
    expect(report.groups.scripts.total).toBe(2);
    expect(report.gdExtensions.total).toBe(1);
    expect(report.nativeLibraries.total).toBe(1);
    expect(report.missingReferences.some((item) => item.sourcePath.startsWith("android/build/") || item.sourcePath.startsWith("art/"))).toBe(false);
  });

  it("does not follow a link placed inside a Godot-ignored tree", async () => {
    const parent = await temporaryDirectory();
    const root = join(parent, "project");
    const outside = join(parent, "outside");
    await mkdir(join(root, "ignored"), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(root, "project.godot"), "[application]\nconfig/name=\"Ignored link fixture\"\n", "utf8");
    await writeFile(join(root, "ignored", ".gdignore"), "\n", "utf8");
    await writeFile(join(outside, "outside.gd"), "extends Node\n", "utf8");
    await symlink(outside, join(root, "ignored", "escape"), "junction");
    const report = await scanGodotProject(root);
    expect(report.reparsePoints).toContain("ignored/escape");
    expect(report.groups.scripts.total).toBe(0);
    expect(report.origins["ignored-by-godot"].files).toBe(1);
  });

  it("only confirms supported concrete missing dependencies", async () => {
    const root = await minimalProject();
    await mkdir(join(root, "scripts"));
    await writeFile(join(root, "scripts", "existing.gd"), "extends Node\n", "utf8");
    await writeFile(join(root, "scripts", "references.gd"), [
      "extends Node",
      "const EXISTING = preload(\"res://scripts/existing.gd\")",
      "var missing = load(\"res://missing/static.tscn\")",
      "var template_a = load(\"res://assets/audio/%s.ogg\")",
      "var template_b = load(\"res://levels/level_%02d.json\")",
      "var directory = load(\"res://assets\")",
      "var mention = \"res://not-a-dependency.tscn\"",
      "var screenshot_output = \"res://screenshots/latest.png\"",
      "",
    ].join("\n"), "utf8");
    await writeFile(join(root, "scene-with-missing.tscn"), "[gd_scene format=3]\n[ext_resource path=\"res://missing/texture.png\" type=\"Texture2D\" id=\"1\"]\n", "utf8");
    await writeFile(join(root, "output.cfg"), "[capture]\npath=\"res://screenshots/latest.png\"\n", "utf8");
    await mkdir(join(root, "addons", "missing-plugin"), { recursive: true });
    await writeFile(join(root, "addons", "missing-plugin", "plugin.cfg"), "[plugin]\nname=\"Missing plugin fixture\"\nscript=\"res://addons/missing-plugin/editor_plugin.gd\"\n", "utf8");
    const report = await scanGodotProject(root);
    expect(report.missingReferences).toEqual([
      { sourcePath: "addons/missing-plugin/plugin.cfg", referencedPath: "addons/missing-plugin/editor_plugin.gd", evidence: "structured-resource" },
      { sourcePath: "scene-with-missing.tscn", referencedPath: "missing/texture.png", evidence: "structured-resource" },
      { sourcePath: "scripts/references.gd", referencedPath: "missing/static.tscn", evidence: "static-load" },
    ]);
    expect(report.truth.some((item) => item.title === "Confirmed missing local file dependencies")).toBe(true);
  });

  it("deduplicates concrete references and reports when the cap is reached", async () => {
    const root = await minimalProject();
    await writeFile(join(root, "references.gd"), [
      "extends Node",
      "var a = load(\"res://missing/a.tscn\")",
      "var duplicate = load(\"res://missing/a.tscn\")",
      "var b = load(\"res://missing/b.tscn\")",
      "var c = load(\"res://missing/c.tscn\")",
      "",
    ].join("\n"), "utf8");
    const report = await scanGodotProject(root, { limits: { maximumMissingReferences: 2 } });
    expect(report.missingReferences).toHaveLength(2);
    expect(report.missingReferencesTruncated).toBe(true);
  });

  it("preserves a uid:// main scene without claiming it is missing", async () => {
    const root = await minimalProject();
    await writeFile(join(root, "project.godot"), "[application]\nconfig/name=\"UID Fixture\"\nrun/main_scene=\"uid://dummymainscene\"\n", "utf8");
    const report = await scanGodotProject(root);
    expect(report.configuredMainScene).toBe("uid://dummymainscene");
    expect(report.configuredMainSceneKind).toBe("uid");
    expect(report.configuredMainSceneExists).toBeNull();
    expect(report.truth.some((item) => item.kind === "limitation" && item.title === "Configured main scene uses a UID")).toBe(true);
    expect(report.truth.some((item) => item.title === "Configured main scene is missing")).toBe(false);
  });

  it("labels an unknown main-scene value without treating it as a path", async () => {
    const root = await minimalProject();
    await writeFile(join(root, "project.godot"), "[application]\nconfig/name=\"Unknown Main Fixture\"\nrun/main_scene=\"user://main.tscn\"\n", "utf8");
    const report = await scanGodotProject(root);
    expect(report.configuredMainSceneKind).toBe("unknown");
    expect(report.configuredMainSceneExists).toBeNull();
    expect(report.truth.some((item) => item.title === "Configured main scene value is unsupported")).toBe(true);
  });

  it("never exceeds the stated file-count limit", async () => {
    const root = await minimalProject();
    await writeFile(join(root, "extra.gd"), "extends Node\n", "utf8");
    const report = await scanGodotProject(root, { limits: { maximumFiles: 2 } });
    expect(report.totals.files).toBe(2);
    expect(report.status).toBe("partial");
    expect(report.truth.some((item) => item.title === "File-count limit reached")).toBe(true);
  });

  it("reports large and unsupported files with bounded path lists", async () => {
    const root = await copiedComprehensiveFixture();
    const largePath = join(root, "assets", "large.bin");
    await writeFile(largePath, "", "utf8");
    await truncate(largePath, 9 * 1024 * 1024);
    const report = await scanGodotProject(root, { limits: { maximumReportedItemsPerGroup: 2 } });
    expect(report.largeFiles.total).toBe(1);
    expect(report.unsupportedFiles.total).toBeGreaterThanOrEqual(2);
    expect(report.unsupportedFiles.items.length).toBeLessThanOrEqual(2);
    expect(report.unsupportedFiles.truncated).toBe(report.unsupportedFiles.total > 2);
  });

  it("records a reproducible read failure through the scanner I/O boundary", async () => {
    const root = await copiedComprehensiveFixture();
    const unreadablePath = join(root, "scripts", "unreadable.gd");
    await writeFile(unreadablePath, "extends Node\n", "utf8");
    const canonicalUnreadablePath = await realpath(unreadablePath);
    const report = await scanGodotProject(root, {
      io: {
        readText: async (path, signal) => {
          if (path === canonicalUnreadablePath) throw Object.assign(new Error("denied"), { code: "EACCES" });
          return readFile(path, { encoding: "utf8", ...(signal ? { signal } : {}) });
        },
      },
    });
    expect(report.status).toBe("partial");
    expect(report.unreadableFiles).toContain("scripts/unreadable.gd");
  });

  it("detects a junction and does not traverse outside the project", async () => {
    const parent = await temporaryDirectory();
    const root = join(parent, "project");
    const outside = join(parent, "outside");
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(root, "project.godot"), "[application]\nconfig/name=\"Junction Fixture\"\n", "utf8");
    await writeFile(join(outside, "outside-secret.gd"), "extends Node\n", "utf8");
    await symlink(outside, join(root, "escape"), "junction");
    const report = await scanGodotProject(root);
    expect(report.reparsePoints).toContain("escape");
    expect(report.groups.scripts.total).toBe(0);
  });

  it("bounds a deep directory tree", async () => {
    const root = await minimalProject();
    let current = root;
    for (let index = 0; index < 12; index += 1) {
      current = join(current, `level-${index}`);
      await mkdir(current);
    }
    await writeFile(join(current, "deep.gd"), "extends Node\n", "utf8");
    const report = await scanGodotProject(root, { limits: { maximumDepth: 4 } });
    expect(report.status).toBe("partial");
    expect(report.truth.some((item) => item.title === "Directory depth limit reached")).toBe(true);
  });

  it("cancels an in-progress traversal", async () => {
    const root = await minimalProject();
    await mkdir(join(root, "many"));
    await Promise.all(Array.from({ length: 100 }, (_, index) => writeFile(join(root, "many", `file-${index}.gd`), "extends Node\n", "utf8")));
    const controller = new AbortController();
    await expect(scanGodotProject(root, { signal: controller.signal, onVisit: (_path, visited) => { if (visited === 8) controller.abort(); } })).rejects.toBeInstanceOf(ScanCancelledError);
  });

  it("rescans after files change and reports the new inventory", async () => {
    const root = await minimalProject();
    const before = await scanGodotProject(root);
    await writeFile(join(root, "new-script.gd"), "extends Node\n", "utf8");
    const after = await scanGodotProject(root);
    expect(after.totals.files).toBe(before.totals.files + 1);
    expect(after.groups.scripts.total).toBe(before.groups.scripts.total + 1);
  });

  it("does not change a controlled project during scanning", async () => {
    const root = await copiedComprehensiveFixture();
    const before = await createIntegritySnapshot(root);
    await scanGodotProject(root);
    const after = await createIntegritySnapshot(root);
    expect(after.treeSha256).toBe(before.treeSha256);
    expect(after.fileCount).toBe(before.fileCount);
    expect(after.totalBytes).toBe(before.totalBytes);
  });
});

async function minimalProject(): Promise<string> {
  const root = await temporaryDirectory();
  await writeFile(join(root, "project.godot"), "[application]\nconfig/name=\"Minimal Fixture\"\nrun/main_scene=\"res://main.tscn\"\n", "utf8");
  await writeFile(join(root, "main.tscn"), "[gd_scene format=3]\n[node name=\"Main\" type=\"Node\"]\n", "utf8");
  return root;
}

async function copiedComprehensiveFixture(): Promise<string> {
  const parent = await temporaryDirectory();
  const root = join(parent, "controlled-project");
  await cp(controlledFixture, root, { recursive: true });
  return root;
}

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ai-game-studio-scanner-"));
  temporaryRoots.push(root);
  return root;
}
