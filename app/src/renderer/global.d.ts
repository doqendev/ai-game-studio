import type { StudioBridge } from "../shared/contracts";

declare global {
  interface Window {
    studio: StudioBridge;
  }
}

export {};
