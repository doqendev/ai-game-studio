import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { NOTE_LIMITS, type NotesUpdate } from "../shared/contracts";

interface StoredProject {
  id: string;
  canonicalPath: string;
  displayName: string;
  trustedAt: string | null;
  gameBrief: string;
  currentObjective: string;
}

interface StoredState {
  schemaVersion: 1;
  lastProjectId: string | null;
  projects: Record<string, StoredProject>;
}

const EMPTY_STATE: StoredState = { schemaVersion: 1, lastProjectId: null, projects: {} };

export class StateStore {
  private state: StoredState = structuredClone(EMPTY_STATE);
  public readonly stateFile: string;

  public constructor(public readonly userDataRoot: string) {
    this.stateFile = join(userDataRoot, "studio-state.json");
  }

  public async initialize(): Promise<void> {
    await mkdir(this.userDataRoot, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.stateFile, "utf8")) as Partial<StoredState>;
      if (parsed.schemaVersion === 1 && parsed.projects && typeof parsed.projects === "object") {
        this.state = {
          schemaVersion: 1,
          lastProjectId: typeof parsed.lastProjectId === "string" ? parsed.lastProjectId : null,
          projects: sanitizeProjects(parsed.projects as Record<string, unknown>),
        };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        const recovery = `${this.stateFile}.unreadable-${Date.now()}`;
        await rename(this.stateFile, recovery).catch(() => undefined);
      }
      this.state = structuredClone(EMPTY_STATE);
    }
  }

  public get lastProjectPath(): string | null {
    if (!this.state.lastProjectId) return null;
    return this.state.projects[this.state.lastProjectId]?.canonicalPath ?? null;
  }

  public getProject(canonicalPath: string): StoredProject {
    const id = projectId(canonicalPath);
    return this.state.projects[id] ?? {
      id,
      canonicalPath,
      displayName: basename(canonicalPath),
      trustedAt: null,
      gameBrief: "",
      currentObjective: "",
    };
  }

  public async selectProject(canonicalPath: string): Promise<StoredProject> {
    const project = this.getProject(canonicalPath);
    this.state.projects[project.id] = project;
    this.state.lastProjectId = project.id;
    await this.persist();
    return project;
  }

  public async trustProject(canonicalPath: string): Promise<StoredProject> {
    const project = this.getProject(canonicalPath);
    project.trustedAt = new Date().toISOString();
    this.state.projects[project.id] = project;
    this.state.lastProjectId = project.id;
    await this.persist();
    return project;
  }

  public async removeTrust(canonicalPath: string): Promise<StoredProject> {
    const project = this.getProject(canonicalPath);
    project.trustedAt = null;
    this.state.projects[project.id] = project;
    await this.persist();
    return project;
  }

  public async saveNotes(canonicalPath: string, update: NotesUpdate): Promise<StoredProject> {
    const gameBrief = update.gameBrief.trim();
    const currentObjective = update.currentObjective.trim();
    if (gameBrief.length > NOTE_LIMITS.gameBrief) throw new Error("GAME_BRIEF_TOO_LONG");
    if (currentObjective.length > NOTE_LIMITS.currentObjective) throw new Error("CURRENT_OBJECTIVE_TOO_LONG");
    const project = this.getProject(canonicalPath);
    project.gameBrief = gameBrief;
    project.currentObjective = currentObjective;
    this.state.projects[project.id] = project;
    await this.persist();
    return project;
  }

  private async persist(): Promise<void> {
    await mkdir(this.userDataRoot, { recursive: true });
    const temporary = `${this.stateFile}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, this.stateFile);
  }
}

export function projectId(canonicalPath: string): string {
  return createHash("sha256").update(canonicalPath.toLowerCase()).digest("hex").slice(0, 24);
}

function sanitizeProjects(input: Record<string, unknown>): Record<string, StoredProject> {
  const result: Record<string, StoredProject> = {};
  for (const [id, value] of Object.entries(input)) {
    if (!value || typeof value !== "object") continue;
    const candidate = value as Partial<StoredProject>;
    if (candidate.id !== id || typeof candidate.canonicalPath !== "string") continue;
    result[id] = {
      id,
      canonicalPath: candidate.canonicalPath,
      displayName: typeof candidate.displayName === "string" ? candidate.displayName : basename(candidate.canonicalPath),
      trustedAt: typeof candidate.trustedAt === "string" ? candidate.trustedAt : null,
      gameBrief: typeof candidate.gameBrief === "string" ? candidate.gameBrief : "",
      currentObjective: typeof candidate.currentObjective === "string" ? candidate.currentObjective : "",
    };
  }
  return result;
}
