/**
 * API Key 安全存储：优先走系统密钥库（keyring，Tauri 命令桥），
 * 浏览器预览环境降级到 localStorage（仅开发用，不入生产）。
 */
import { invoke, isTauriRuntime } from "./tauri";

const SERVICE = "com.cegueira.desktop";

/** 保存某供应商的 API Key。 */
export async function setApiKey(provider: string, key: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("set_secret", {
      service: SERVICE,
      account: provider,
      value: key,
    });
  } else {
    localStorage.setItem(`ceg.key.${provider}`, key);
  }
}

/** 读取某供应商的 API Key；不存在返回 null。 */
export async function getApiKey(provider: string): Promise<string | null> {
  if (isTauriRuntime()) {
    try {
      return await invoke<string>("get_secret", {
        service: SERVICE,
        account: provider,
      });
    } catch {
      return null;
    }
  }
  return localStorage.getItem(`ceg.key.${provider}`);
}

/** 删除某供应商的 API Key。删除不存在的项视为成功（与 getApiKey 的错误处理一致）。 */
export async function deleteApiKey(provider: string): Promise<void> {
  if (isTauriRuntime()) {
    try {
      await invoke("delete_secret", { service: SERVICE, account: provider });
    } catch {
      // keyring 中无该项时 Tauri 会 reject（NoEntry）；删除的目标状态已达成。
    }
  } else {
    localStorage.removeItem(`ceg.key.${provider}`);
  }
}
