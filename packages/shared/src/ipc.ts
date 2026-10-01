/**
 * Tauri 壳 ↔ Node sidecar 之间的 JSON-RPC 2.0 消息协议。
 * 两端必须复用本定义，禁止各自手写一份结构体（见 docs/开发规范.md §2）。
 */

export interface IpcError {
  code: string;
  message: string;
}

export type IpcRequest = {
  id: string;
  type: "request";
  method: string;
  payload: unknown;
};

export type IpcResponse = {
  id: string;
  type: "response";
  ok: boolean;
  data?: unknown;
  error?: IpcError;
};

/** 服务端主动推送（评分进度、token 用量等）。 */
export type IpcEvent = {
  id: string;
  type: "event";
  event: string;
  payload: unknown;
};

export type IpcMessage = IpcRequest | IpcResponse | IpcEvent;
