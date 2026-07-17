export type TruthKind = "confirmed" | "warning" | "heuristic" | "limitation";

export type ScanStatus = "not-scanned" | "scanning" | "complete" | "partial" | "cancelled" | "failed";

export type FileGroupKey =
  | "scenes"
  | "scripts"
  | "images"
  | "audio"
  | "fonts"
  | "resources"
  | "models"
  | "video"
  | "translations"
  | "documents"
  | "otherRecognised";

export interface TruthItem {
  id: string;
  kind: TruthKind;
  title: string;
  detail: string;
  path?: string;
}

export interface FileEntry {
  path: string;
  extension: string;
  bytes: number;
}

export interface FileCollection {
  total: number;
  items: FileEntry[];
  truncated: boolean;
}

export interface NamedValue {
  name: string;
  value: string;
}

export interface AutoloadEntry {
  name: string;
  path: string;
  singleton: boolean;
  exists: boolean;
}

export interface MissingReference {
  sourcePath: string;
  referencedPath: string;
}

export interface ActiveContentEntry {
  path: string;
  capability: string;
  evidence: string;
}

export interface ScanLimits {
  maximumFiles: number;
  maximumDepth: number;
  maximumTextReadBytes: number;
  largeFileBytes: number;
  maximumReportedItemsPerGroup: number;
}

export interface ProjectScanReport {
  schemaVersion: 1;
  projectRoot: string;
  projectName: string;
  status: Exclude<ScanStatus, "not-scanned" | "scanning">;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  limits: ScanLimits;
  projectGodot: {
    exists: boolean;
    readable: boolean;
    malformed: boolean;
    diagnostics: string[];
  };
  configuredMainScene: string | null;
  configuredMainSceneExists: boolean | null;
  totals: {
    files: number;
    directories: number;
    bytes: number;
    skippedGeneratedDirectories: number;
  };
  groups: Record<FileGroupKey, FileCollection>;
  autoloads: AutoloadEntry[];
  inputActions: string[];
  displaySettings: NamedValue[];
  renderingSettings: NamedValue[];
  enabledPlugins: string[];
  gdExtensions: FileCollection;
  nativeLibraries: FileCollection;
  executables: FileCollection;
  activeContent: ActiveContentEntry[];
  missingReferences: MissingReference[];
  unreadableFiles: string[];
  largeFiles: FileCollection;
  unsupportedFiles: FileCollection;
  reparsePoints: string[];
  truth: TruthItem[];
}

export interface ProjectView {
  id: string;
  name: string;
  path: string;
  trusted: boolean;
  trustedAt: string | null;
  gameBrief: string;
  currentObjective: string;
  scanState: ScanStatus;
  scan: ProjectScanReport | null;
}

export interface StudioSnapshot {
  selectedProject: ProjectView | null;
  buildState: {
    count: 0;
    latest: null;
    message: "No builds recorded";
  };
  appDataFiles: string[];
}

export interface StudioError {
  code: string;
  message: string;
}

export type StudioResult<T> = { ok: true; value: T } | { ok: false; error: StudioError };

export interface NotesUpdate {
  gameBrief: string;
  currentObjective: string;
}

export interface StudioBridge {
  getSnapshot(): Promise<StudioResult<StudioSnapshot>>;
  chooseProject(): Promise<StudioResult<StudioSnapshot | null>>;
  trustSelectedProject(): Promise<StudioResult<StudioSnapshot>>;
  removeSelectedProjectTrust(): Promise<StudioResult<StudioSnapshot>>;
  saveNotes(update: NotesUpdate): Promise<StudioResult<StudioSnapshot>>;
  rescanSelectedProject(): Promise<StudioResult<StudioSnapshot>>;
  cancelScan(): Promise<StudioResult<StudioSnapshot>>;
}
