import { access } from "node:fs/promises";
import path from "node:path";

export async function findWorkspaceRoot(startDirectory = process.cwd()): Promise<string> {
  let current = path.resolve(startDirectory);

  while (true) {
    try {
      await access(path.join(current, "pnpm-workspace.yaml"));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error(`无法从 ${startDirectory} 定位 pnpm workspace 根目录`);
      }
      current = parent;
    }
  }
}

export async function resolveWorkspacePath(value: string): Promise<string> {
  if (path.isAbsolute(value)) return path.normalize(value);
  return path.resolve(await findWorkspaceRoot(), value);
}
