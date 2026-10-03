import fs from "node:fs";
import path from "node:path";
import type { CollectionStore } from "./store.js";

/**
 * JSON 文件存储：写入时采用「临时文件 + rename」原子写，避免半写损坏。
 * 文件损坏时 JSON.parse 抛错（而非静默重置为空），防止数据静默丢失。
 */
export function createJsonFileStore<T extends { id: string }>(
  filePath: string,
): CollectionStore<T> {
  let cache: Map<string, T> | null = null;

  function load(): Map<string, T> {
    if (cache !== null) return cache;
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      const arr = JSON.parse(raw) as T[];
      cache = new Map(arr.map((item) => [item.id, item]));
    } else {
      cache = new Map();
    }
    return cache;
  }

  function persist(): void {
    const arr = [...load().values()];
    const tmp = `${filePath}.tmp`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(arr, null, 2));
    fs.renameSync(tmp, filePath);
  }

  return {
    save(item) {
      load().set(item.id, structuredClone(item));
      persist();
    },
    get(id) {
      const v = load().get(id);
      return v === undefined ? undefined : structuredClone(v);
    },
    list() {
      return [...load().values()].map((v) => structuredClone(v));
    },
    delete(id) {
      const ok = load().delete(id);
      if (ok) persist();
      return ok;
    },
  };
}
