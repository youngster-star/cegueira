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

/** 删除某供应商的 API Key。 */
export async function deleteApiKey(provider: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("delete_secret", { service: SERVICE, account: provider });
  } else {
    localStorage.removeItem(`ceg.key.${provider}`);
  }
}
