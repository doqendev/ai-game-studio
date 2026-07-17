import { app, BrowserWindow, dialog, ipcMain, session, type IpcMainInvokeEvent } from "electron";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { NotesUpdate, StudioResult } from "../shared/contracts";
import { StateStore } from "./state-store";
import { StudioController } from "./studio-controller";

app.setName("AI Game Studio");

const userDataOverride = argumentValue("--studio-user-data=");
if (userDataOverride) {
  if (!isAbsolute(userDataOverride)) throw new Error("--studio-user-data must be an absolute path.");
  app.setPath("userData", resolve(userDataOverride));
}

const initialProjectPath = argumentValue("--project=");
const rendererHtml = join(__dirname, "..", "..", "renderer", "index.html");
const rendererUrl = pathToFileURL(rendererHtml).href;
let mainWindow: BrowserWindow | null = null;
let controller: StudioController;

void app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  const store = new StateStore(app.getPath("userData"));
  controller = new StudioController(store);
  await controller.initialize(initialProjectPath);
  registerIpc();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 680,
    show: false,
    backgroundColor: "#0a0f18",
    title: "AI Game Studio - Project Cockpit",
    webPreferences: {
      preload: join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
    },
  });
  mainWindow = window;
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (stripUrl(url) !== rendererUrl) event.preventDefault();
  });
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  void window.loadFile(rendererHtml);
}

function registerIpc(): void {
  ipcMain.handle("studio:get-snapshot", (event) => handle(event, () => controller.snapshotWithInitialScan()));
  ipcMain.handle("studio:choose-project", (event) =>
    handle(event, async () => {
      if (!mainWindow) throw new Error("WINDOW_UNAVAILABLE");
      const selection = await dialog.showOpenDialog(mainWindow, {
        title: "Open a trusted Godot project",
        buttonLabel: "Choose project",
        properties: ["openDirectory", "dontAddToRecent"],
      });
      if (selection.canceled || !selection.filePaths[0]) return null;
      return controller.selectProject(selection.filePaths[0]);
    }),
  );
  ipcMain.handle("studio:trust-project", (event) => handle(event, () => controller.trustSelectedProject()));
  ipcMain.handle("studio:remove-trust", (event) => handle(event, () => controller.removeSelectedProjectTrust()));
  ipcMain.handle("studio:save-notes", (event, update: unknown) =>
    handle(event, () => controller.saveNotes(validateNotes(update))),
  );
  ipcMain.handle("studio:rescan", (event) => handle(event, () => controller.rescan()));
  ipcMain.handle("studio:cancel-scan", (event) => handle(event, async () => controller.cancelScan()));
}

async function handle<T>(event: IpcMainInvokeEvent, operation: () => Promise<T>): Promise<StudioResult<T>> {
  try {
    assertTrustedSender(event);
    return { ok: true, value: await operation() };
  } catch (error) {
    return { ok: false, error: toStudioError(error) };
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame) {
    throw new Error("IPC_SENDER_REJECTED");
  }
  if (stripUrl(event.senderFrame.url) !== rendererUrl) throw new Error("IPC_ORIGIN_REJECTED");
}

function validateNotes(value: unknown): NotesUpdate {
  if (!value || typeof value !== "object") throw new Error("INVALID_NOTES");
  const candidate = value as Partial<NotesUpdate>;
  if (typeof candidate.gameBrief !== "string" || typeof candidate.currentObjective !== "string") throw new Error("INVALID_NOTES");
  return { gameBrief: candidate.gameBrief, currentObjective: candidate.currentObjective };
}

function toStudioError(error: unknown): { code: string; message: string } {
  const code = error instanceof Error ? error.message.split(/\s/u, 1)[0] ?? "UNEXPECTED_ERROR" : "UNEXPECTED_ERROR";
  const messages: Record<string, string> = {
    PROJECT_GODOT_REQUIRED: "That folder does not contain project.godot. Choose the root of a Godot project.",
    PROJECT_GODOT_NOT_REGULAR_FILE: "project.godot must be a regular file, not a link or unusual filesystem entry.",
    PROJECT_ROOT_NOT_REGULAR_DIRECTORY: "The selected project root is not a regular directory.",
    PROJECT_TRUST_REQUIRED: "Trust this project before scanning it.",
    APP_DATA_OVERLAPS_PROJECT: "Application data cannot be stored inside the selected project.",
    NO_PROJECT_SELECTED: "Choose a Godot project first.",
    GAME_BRIEF_TOO_LONG: "The game brief is too long for this milestone.",
    CURRENT_OBJECTIVE_TOO_LONG: "The current objective is too long for this milestone.",
  };
  return { code, message: messages[code] ?? "The requested operation could not be completed." };
}

function argumentValue(prefix: string): string | null {
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : null;
}

function stripUrl(url: string): string {
  return url.split(/[?#]/u, 1)[0] ?? url;
}
