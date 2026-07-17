import { contextBridge, ipcRenderer } from "electron/renderer";
import type { NotesUpdate, StudioBridge } from "../shared/contracts";

const bridge: StudioBridge = {
  getSnapshot: () => ipcRenderer.invoke("studio:get-snapshot"),
  chooseProject: () => ipcRenderer.invoke("studio:choose-project"),
  trustSelectedProject: () => ipcRenderer.invoke("studio:trust-project"),
  removeSelectedProjectTrust: () => ipcRenderer.invoke("studio:remove-trust"),
  saveNotes: (update: NotesUpdate) => ipcRenderer.invoke("studio:save-notes", update),
  rescanSelectedProject: () => ipcRenderer.invoke("studio:rescan"),
  cancelScan: () => ipcRenderer.invoke("studio:cancel-scan"),
};

contextBridge.exposeInMainWorld("studio", bridge);
