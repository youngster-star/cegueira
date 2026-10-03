import type { CollectionStore } from "./store.js";
import type { ProfileRecord, ProjectRecord, ScoreRecord } from "./types.js";
import { createMemoryStore } from "./memory.js";
import { createJsonFileStore } from "./jsonfile.js";

/**
 * 持久化门面：聚合 projects / scores / profiles 三个集合。
 */
export interface Persistence {
  projects: CollectionStore<ProjectRecord>;
  scores: CollectionStore<ScoreRecord>;
  profiles: CollectionStore<ProfileRecord>;
}

/** 内存版（测试 / MVP）。 */
export function createMemoryPersistence(): Persistence {
  return {
    projects: createMemoryStore<ProjectRecord>(),
    scores: createMemoryStore<ScoreRecord>(),
    profiles: createMemoryStore<ProfileRecord>(),
  };
}

/** JSON 文件版：三个集合分别存到 dir 下的独立文件。 */
export function createJsonFilePersistence(dir: string): Persistence {
  return {
    projects: createJsonFileStore<ProjectRecord>(`${dir}/projects.json`),
    scores: createJsonFileStore<ScoreRecord>(`${dir}/scores.json`),
    profiles: createJsonFileStore<ProfileRecord>(`${dir}/profiles.json`),
  };
}
