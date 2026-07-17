import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";

export interface IntegritySnapshot {
  schemaVersion: 1;
  root: string;
  capturedAt: string;
  fileCount: number;
  totalBytes: number;
  reparsePoints: string[];
  unreadablePaths: string[];
  treeSha256: string;
}

interface IntegrityEntry {
  path: string;
  bytes: number;
  sha256: string;
}

export async function createIntegritySnapshot(root: string): Promise<IntegritySnapshot> {
  const canonicalRoot = await realpath(root);
  const entries: IntegrityEntry[] = [];
  const reparsePoints: string[] = [];
  const unreadablePaths: string[] = [];
  const queue: Array<{ absolute: string; relative: string }> = [{ absolute: canonicalRoot, relative: "" }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    let children;
    try {
      children = await readdir(current.absolute, { withFileTypes: true });
    } catch {
      unreadablePaths.push(current.relative || ".");
      continue;
    }
    children.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const child of children) {
      const relativePath = (current.relative ? `${current.relative}/${child.name}` : child.name).replaceAll("\\", "/");
      const absolutePath = join(current.absolute, child.name);
      try {
        const identity = await lstat(absolutePath);
        if (identity.isSymbolicLink()) {
          reparsePoints.push(relativePath);
        } else if (identity.isDirectory()) {
          queue.push({ absolute: absolutePath, relative: relativePath });
        } else if (identity.isFile()) {
          entries.push({ path: relativePath, bytes: identity.size, sha256: await hashFile(absolutePath) });
        } else {
          unreadablePaths.push(relativePath);
        }
      } catch {
        unreadablePaths.push(relativePath);
      }
    }
  }

  entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
  reparsePoints.sort();
  unreadablePaths.sort();
  const canonical = JSON.stringify({ entries, reparsePoints, unreadablePaths });
  return {
    schemaVersion: 1,
    root: canonicalRoot,
    capturedAt: new Date().toISOString(),
    fileCount: entries.length,
    totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    reparsePoints,
    unreadablePaths,
    treeSha256: createHash("sha256").update(canonical).digest("hex"),
  };
}

function hashFile(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}
