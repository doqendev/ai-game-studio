export type TruthKind = "confirmed" | "warning" | "heuristic" | "limitation";

export type ScanStatus = "not-scanned" | "scanning" | "complete" | "partial" | "cancelled" | "failed";

export type ContentOrigin = "project-source" | "tooling" | "generated-output" | "ignored-by-godot" | "unknown";

export type MainSceneReferenceKind = "path" | "uid" | "unknown";

export const NOTE_LIMITS = {
  gameBrief: 5_000,
  currentObjective: 2_000,
} as const;

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
  evidence: "static-load" | "structured-resource";
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
  maximumMissingReferences: number;
}

export interface OriginTotals {
  files: number;
  directories: number;
  bytes: number;
}

export interface ClassifiedRoot extends OriginTotals {
  path: string;
  origin: Exclude<ContentOrigin, "project-source" | "unknown">;
  reason: string;
}

export interface ExcludedRoot {
  path: string;
  origin: "tooling" | "generated-output";
  reason: string;
}

export interface ProjectScanReport {
  schemaVersion: 2;
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
  configuredMainSceneKind: MainSceneReferenceKind | null;
  configuredMainSceneExists: boolean | null;
  totals: {
    files: number;
    directories: number;
    bytes: number;
    skippedGeneratedDirectories: number;
  };
  origins: Record<ContentOrigin, OriginTotals>;
  classifiedRoots: ClassifiedRoot[];
  excludedRoots: ExcludedRoot[];
  groups: Record<FileGroupKey, FileCollection>;
  autoloads: AutoloadEntry[];
  inputActions: string[];
  displaySettings: NamedValue[];
  renderingSettings: NamedValue[];
  enabledPlugins: string[];
  pluginDeclarations: FileCollection;
  gdExtensions: FileCollection;
  nativeLibraries: FileCollection;
  executables: FileCollection;
  activeContent: ActiveContentEntry[];
  missingReferences: MissingReference[];
  missingReferencesTruncated: boolean;
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
