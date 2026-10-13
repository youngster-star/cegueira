"""录制代理：把 Agent 的 LLM 请求转发到上游，同时记录请求-响应对。

## 两个录制目标，一个入口

历史上有两代录制实现，格式不同，现在由本模块统一分派：

| 目标 | 产物 | 谁在用 |
|---|---|---|
| `RecordingSession`（新） | 三件套 http.yaml + trace.json + tool_io.log | CLI 录制（`python -m python.runtime.cli record`） |
| `Recording`（旧） | 单个扁平 JSON：指纹 → 记录 | `tests/test_e2e_tool_agent.py` |

分派规则：**`recording_session` 非空走新路径，否则走旧路径**。
旧路径必须逐字节保持原样——`test_e2e_tool_agent.py` 依赖它，
换掉等于改测试行为。

## 为什么新路径更正确

旧 `Recording` 的扁平格式**没有 host 字段**，回放时靠 `ReplayerHandler` 里
隐含的 `LOGICAL_HOST` 兜底——能跑，但是一条隐式契约（录的人和放的人必须
恰好都知道同一个常量）。`RecordingSession.add_http` 显式带上 host，
把这个约定写进了产物本身。

## LOGICAL_HOST 不是真实上游主机名

录制与回放都用 `LOGICAL_HOST`（"llm"）计算指纹，而不是真实上游地址。
这是**有意为之**：上游地址会变（本地 Ollama / 云端 API / 代理端口），
指纹若含真实主机名，换个上游录制就废了。逻辑主机名让录制产物与上游解耦——
同一份录制可以在任意后端上回放。
"""
from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

from .fingerprint import fingerprint

DEFAULT_UPSTREAM = "http://127.0.0.1:9000"
# 逻辑 host：录制与回放使用同一标识，保证指纹一致（不依赖真实代理端口）
LOGICAL_HOST = "llm"


class Recording:
    """旧版扁平录制：指纹 → 记录。保留以兼容既有测试与既有产物。"""

    def __init__(self):
        self.records: dict = {}
        self._lock = threading.Lock()

    def add(self, fp: str, record: dict):
        with self._lock:
            self.records[fp] = record

    def save(self, path):
        with self._lock:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(self.records, f, ensure_ascii=False, indent=2)


class RecorderHandler(BaseHTTPRequestHandler):
    """录制代理。

    类属性（由调用方在 serve 之前 setattr 注入）：

    - `recording_session`: 非空则用新路径（三件套，录制产品化用）
    - `recording`: 旧路径目标，仅在 `recording_session` 为空时生效
    - `upstream`: 上游基址，路径原样拼接
    """

    recording: Recording = None
    recording_session = None  # 类型为 RecordingSession | None，避免循环 import 不写注解
    upstream: str = DEFAULT_UPSTREAM

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        # 转发 Agent 原始请求头（保留 Authorization 等鉴权头），仅剔除逐跳头与
        # Accept-Encoding：urllib 不会自动解压，转发 gzip 协商会录到压缩字节流。
        hop_by_hop = {"host", "content-length", "connection", "transfer-encoding", "accept-encoding"}
        fwd_headers = {k: v for k, v in self.headers.items() if k.lower() not in hop_by_hop}
        if not any(k.lower() == "content-type" for k in fwd_headers):
            fwd_headers["Content-Type"] = "application/json"

        req = urllib.request.Request(
            self.upstream + self.path,
            data=body,
            headers=fwd_headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(req) as resp:
                resp_body = resp.read()
                # 记录真实状态码。旧实现把它硬编码成 200——上游返回 4xx/5xx 时
                # 录制产物会说「成功」，回放时就再也复现不出那次失败。
                status = getattr(resp, "status", 200)
        except urllib.error.HTTPError as e:
            # urlopen 对 ≥400 抛 HTTPError；必须在此读取错误响应体并记下真实
            # 状态码，否则 4xx/5xx 既不落盘、代理还会向上游调用方抛异常。
            resp_body = e.read()
            status = e.code

        # ---- 分派：新路径优先 ----
        if self.recording_session is not None:
            self.recording_session.add_http(
                "POST", LOGICAL_HOST, self.path, body, status, resp_body
            )
        elif self.recording is not None:
            fp = fingerprint("POST", LOGICAL_HOST, self.path, body)
            self.recording.add(fp, {
                "request": {
                    "method": "POST",
                    "path": self.path,
                    "body": body.decode("utf-8", errors="replace"),
                },
                "response": {
                    "status": 200,
                    "body": resp_body.decode("utf-8", errors="replace"),
                },
            })
        else:
            # 两个目标都没配：静默不记录是最坏的结果——录制跑完了却没有产物，
            # 用户要到评分时才发现。这里直接报错。
            raise RuntimeError(
                "RecorderHandler 未配置录制目标（recording_session 或 recording 必须有一个）"
            )

        # 如实回传上游状态码：4xx/5xx 也要让 Agent 看到失败（与录制产物一致）。
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(resp_body)))
        self.end_headers()
        self.wfile.write(resp_body)

    def log_message(self, *args):
        pass


def serve_recorder(
    port: int = 0,
    recording_session=None,
    recording: Recording | None = None,
    upstream: str = DEFAULT_UPSTREAM,
) -> tuple[HTTPServer, threading.Thread]:
    """在后台线程起一个录制代理，返回 (server, thread)。

    `port=0` 让操作系统分配空闲端口——多个录制并行或端口被占时不会失败，
    调用方从 `server.server_address[1]` 取实际端口。
    """
    if recording_session is None and recording is None:
        # 起一个什么都不记的代理等于骗人：录制跑完却没产物。
        # 在起服务时就失败，而不是等第一个请求打进来。
        raise ValueError("serve_recorder 需要 recording_session 或 recording 之一")

    class _Handler(RecorderHandler):
        pass

    _Handler.recording_session = recording_session
    _Handler.recording = recording
    _Handler.upstream = upstream

    server = HTTPServer(("127.0.0.1", port), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread
