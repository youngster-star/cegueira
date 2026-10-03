/**
 * 集合存储接口：以 id 为键的增删查改。
 * 所有返回对象均为深拷贝，外部修改不会污染内部状态。
 */
export interface CollectionStore<T extends { id: string }> {
  save(item: T): void;
  get(id: string): T | undefined;
  list(): T[];
  delete(id: string): boolean;
}
