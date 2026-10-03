import type { CollectionStore } from "./store.js";

/** 内存存储：进程内 Map，适合测试与 MVP。 */
export function createMemoryStore<T extends { id: string }>(): CollectionStore<T> {
  const map = new Map<string, T>();
  return {
    save(item) {
      map.set(item.id, structuredClone(item));
    },
    get(id) {
      const v = map.get(id);
      return v === undefined ? undefined : structuredClone(v);
    },
    list() {
      return [...map.values()].map((v) => structuredClone(v));
    },
    delete(id) {
      return map.delete(id);
    },
  };
}
