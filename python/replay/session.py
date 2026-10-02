"""录制会话：把一次录制规范化为三类产物并落盘。

产物（见 docs/开发文档.md §8.2 / §9.2，对应 P1 任务 2「录制回放产品化」）：

- `http.yaml`   LLM 请求-响应对，按请求指纹存储（回放匹配用）
- `trace.json`  结构化 span（简化 OTel GenAI：llm / tool / retrieval）
- `tool_io.log` 工具输入输出（JSON Lines，逐行一条）

设计原则：
- 三类产物统一由 RecordingSession 采集，`save()` 一次落盘到
  `recordings/<run_id>/` 目录，保证一个 run 的自洽性。
- 反序列化函数与序列化严格对称，回放时据此重放、不依赖真实调用。
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path

import yaml

from .fingerprint import fingerprint

SCHEMA_VERSION = "1.0"


class RecordingSession:
    """采集一次录制的三类产物（内存中），`save()` 落盘。"""

    def __init__(self, run_id: str | None = None):
        self.run_id = run_id or uuid.uuid4().hex
        # fp -> {"request": {...}, "response": {...}}（body 存原始字符串）
        self.http_records: dict[str, dict] = {}
        self.spans: list[dict] = []
        self.tool_io: list[dict] = []

    # ---- 采集 ----

    def add_http(
        self,
        method: str,
        host: str,
        path: str,
        body: bytes,
        status: int,
        resp_body: bytes,
    ) -> str:
        """记录一条 LLM HTTP 请求-响应对，返回其指纹。"""
        fp = fingerprint(method, host, path, body)
        self.http_records[fp] = {
            "request": {
                "method": method,
                "host": host,
                "path": path,
                "body": body.decode("utf-8", errors="replace"),
            },
            "response": {
                "status": status,
                "body": resp_body.decode("utf-8", errors="replace"),
            },
        }
        return fp

    def add_span(
        self,
        name: str,
        kind: str,
        start_ms: float,
        duration_ms: float,
        parent_id: str | None = None,
        **attributes,
    ) -> str:
        """记录一个结构化 span，返回其 id。"""
        span_id = f"span-{len(self.spans) + 1}"
        self.spans.append(
            {
                "id": span_id,
                "parent_id": parent_id,
                "name": name,
                "kind": kind,
                "start_ms": start_ms,
                "duration_ms": duration_ms,
                "attributes": attributes,
            }
        )
        return span_id

    def add_tool_io(
        self,
        tool: str,
        input_: dict,
        output,
        ok: bool,
        latency_ms: float,
    ) -> None:
        """记录一条工具输入输出。"""
        self.tool_io.append(
            {
                "tool": tool,
                "input": input_,
                "output": output,
                "ok": ok,
                "latency_ms": latency_ms,
            }
        )

    # ---- 落盘 ----

    def save(self, out_dir: Path) -> "RecordedRun":
        """把三类产物写入 out_dir，返回产物路径集合。"""
        out_dir = Path(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)

        http_path = out_dir / "http.yaml"
        trace_path = out_dir / "trace.json"
        tool_io_path = out_dir / "tool_io.log"

        write_http_yaml(http_path, self.http_records)
        write_trace_json(trace_path, self.run_id, self.spans)
        write_tool_io(tool_io_path, self.tool_io)

        return RecordedRun(
            run_id=self.run_id,
            http_path=http_path,
            trace_path=trace_path,
            tool_io_path=tool_io_path,
        )


class RecordedRun:
    """一次录制落盘后的产物路径集合（回放入口）。"""

    def __init__(
        self,
        run_id: str,
        http_path: Path,
        trace_path: Path,
        tool_io_path: Path,
    ):
        self.run_id = run_id
        self.http_path = http_path
        self.trace_path = trace_path
        self.tool_io_path = tool_io_path


# ---- 序列化 / 反序列化（严格对称）----


def write_http_yaml(path: Path, records: dict[str, dict]) -> None:
    payload = {"schema": SCHEMA_VERSION, "records": records}
    path.write_text(
        yaml.safe_dump(payload, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )


def read_http_yaml(path: Path) -> dict[str, dict]:
    payload = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} 不是合法 http.yaml（顶层非对象）")
    records = payload.get("records", {})
    if not isinstance(records, dict):
        raise ValueError(f"{path} 缺 records 字段")
    return records


def write_trace_json(path: Path, run_id: str, spans: list[dict]) -> None:
    payload = {"schema": SCHEMA_VERSION, "run_id": run_id, "spans": spans}
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def read_trace_json(path: Path) -> dict:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if "spans" not in payload:
        raise ValueError(f"{path} 缺 spans 字段")
    return payload


def write_tool_io(path: Path, tool_io: list[dict]) -> None:
    lines = [json.dumps(rec, ensure_ascii=False) for rec in tool_io]
    path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def read_tool_io(path: Path) -> list[dict]:
    text = Path(path).read_text(encoding="utf-8")
    if not text.strip():
        return []
    return [json.loads(line) for line in text.splitlines() if line.strip()]
