import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  ActiveContentEntry,
  FileCollection,
  FileEntry,
  FileGroupKey,
  MissingReference,
  NamedValue,
  ProjectScanReport,
  ScanLimits,
  TruthItem,
} from "../shared/contracts";

const DEFAULT_LIMITS: ScanLimits = {
  maximumFiles: 25_000,
  maximumDepth: 32,
  maximumTextReadBytes: 2 * 1024 * 1024,
  largeFileBytes: 8 * 1024 * 1024,
  maximumReportedItemsPerGroup: 300,
};

const IGNORED_GENERATED_DIRECTORIES = new Set([".git", ".godot", ".import"]);

const GROUP_EXTENSIONS: Record<FileGroupKey, Set<string>> = {
  scenes: new Set([".tscn", ".scn"]),
  scripts: new Set([".gd"]),
  images: new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".bmp", ".tga", ".exr", ".hdr", ".dds", ".ktx"]),
  audio: new Set([".wav", ".ogg", ".mp3", ".flac"]),
  fonts: new Set([".ttf", ".otf", ".woff", ".woff2", ".fnt"]),
  resources: new Set([".tres", ".res", ".material", ".shader", ".gdshader"]),
  models: new Set([".glb", ".gltf", ".obj", ".fbx", ".dae", ".blend"]),
  video: new Set([".ogv", ".webm", ".mp4"]),
  translations: new Set([".po", ".pot", ".translation", ".csv"]),
  documents: new Set([".md", ".txt", ".json", ".xml", ".yaml", ".yml"]),
  otherRecognised: new Set([".godot", ".cfg", ".ini", ".uid", ".import", ".atlas", ".theme"]),
};

const TEXT_EXTENSIONS = new Set([".gd", ".tscn", ".tres", ".godot", ".cfg", ".ini", ".gdextension", ".gdnlib", ".shader", ".gdshader"]);
const NATIVE_LIBRARY_EXTENSIONS = new Set([".dll", ".so", ".dylib", ".gdnlib", ".a", ".lib"]);
const EXECUTABLE_EXTENSIONS = new Set([".exe", ".bat", ".cmd", ".ps1", ".com", ".scr", ".msi", ".apk", ".aab", ".sh"]);
const KNOWN_EXTENSIONS = new Set([
  ...Object.values(GROUP_EXTENSIONS).flatMap((set) => [...set]),
  ...NATIVE_LIBRARY_EXTENSIONS,
  ...EXECUTABLE_EXTENSIONS,
  ".gdextension",
  ".plugin",
  ".cs",
  ".csproj",
  ".sln",
  ".java",
  ".kt",
  ".gradle",
  ".properties",
  ".aar",
  ".jar",
  ".keystore",
  ".pem",
  ".crt",
]);

const DISPLAY_KEYS = new Set([
  "window/size/viewport_width",
  "window/size/viewport_height",
  "window/size/window_width_override",
  "window/size/window_height_override",
  "window/size/mode",
  "window/handheld/orientation",
  "window/stretch/mode",
  "window/stretch/aspect",
]);

const RENDERING_KEYS = new Set([
  "renderer/rendering_method",
  "renderer/rendering_method.mobile",
  "textures/vram_compression/import_etc2_astc",
  "textures/default_filters/use_nearest_mipmap_filter",
  "environment/defaults/default_clear_color",
]);

const ACTIVE_GDSCRIPT_PATTERNS: Array<{ pattern: RegExp; capability: string; evidence: string }> = [
  { pattern: /(^|\n)\s*@tool\b/u, capability: "Editor-executed script", evidence: "Contains @tool" },
  { pattern: /\bOS\s*\.\s*execute\s*\(/u, capability: "Operating-system command", evidence: "Contains OS.execute(...)" },
  { pattern: /\bOS\s*\.\s*create_process\s*\(/u, capability: "Child process creation", evidence: "Contains OS.create_process(...)" },
  { pattern: /\b(HTTPRequest|HTTPClient|TCPServer|StreamPeerTCP|PacketPeerUDP|WebSocketPeer)\b/u, capability: "Network-capable API", evidence: "References a Godot networking class" },
];

export interface ScannerIo {
  readText(path: string, signal?: AbortSignal): Promise<string>;
}

export interface ScannerOptions {
  signal?: AbortSignal;
  limits?: Partial<ScanLimits>;
  io?: ScannerIo;
  onVisit?: (relativePath: string, visitedFiles: number) => void | Promise<void>;
}

interface ParsedAssignment {
  section: string;
  key: string;
  rawValue: string;
  line: number;
}

export interface ParsedGodotConfig {
  assignments: ParsedAssignment[];
  diagnostics: string[];
}

interface TextCandidate {
  absolutePath: string;
  relativePath: string;
  bytes: number;
}

export class ScanCancelledError extends Error {
  public constructor() {
    super("Project scan was cancelled.");
    this.name = "ScanCancelledError";
  }
}

export async function validateGodotProjectRoot(selectedPath: string): Promise<string> {
  if (!isAbsolute(selectedPath)) throw new Error("PROJECT_PATH_NOT_ABSOLUTE");
  const canonicalRoot = await realpath(selectedPath);
  const rootIdentity = await lstat(canonicalRoot);
  if (!rootIdentity.isDirectory() || rootIdentity.isSymbolicLink()) throw new Error("PROJECT_ROOT_NOT_REGULAR_DIRECTORY");
  const projectFile = join(canonicalRoot, "project.godot");
  let identity;
  try {
    identity = await lstat(projectFile);
  } catch {
    throw new Error("PROJECT_GODOT_REQUIRED");
  }
  if (!identity.isFile() || identity.isSymbolicLink()) throw new Error("PROJECT_GODOT_NOT_REGULAR_FILE");
  assertInsideRoot(canonicalRoot, projectFile);
  return canonicalRoot;
}

export async function scanGodotProject(selectedPath: string, options: ScannerOptions = {}): Promise<ProjectScanReport> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const limits: ScanLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const io: ScannerIo = options.io ?? {
    readText: (path, signal) => readFile(path, { encoding: "utf8", ...(signal ? { signal } : {}) }),
  };
  ensureNotCancelled(options.signal);

  const canonicalRoot = await realpath(selectedPath);
  const rootIdentity = await lstat(canonicalRoot);
  if (!rootIdentity.isDirectory() || rootIdentity.isSymbolicLink()) throw new Error("PROJECT_ROOT_NOT_REGULAR_DIRECTORY");

  const groups = makeGroups();
  const gdExtensions = makeCollection();
  const nativeLibraries = makeCollection();
  const executables = makeCollection();
  const largeFiles = makeCollection();
  const unsupportedFiles = makeCollection();
  const textCandidates: TextCandidate[] = [];
  const allRelativeFiles = new Set<string>();
  const reparsePoints: string[] = [];
  const unreadableFiles: string[] = [];
  const activeContent: ActiveContentEntry[] = [];
  const missingReferences: MissingReference[] = [];
  const truth: TruthItem[] = [];
  const diagnostics: string[] = [];
  let visitedFiles = 0;
  let visitedDirectories = 0;
  let totalBytes = 0;
  let skippedGeneratedDirectories = 0;
  let scanWasLimited = false;
  let reportSequence = 0;

  const projectGodotPath = join(canonicalRoot, "project.godot");
  let projectGodotExists = false;
  let projectGodotReadable = false;
  let projectConfig: ParsedGodotConfig = { assignments: [], diagnostics: [] };

  try {
    const identity = await lstat(projectGodotPath);
    projectGodotExists = identity.isFile() && !identity.isSymbolicLink();
    if (projectGodotExists) {
      const text = await io.readText(projectGodotPath, options.signal);
      projectGodotReadable = true;
      projectConfig = parseGodotConfig(text);
      diagnostics.push(...projectConfig.diagnostics);
    }
  } catch (error) {
    if (isAbortError(error)) throw new ScanCancelledError();
    if (projectGodotExists) unreadableFiles.push("project.godot");
  }

  const queue: Array<{ absolutePath: string; relativePath: string; depth: number }> = [
    { absolutePath: canonicalRoot, relativePath: "", depth: 0 },
  ];

  scanLoop: while (queue.length > 0) {
    ensureNotCancelled(options.signal);
    const directory = queue.shift();
    if (!directory) break;
    visitedDirectories += 1;
    let entries;
    try {
      entries = await readdir(directory.absolutePath, { withFileTypes: true });
    } catch {
      unreadableFiles.push(directory.relativePath || ".");
      scanWasLimited = true;
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));

    for (const entry of entries) {
      ensureNotCancelled(options.signal);
      const relativePath = normalizeRelative(directory.relativePath ? `${directory.relativePath}/${entry.name}` : entry.name);
      const absolutePath = join(directory.absolutePath, entry.name);
      assertInsideRoot(canonicalRoot, absolutePath);

      let identity;
      try {
        identity = await lstat(absolutePath);
      } catch {
        unreadableFiles.push(relativePath);
        scanWasLimited = true;
        continue;
      }

      if (identity.isSymbolicLink()) {
        reparsePoints.push(relativePath);
        continue;
      }
      if (identity.isDirectory()) {
        if (IGNORED_GENERATED_DIRECTORIES.has(entry.name)) {
          skippedGeneratedDirectories += 1;
          continue;
        }
        if (directory.depth >= limits.maximumDepth) {
          scanWasLimited = true;
          addTruth("warning", "Directory depth limit reached", `The scanner did not enter ${relativePath} because the ${limits.maximumDepth}-level limit was reached.`, relativePath);
          continue;
        }
        queue.push({ absolutePath, relativePath, depth: directory.depth + 1 });
        continue;
      }
      if (!identity.isFile()) {
        unreadableFiles.push(relativePath);
        scanWasLimited = true;
        continue;
      }

      visitedFiles += 1;
      if (visitedFiles > limits.maximumFiles) {
        scanWasLimited = true;
        addTruth("warning", "File-count limit reached", `The scan stopped after ${limits.maximumFiles.toLocaleString()} files.`, relativePath);
        break scanLoop;
      }
      await options.onVisit?.(relativePath, visitedFiles);
      totalBytes += identity.size;
      const extension = extname(entry.name).toLowerCase();
      const fileEntry: FileEntry = { path: relativePath, extension: extension || "(none)", bytes: identity.size };
      allRelativeFiles.add(relativePath.toLowerCase());

      const group = groupForExtension(extension);
      if (group) addToCollection(groups[group], fileEntry, limits.maximumReportedItemsPerGroup);
      if (extension === ".gdextension") addToCollection(gdExtensions, fileEntry, limits.maximumReportedItemsPerGroup);
      if (NATIVE_LIBRARY_EXTENSIONS.has(extension)) addToCollection(nativeLibraries, fileEntry, limits.maximumReportedItemsPerGroup);
      if (EXECUTABLE_EXTENSIONS.has(extension)) addToCollection(executables, fileEntry, limits.maximumReportedItemsPerGroup);
      if (identity.size >= limits.largeFileBytes) addToCollection(largeFiles, fileEntry, limits.maximumReportedItemsPerGroup);
      if (!KNOWN_EXTENSIONS.has(extension) && basename(relativePath).toLowerCase() !== "project.godot") {
        addToCollection(unsupportedFiles, fileEntry, limits.maximumReportedItemsPerGroup);
      }
      if (TEXT_EXTENSIONS.has(extension) && identity.size <= limits.maximumTextReadBytes) {
        textCandidates.push({ absolutePath, relativePath, bytes: identity.size });
      }
      if (relativePath.toLowerCase().endsWith("/plugin.cfg") || relativePath.toLowerCase() === "plugin.cfg") {
        activeContent.push({ path: relativePath, capability: "Editor plugin declaration", evidence: "A plugin.cfg file exists" });
      }

      if (visitedFiles % 100 === 0) await new Promise<void>((resolveYield) => setImmediate(resolveYield));
    }
  }

  for (const candidate of textCandidates) {
    ensureNotCancelled(options.signal);
    let text: string;
    try {
      text = await io.readText(candidate.absolutePath, options.signal);
    } catch (error) {
      if (isAbortError(error)) throw new ScanCancelledError();
      if (!unreadableFiles.includes(candidate.relativePath)) unreadableFiles.push(candidate.relativePath);
      scanWasLimited = true;
      continue;
    }
    collectMissingReferences(canonicalRoot, candidate.relativePath, text, allRelativeFiles, missingReferences);
    if (candidate.relativePath.toLowerCase().endsWith(".gd")) {
      for (const capability of ACTIVE_GDSCRIPT_PATTERNS) {
        if (capability.pattern.test(text)) {
          activeContent.push({ path: candidate.relativePath, capability: capability.capability, evidence: capability.evidence });
        }
      }
    }
  }

  const mainSceneRaw = assignmentValue(projectConfig, "application", "run/main_scene");
  const configuredMainScene = mainSceneRaw ? normalizeResourcePath(extractFirstQuoted(mainSceneRaw) ?? mainSceneRaw) : null;
  const configuredMainSceneExists = configuredMainScene ? allRelativeFiles.has(configuredMainScene.toLowerCase()) : null;
  const configuredName = assignmentValue(projectConfig, "application", "config/name");
  const projectName = configuredName ? extractFirstQuoted(configuredName) ?? basename(canonicalRoot) : basename(canonicalRoot);

  const autoloads = assignmentsForSection(projectConfig, "autoload").map((assignment) => {
    const rawPath = extractFirstQuoted(assignment.rawValue) ?? assignment.rawValue.trim();
    const singleton = rawPath.startsWith("*");
    const path = normalizeResourcePath(singleton ? rawPath.slice(1) : rawPath);
    return { name: assignment.key, path, singleton, exists: allRelativeFiles.has(path.toLowerCase()) };
  });
  const inputActions = assignmentsForSection(projectConfig, "input").map((assignment) => assignment.key).sort();
  const displaySettings = selectedSettings(projectConfig, "display", DISPLAY_KEYS);
  const renderingSettings = selectedSettings(projectConfig, "rendering", RENDERING_KEYS);
  const enabledPluginsRaw = assignmentValue(projectConfig, "editor_plugins", "enabled") ?? "";
  const enabledPlugins = extractAllQuoted(enabledPluginsRaw).map(normalizeResourcePath).sort();

  addTruth(projectGodotExists ? "confirmed" : "warning", projectGodotExists ? "project.godot found" : "project.godot not found", projectGodotExists ? "The selected root contains a regular project.godot file." : "The selected root does not contain a readable regular project.godot file.", "project.godot");
  addTruth("confirmed", "Read-only file inventory completed", `${visitedFiles.toLocaleString()} regular files and ${visitedDirectories.toLocaleString()} directories were observed without executing project code.`);
  if (configuredMainScene) {
    addTruth(configuredMainSceneExists ? "confirmed" : "warning", configuredMainSceneExists ? "Configured main scene found" : "Configured main scene is missing", configuredMainSceneExists ? `${configuredMainScene} exists in the observed file inventory.` : `project.godot points to ${configuredMainScene}, but that path was not found.`, configuredMainScene);
  } else {
    addTruth("warning", "No configured main scene found", "The scanner did not find application/run/main_scene in the supported project.godot assignments.");
  }
  if (projectConfig.diagnostics.length > 0) addTruth("warning", "project.godot could not be parsed completely", `${projectConfig.diagnostics.length} malformed or unsupported assignment line(s) were encountered.`, "project.godot");
  if (enabledPlugins.length > 0) addTruth("warning", "Enabled editor plugin detected", `${enabledPlugins.length} plugin path(s) are enabled in project.godot. Plugin code can execute in the Godot editor.`);
  if (gdExtensions.total > 0) addTruth("warning", "GDExtension declaration detected", `${gdExtensions.total} .gdextension declaration(s) were observed. Native code may be loaded by the project.`);
  if (nativeLibraries.total > 0) addTruth("warning", "Native library content detected", `${nativeLibraries.total} native-library file(s) were observed.`);
  if (executables.total > 0) addTruth("warning", "Executable content detected", `${executables.total} executable or command file(s) were observed.`);
  if (activeContent.length > 0) addTruth("warning", "Active project capabilities detected", `${activeContent.length} editor, process, network, or command capability marker(s) were observed in supported text files.`);
  if (missingReferences.length > 0) addTruth("warning", "Local resource references appear to be missing", `${missingReferences.length} directly quoted res:// reference(s) did not match the observed inventory.`);
  if (unreadableFiles.length > 0) addTruth("warning", "Files or directories could not be read", `${unreadableFiles.length} path(s) could not be fully inspected.`);
  if (largeFiles.total > 0) addTruth("warning", "Large files detected", `${largeFiles.total} file(s) are at least ${formatBytes(limits.largeFileBytes)}.`);
  if (unsupportedFiles.total > 0) addTruth("warning", "Unsupported file types detected", `${unsupportedFiles.total} file(s) use extensions the scanner does not interpret.`);
  if (reparsePoints.length > 0) addTruth("warning", "Reparse points detected and not followed", `${reparsePoints.length} symbolic link or junction path(s) were observed and skipped.`);
  if (autoloads.some((autoload) => !autoload.exists)) addTruth("warning", "Autoload target appears to be missing", "At least one configured autoload path was not present in the observed inventory.");

  addTruth("limitation", "Dynamic loading may be invisible", "Resources assembled from strings or loaded only at runtime may not appear in the reference check.");
  addTruth("limitation", "Runtime relationships are not observed", "The scanner does not instantiate scenes, execute scripts, or observe runtime-created nodes and resources.");
  addTruth("limitation", "The project was not run", "This scan cannot prove that the project imports, starts, builds, or behaves correctly.");
  addTruth("limitation", "Gameplay quality is outside this scan", "The scanner cannot determine fun, feel, pacing, balance, performance, or visual quality.");
  addTruth("limitation", "Generated metadata is intentionally skipped", `${skippedGeneratedDirectories} .git, .godot, or .import director${skippedGeneratedDirectories === 1 ? "y was" : "ies were"} not traversed.`);
  if (Object.values(groups).some((collection) => collection.truncated) || gdExtensions.truncated || nativeLibraries.truncated || executables.truncated || largeFiles.truncated || unsupportedFiles.truncated) {
    addTruth("limitation", "Some displayed lists are truncated", `Each category displays at most ${limits.maximumReportedItemsPerGroup} paths, while category totals remain exact within the scan limits.`);
  }

  sortReportCollections(groups, gdExtensions, nativeLibraries, executables, largeFiles, unsupportedFiles);
  activeContent.sort((left, right) => left.path.localeCompare(right.path, "en") || left.capability.localeCompare(right.capability, "en"));
  missingReferences.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath, "en") || left.referencedPath.localeCompare(right.referencedPath, "en"));
  unreadableFiles.sort();
  reparsePoints.sort();

  const completed = Date.now();
  return {
    schemaVersion: 1,
    projectRoot: canonicalRoot,
    projectName,
    status: scanWasLimited || !projectGodotReadable || projectConfig.diagnostics.length > 0 ? "partial" : "complete",
    startedAt,
    completedAt: new Date(completed).toISOString(),
    durationMs: completed - started,
    limits,
    projectGodot: {
      exists: projectGodotExists,
      readable: projectGodotReadable,
      malformed: projectConfig.diagnostics.length > 0,
      diagnostics,
    },
    configuredMainScene,
    configuredMainSceneExists,
    totals: { files: visitedFiles, directories: visitedDirectories, bytes: totalBytes, skippedGeneratedDirectories },
    groups,
    autoloads,
    inputActions,
    displaySettings,
    renderingSettings,
    enabledPlugins,
    gdExtensions,
    nativeLibraries,
    executables,
    activeContent,
    missingReferences,
    unreadableFiles,
    largeFiles,
    unsupportedFiles,
    reparsePoints,
    truth,
  };

  function addTruth(kind: TruthItem["kind"], title: string, detail: string, path?: string): void {
    reportSequence += 1;
    truth.push({ id: `truth-${reportSequence}`, kind, title, detail, ...(path ? { path } : {}) });
  }
}

export function parseGodotConfig(text: string): ParsedGodotConfig {
  const assignments: ParsedAssignment[] = [];
  const diagnostics: string[] = [];
  const lines = text.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  let section = "";
  let pending: ParsedAssignment | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const source = lines[index] ?? "";
    const trimmed = source.trim();
    if (pending) {
      pending.rawValue += `\n${source}`;
      if (isBalancedValue(pending.rawValue)) {
        assignments.push(pending);
        pending = null;
      }
      continue;
    }
    if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith("#")) continue;
    const sectionMatch = /^\[([^\]]+)\]$/u.exec(trimmed);
    if (sectionMatch) {
      section = sectionMatch[1]?.trim() ?? "";
      continue;
    }
    if (trimmed.startsWith("[")) {
      diagnostics.push(`Line ${index + 1}: malformed section header`);
      continue;
    }
    const equals = source.indexOf("=");
    if (equals <= 0) {
      diagnostics.push(`Line ${index + 1}: unsupported or malformed assignment`);
      continue;
    }
    const key = source.slice(0, equals).trim();
    if (!/^[A-Za-z0-9_.\/-]+$/u.test(key)) {
      diagnostics.push(`Line ${index + 1}: malformed key`);
      continue;
    }
    const assignment: ParsedAssignment = { section, key, rawValue: source.slice(equals + 1).trim(), line: index + 1 };
    if (isBalancedValue(assignment.rawValue)) assignments.push(assignment);
    else pending = assignment;
  }
  if (pending) diagnostics.push(`Line ${pending.line}: unterminated value for ${pending.key}`);
  return { assignments, diagnostics };
}

function makeGroups(): Record<FileGroupKey, FileCollection> {
  return {
    scenes: makeCollection(),
    scripts: makeCollection(),
    images: makeCollection(),
    audio: makeCollection(),
    fonts: makeCollection(),
    resources: makeCollection(),
    models: makeCollection(),
    video: makeCollection(),
    translations: makeCollection(),
    documents: makeCollection(),
    otherRecognised: makeCollection(),
  };
}

function makeCollection(): FileCollection {
  return { total: 0, items: [], truncated: false };
}

function addToCollection(collection: FileCollection, entry: FileEntry, maximum: number): void {
  collection.total += 1;
  if (collection.items.length < maximum) collection.items.push(entry);
  else collection.truncated = true;
}

function groupForExtension(extension: string): FileGroupKey | null {
  for (const [group, extensions] of Object.entries(GROUP_EXTENSIONS) as Array<[FileGroupKey, Set<string>]>) {
    if (extensions.has(extension)) return group;
  }
  return null;
}

function collectMissingReferences(root: string, sourcePath: string, text: string, allFiles: Set<string>, output: MissingReference[]): void {
  const references = new Set<string>();
  for (const match of text.matchAll(/["'](res:\/\/[^"']+)["']/gu)) {
    const raw = match[1];
    if (!raw) continue;
    const path = normalizeResourcePath(raw.split("::", 1)[0] ?? raw);
    if (!path || path.includes("*") || path.includes("?")) continue;
    const absolute = resolve(root, ...path.split("/"));
    if (!isInsideRoot(root, absolute)) continue;
    references.add(path);
  }
  for (const referencedPath of references) {
    if (!allFiles.has(referencedPath.toLowerCase()) && output.length < 1_000) output.push({ sourcePath, referencedPath });
  }
}

function assignmentValue(config: ParsedGodotConfig, section: string, key: string): string | null {
  return config.assignments.find((assignment) => assignment.section === section && assignment.key === key)?.rawValue ?? null;
}

function assignmentsForSection(config: ParsedGodotConfig, section: string): ParsedAssignment[] {
  return config.assignments.filter((assignment) => assignment.section === section);
}

function selectedSettings(config: ParsedGodotConfig, section: string, keys: Set<string>): NamedValue[] {
  return assignmentsForSection(config, section)
    .filter((assignment) => keys.has(assignment.key))
    .map((assignment) => ({ name: assignment.key, value: assignment.rawValue.replace(/\s+/gu, " ").trim() }))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
}

function extractFirstQuoted(value: string): string | null {
  const match = /"((?:\\.|[^"\\])*)"/u.exec(value);
  if (!match) return null;
  try {
    return JSON.parse(`"${match[1] ?? ""}"`) as string;
  } catch {
    return match[1] ?? null;
  }
}

function extractAllQuoted(value: string): string[] {
  const result: string[] = [];
  for (const match of value.matchAll(/"((?:\\.|[^"\\])*)"/gu)) {
    try {
      result.push(JSON.parse(`"${match[1] ?? ""}"`) as string);
    } catch {
      if (match[1]) result.push(match[1]);
    }
  }
  return result;
}

function isBalancedValue(value: string): boolean {
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;
  let quoted = false;
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quoted) {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (character === "{") braces += 1;
    if (character === "}") braces -= 1;
    if (character === "[") brackets += 1;
    if (character === "]") brackets -= 1;
    if (character === "(") parentheses += 1;
    if (character === ")") parentheses -= 1;
  }
  return !quoted && braces === 0 && brackets === 0 && parentheses === 0;
}

function normalizeResourcePath(value: string): string {
  return normalizeRelative(value.trim().replace(/^res:\/\//u, "").replace(/^\*+/u, ""));
}

function normalizeRelative(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/^\/+|\/+$/gu, "");
}

function assertInsideRoot(root: string, path: string): void {
  if (!isInsideRoot(root, path)) throw new Error(`PATH_ESCAPES_PROJECT_ROOT ${path}`);
}

function isInsideRoot(root: string, path: string): boolean {
  const relativePath = relative(root, resolve(path));
  return relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath));
}

function ensureNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ScanCancelledError();
}

function isAbortError(error: unknown): boolean {
  return error instanceof ScanCancelledError || (error instanceof Error && error.name === "AbortError");
}

function sortCollection(collection: FileCollection): void {
  collection.items.sort((left, right) => left.path.localeCompare(right.path, "en"));
}

function sortReportCollections(groups: Record<FileGroupKey, FileCollection>, ...others: FileCollection[]): void {
  for (const collection of Object.values(groups)) sortCollection(collection);
  for (const collection of others) sortCollection(collection);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MiB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${bytes} bytes`;
}
