import { isAbsolute, relative, resolve, sep } from "node:path";
import type { NotesUpdate, ProjectScanReport, ScanStatus, StudioSnapshot } from "../shared/contracts";
import { ScanCancelledError, scanGodotProject, validateGodotProjectRoot } from "./scanner";
import { StateStore } from "./state-store";

export class StudioController {
  private selectedProjectPath: string | null = null;
  private scan: ProjectScanReport | null = null;
  private scanState: ScanStatus = "not-scanned";
  private scanAbortController: AbortController | null = null;

  public constructor(private readonly store: StateStore) {}

  public async initialize(initialProjectPath: string | null): Promise<void> {
    await this.store.initialize();
    const candidate = initialProjectPath ?? this.store.lastProjectPath;
    if (!candidate) return;
    try {
      await this.selectProject(candidate);
    } catch {
      this.selectedProjectPath = null;
    }
  }

  public async selectProject(path: string): Promise<StudioSnapshot> {
    const canonicalPath = await validateGodotProjectRoot(path);
    assertAppDataOutsideProject(canonicalPath, this.store.userDataRoot);
    this.scanAbortController?.abort();
    this.selectedProjectPath = canonicalPath;
    this.scan = null;
    this.scanState = "not-scanned";
    await this.store.selectProject(canonicalPath);
    return this.snapshot();
  }

  public async snapshotWithInitialScan(): Promise<StudioSnapshot> {
    if (this.selectedProjectPath && this.store.getProject(this.selectedProjectPath).trustedAt && this.scanState === "not-scanned") {
      await this.rescan();
    }
    return this.snapshot();
  }

  public snapshot(): StudioSnapshot {
    const selected = this.selectedProjectPath;
    if (!selected) {
      return { selectedProject: null, buildState: { count: 0, latest: null, message: "No builds recorded" }, appDataFiles: [this.store.stateFile] };
    }
    const stored = this.store.getProject(selected);
    return {
      selectedProject: {
        id: stored.id,
        name: this.scan?.projectName ?? stored.displayName,
        path: selected,
        trusted: stored.trustedAt !== null,
        trustedAt: stored.trustedAt,
        gameBrief: stored.gameBrief,
        currentObjective: stored.currentObjective,
        scanState: this.scanState,
        scan: this.scan,
      },
      buildState: { count: 0, latest: null, message: "No builds recorded" },
      appDataFiles: [this.store.stateFile],
    };
  }

  public async trustSelectedProject(): Promise<StudioSnapshot> {
    const selected = this.requireSelected();
    await this.store.trustProject(selected);
    await this.rescan();
    return this.snapshot();
  }

  public async removeSelectedProjectTrust(): Promise<StudioSnapshot> {
    const selected = this.requireSelected();
    this.scanAbortController?.abort();
    await this.store.removeTrust(selected);
    this.scan = null;
    this.scanState = "not-scanned";
    return this.snapshot();
  }

  public async saveNotes(update: NotesUpdate): Promise<StudioSnapshot> {
    const selected = this.requireSelected();
    await this.store.saveNotes(selected, update);
    return this.snapshot();
  }

  public async rescan(): Promise<StudioSnapshot> {
    const selected = this.requireSelected();
    if (!this.store.getProject(selected).trustedAt) throw new Error("PROJECT_TRUST_REQUIRED");
    this.scanAbortController?.abort();
    const controller = new AbortController();
    this.scanAbortController = controller;
    this.scanState = "scanning";
    try {
      const report = await scanGodotProject(selected, { signal: controller.signal });
      if (this.scanAbortController !== controller) return this.snapshot();
      this.scan = report;
      this.scanState = report.status;
    } catch (error) {
      if (error instanceof ScanCancelledError) this.scanState = "cancelled";
      else {
        this.scanState = "failed";
        throw error;
      }
    } finally {
      if (this.scanAbortController === controller) this.scanAbortController = null;
    }
    return this.snapshot();
  }

  public cancelScan(): StudioSnapshot {
    this.scanAbortController?.abort();
    if (this.scanState === "scanning") this.scanState = "cancelled";
    return this.snapshot();
  }

  private requireSelected(): string {
    if (!this.selectedProjectPath) throw new Error("NO_PROJECT_SELECTED");
    return this.selectedProjectPath;
  }
}

function assertAppDataOutsideProject(projectRoot: string, userDataRoot: string): void {
  if (!isAbsolute(userDataRoot)) throw new Error("APP_DATA_PATH_NOT_ABSOLUTE");
  const project = resolve(projectRoot);
  const appData = resolve(userDataRoot);
  if (isWithin(project, appData) || isWithin(appData, project)) throw new Error("APP_DATA_OVERLAPS_PROJECT");
}

function isWithin(root: string, path: string): boolean {
  const value = relative(root, path);
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
}
