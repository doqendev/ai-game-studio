import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { scanGodotProject } from "../src/main/scanner";

void main();

async function main(): Promise<void> {
  const root = process.argv[2];
  const output = process.argv[3];
  if (!root || !output) throw new Error("Usage: npm run scan -- <absolute-project-root> <absolute-output-json>");
  if (!isAbsolute(root) || !isAbsolute(output)) throw new Error("Project root and output must be absolute paths.");
  const resolvedRoot = resolve(root);
  const resolvedOutput = resolve(output);
  if (isWithin(resolvedRoot, resolvedOutput)) throw new Error("Scan output must not be written inside the selected project.");
  const report = await scanGodotProject(resolvedRoot);
  await mkdir(dirname(resolvedOutput), { recursive: true });
  await writeFile(resolvedOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ projectName: report.projectName, status: report.status, files: report.totals.files, warnings: report.truth.filter((item) => item.kind === "warning").length }));
}

function isWithin(rootPath: string, path: string): boolean {
  const value = relative(rootPath, path);
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
}
