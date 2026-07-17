import { describe, expect, it } from "vitest";
import { mainSceneStatus } from "../src/renderer/App";
import type { MainSceneReferenceKind, ProjectScanReport } from "../src/shared/contracts";

describe("Project main-scene summary truth state", () => {
  it.each([
    { name: "no configured main scene", value: null, kind: null, exists: null, expected: "warning" },
    { name: "path found in project source", value: "scenes/main.tscn", kind: "path", exists: true, expected: "confirmed" },
    { name: "path missing from project source", value: "scenes/missing.tscn", kind: "path", exists: false, expected: "warning" },
    { name: "UID-based main scene", value: "uid://fixture", kind: "uid", exists: null, expected: "limitation" },
    { name: "unsupported main-scene value", value: "user://main.tscn", kind: "unknown", exists: null, expected: "warning" },
  ] as const)("classifies $name honestly", ({ value, kind, exists, expected }) => {
    expect(mainSceneStatus(scanWithMainScene(value, kind, exists))).toBe(expected);
  });
});

function scanWithMainScene(
  configuredMainScene: string | null,
  configuredMainSceneKind: MainSceneReferenceKind | null,
  configuredMainSceneExists: boolean | null,
): ProjectScanReport {
  return { configuredMainScene, configuredMainSceneKind, configuredMainSceneExists } as ProjectScanReport;
}
