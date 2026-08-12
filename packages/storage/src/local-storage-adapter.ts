import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { StoragePort, StoredObject } from "./storage-port.js";

export class LocalStorageAdapter implements StoragePort {
  private readonly root: string;

  public constructor(root: string) {
    this.root = path.resolve(root);
  }

  public async put(key: string, content: Readable): Promise<StoredObject> {
    const target = this.resolveKey(key);
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;

    try {
      await pipeline(content, createWriteStream(temporary, { flags: "wx" }));
      await rename(temporary, target);
      const metadata = await stat(target);
      return { key: this.normalizeKey(key), byteSize: metadata.size };
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  public read(key: string): Promise<Readable> {
    return Promise.resolve(createReadStream(this.resolveKey(key)));
  }

  public async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  public async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  private normalizeKey(key: string): string {
    return key.replaceAll("\\", "/");
  }

  private resolveKey(key: string): string {
    if (key.length === 0 || path.isAbsolute(key) || key.includes("\0")) {
      throw new Error("非法存储键");
    }

    const normalized = this.normalizeKey(key);
    const target = path.resolve(this.root, normalized);
    const relative = path.relative(this.root, target);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("存储键不能逃逸存储根目录");
    }
    return target;
  }
}
