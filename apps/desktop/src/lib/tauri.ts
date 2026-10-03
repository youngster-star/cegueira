/**
 * Tauri 运行时探测与原生命令调用封装。
 * 不引入 @tauri-apps/api，直接调用 Tauri 2 暴露的底层 invoke，
 * 避免额外依赖；后续如需可平滑替换为官方 JS API。
 */

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

interface TauriInternals {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

/** 调用 Tauri 命令；非 Tauri 运行时抛错。 */
export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error("当前非 Tauri 运行时，无法调用原生命令");
  }
  const internals = (window as unknown as { __TAURI_INTERNALS__: TauriInternals })
    .__TAURI_INTERNALS__;
  return (await internals.invoke(cmd, args)) as T;
}
