import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./acceptance",
  testMatch: ["owner-evidence.spec.ts"],
  outputDir: "./test-results/owner-evidence",
  reporter: [["line"]],
  workers: 1,
  timeout: 60_000,
  use: {
    trace: "retain-on-failure",
  },
});
