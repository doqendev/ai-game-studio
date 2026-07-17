import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { createIntegritySnapshot } from "./support/integrity";

void main();

async function main(): Promise<void> {
  const root = process.argv[2];
  const output = process.argv[3];
  if (!root || !output) throw new Error("Usage: npm run integrity -- <absolute-project-root> <absolute-output-json>");
  if (!isAbsolute(root) || !isAbsolute(output)) throw new Error("Project root and output must be absolute paths.");
  const resolvedRoot = resolve(root);
  const resolvedOutput = resolve(output);
  if (isWithin(resolvedRoot, resolvedOutput)) throw new Error("Integrity output must not be written inside the selected project.");
  const snapshot = await createIntegritySnapshot(resolvedRoot);
  await mkdir(dirname(resolvedOutput), { recursive: true });
  await writeFile(resolvedOutput, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(snapshot));
}

function isWithin(rootPath: string, path: string): boolean {
  const value = relative(rootPath, path);
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
}
