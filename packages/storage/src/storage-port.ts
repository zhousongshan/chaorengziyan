import type { Readable } from "node:stream";

export interface StoredObject {
  key: string;
  byteSize: number;
}

export interface StoragePort {
  put(key: string, content: Readable): Promise<StoredObject>;
  read(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}
