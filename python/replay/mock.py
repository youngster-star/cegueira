"""工具 mock 框架（P2 任务 1）：MockHttp / MockDB / MockFile + 统一注册表。

目标：契约声明的外部依赖在回放时替换为桩，回放环境强制断网、未命中即报错，
保证「含外部依赖的 Agent 可无副作用、确定性地回放」（见 docs/stages/P2-工具调用.md）。

设计原则：
- 桩对象带 `mode`（"record" | "replay"）：录制时真实执行并记录，回放时用记录
  替换且**绝不触真实 IO**（未命中即抛 MockMissError，而非静默降级）。
- 统一由 MockRegistry 管理，`save()` / `load()` 与录制产物同目录落盘（deps.yaml）。
"""
from __future__ import annotations

import json
import sqlite3
import threading
import urllib.request
import urllib.parse
from pathlib import Path

import yaml

from . import protocol
from .fingerprint import fingerprint

SCHEMA_VERSION = "1.0"
DEPS_FILENAME = "deps.yaml"


class MockMissError(RuntimeError):
    """回放时未命中录制记录（确定性要求：宁可失败，不可静默放行）。"""


def _is_read(sql: str) -> bool:
    head = sql.lstrip().upper()
    return head.startswith(("SELECT", "PRAGMA", "WITH"))


def _is_ddl(sql: str) -> bool:
    head = sql.lstrip().upper()
    return head.startswith(("CREATE", "DROP", "ALTER"))


def _sql_fp(sql: str, params) -> str:
    # dict 型命名参数必须按「键+值」序列化：`list(params)` 只取键，
    # 会让 {a:1} 与 {a:2} 得到同一指纹（回放静默错配）。
    if isinstance(params, dict):
        params_repr = json.dumps(params, sort_keys=True, ensure_ascii=False, default=str)
    else:
        params_repr = json.dumps(list(params), ensure_ascii=False, default=str)
    raw = f"{sql}\x00{params_repr}"
    import hashlib

    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class MockHttp:
    """外部 HTTP 依赖桩（非 LLM 域名的普通 API）。

    录制：`fetch()` 真实请求并记录响应；回放：`fetch()` 返回录制响应，未命中抛错。
    """

    def __init__(self, mode: str = "record"):
        if mode not in ("record", "replay"):
            raise ValueError(f"非法 mode: {mode}")
        self.mode = mode
        self._records: dict[str, dict] = {}

    def fetch(
        self,
        url: str,
        body: bytes = b"",
        method: str = "GET",
        headers: dict[str, str] | None = None,
    ) -> bytes:
        """统一入口：录制走真实网络，回放走桩（不触网）。"""
        # source=dep：这是「外部依赖调用」，不是 Agent 声明的工具。
        # 两者必须分开计量——一次 retrieve() 内部可能打 3 个外部调用，
        # 但用户眼里那是一步（见 protocol.py 的说明）。
        with protocol.timed_tool(
            "http.fetch", {"url": url, "method": method.upper()}, source=protocol.SOURCE_DEP
        ) as ctx:
            if self.mode == "record":
                result = self._record(url, body, method, headers)
            else:
                result = self._replay(url, body, method)
            ctx.result = result.decode("utf-8", errors="replace")
            return result

    # ---- 内部 ----

    def _record(self, url, body, method, headers) -> bytes:
        host, path = _split_url(url)
        req = urllib.request.Request(
            url,
            data=body if method.upper() in ("POST", "PUT", "PATCH") else None,
            headers=headers or {},
            method=method.upper(),
        )
        with urllib.request.urlopen(req) as resp:
            resp_body = resp.read()
        fp = fingerprint(method.upper(), host, path, body)
        self._records[fp] = {
            "status": getattr(resp, "status", 200),
            "body": resp_body.decode("utf-8", errors="replace"),
        }
        return resp_body

    def _replay(self, url, body, method) -> bytes:
        host, path = _split_url(url)
        fp = fingerprint(method.upper(), host, path, body)
        rec = self._records.get(fp)
        if rec is None:
            raise MockMissError(
                f"回放未命中外部 HTTP 调用: {method.upper()} {host}{path}"
            )
        return rec["body"].encode("utf-8")

    # ---- 持久化 ----

    def to_dict(self) -> dict:
        return {"records": self._records}

    @classmethod
    def from_dict(cls, data: dict, mode: str = "replay") -> "MockHttp":
        obj = cls(mode=mode)
        obj._records = data.get("records", {})
        return obj


class MockDB:
    """内存 SQLite 数据库桩。

    读查询：录制时真实执行并记录结果，回放时返回录制结果（确定性）。
    写操作：录制/回放均执行到内存库，不触外部数据库，无副作用。
    """

    def __init__(self, mode: str = "record"):
        if mode not in ("record", "replay"):
            raise ValueError(f"非法 mode: {mode}")
        self.mode = mode
        # check_same_thread=False + 显式锁：protocol.py 说明 MockDB 可能被 Agent
        # 的工作线程调用，而 sqlite 连接默认禁止跨线程使用（会抛 ProgrammingError）。
        self._conn = sqlite3.connect(":memory:", check_same_thread=False)
        self._lock = threading.Lock()
        self._recorded: dict[str, list] = {}

    def execute(self, sql: str, params: tuple = ()) -> list[tuple]:
        """统一入口：录制真实执行并记录读结果；回放读结果走桩。"""
        with protocol.timed_tool(
            "db.execute", {"sql": sql, "params": list(params)}, source=protocol.SOURCE_DEP
        ) as ctx:
            with self._lock:
                if self.mode == "record":
                    rows = self._record(sql, params)
                else:
                    rows = self._replay(sql, params)
            ctx.result = {"row_count": len(rows)}
            return rows

    # ---- 内部 ----

    def _record(self, sql, params):
        rows = self._run_real(sql, params)
        if _is_read(sql):
            self._recorded[_sql_fp(sql, params)] = [list(r) for r in rows]
        return rows

    def _replay(self, sql, params):
        if _is_ddl(sql):
            # 回放时重建 schema（内存库），保证后续写操作可执行
            return self._run_real(sql, params)
        if _is_read(sql):
            fp = _sql_fp(sql, params)
            if fp not in self._recorded:
                raise MockMissError(f"回放未命中数据库查询: {sql[:60]}")
            return [tuple(r) for r in self._recorded[fp]]
        # 写操作执行到内存库（隔离，无副作用）
        return self._run_real(sql, params)

    def _run_real(self, sql, params):
        cur = self._conn.execute(sql, params)
        if _is_read(sql):
            return cur.fetchall()
        self._conn.commit()
        return [(cur.rowcount,)]

    # ---- 持久化 ----

    def to_dict(self) -> dict:
        return {"read_queries": self._recorded}

    @classmethod
    def from_dict(cls, data: dict, mode: str = "replay") -> "MockDB":
        obj = cls(mode=mode)
        obj._recorded = data.get("read_queries", {})
        return obj


class MockFile:
    """文件系统沙箱：把写操作重定向到隔离目录，不污染真实文件系统。"""

    def __init__(self, sandbox_dir: Path):
        self._sandbox = Path(sandbox_dir)

    def resolve(self, path: str | Path) -> Path:
        """把任意路径映射到沙箱内（跨平台，防 escape）。

        丢弃根（/ 或 \\）、盘符（含 :）与 `..` / `.`，只保留相对片段，
        统一挂在沙箱目录下。这样 POSIX 绝对路径 /etc/x、Windows 盘符
        C:\\x 均被安全映射到沙箱内，且无法向上逃逸。
        """
        # 除根/盘符/`.`/`..` 外，还须丢弃**含路径分隔符的片段**：Windows 上
        # UNC 路径 `\\server\share\x` 的 parts 首段是 `\\server\share\`，
        # 不含 `:`，会被 joinpath 重新锚定到 UNC 目标从而逃出沙箱。
        safe = [
            part
            for part in Path(path).parts
            if part not in ("/", "\\", ".", "..")
            and ":" not in part
            and "\\" not in part
            and "/" not in part
        ]
        target = self._sandbox.joinpath(*safe) if safe else self._sandbox / "root"
        target.parent.mkdir(parents=True, exist_ok=True)
        return target

    def open(self, path: str | Path, mode: str = "r", *args, **kwargs):
        return open(self.resolve(path), mode, *args, **kwargs)

    def read_text(self, path: str | Path, **kwargs) -> str:
        with protocol.timed_tool(
            "file.read_text", {"path": str(path)}, source=protocol.SOURCE_DEP
        ) as ctx:
            text = self.resolve(path).read_text(encoding="utf-8", **kwargs)
            ctx.result = {"chars": len(text)}
            return text

    def write_text(self, path: str | Path, content: str, **kwargs) -> int:
        with protocol.timed_tool(
            "file.write_text", {"path": str(path)}, source=protocol.SOURCE_DEP
        ) as ctx:
            written = self.resolve(path).write_text(content, encoding="utf-8", **kwargs)
            ctx.result = {"chars": written}
            return written


class MockRegistry:
    """统一 mock 注册表：按契约声明的外部依赖驱动三桩。"""

    def __init__(
        self,
        mode: str = "record",
        sandbox_dir: Path | None = None,
    ):
        self.mode = mode
        self.http = MockHttp(mode=mode)
        self.db = MockDB(mode=mode)
        self.files = MockFile(sandbox_dir or Path(".ceg-sandbox"))

    def save(self, out_dir: Path) -> None:
        payload = {
            "schema": SCHEMA_VERSION,
            "http": self.http.to_dict(),
            "db": self.db.to_dict(),
        }
        Path(out_dir).mkdir(parents=True, exist_ok=True)
        (Path(out_dir) / DEPS_FILENAME).write_text(
            yaml.safe_dump(payload, sort_keys=False, allow_unicode=True),
            encoding="utf-8",
        )

    @classmethod
    def load(cls, out_dir: Path, sandbox_dir: Path | None = None) -> "MockRegistry":
        path = Path(out_dir) / DEPS_FILENAME
        if not path.exists():
            raise MockMissError(f"缺依赖录制文件: {path}")
        payload = yaml.safe_load(path.read_text(encoding="utf-8"))
        reg = cls(mode="replay", sandbox_dir=sandbox_dir)
        reg.http = MockHttp.from_dict(payload.get("http", {}), mode="replay")
        reg.db = MockDB.from_dict(payload.get("db", {}), mode="replay")
        return reg


def _split_url(url: str) -> tuple[str, str]:
    """拆出 (host, path[?query])。

    **query 必须并入 path**：`urlsplit(...).path` 会丢弃查询串，导致
    `?a=1` 与 `?a=2` 得到同一指纹——录制时后者覆盖前者，回放时命中错误响应。
    """
    parsed = urllib.parse.urlsplit(url)
    host = parsed.hostname or ""
    path = parsed.path or "/"
    if parsed.query:
        path = f"{path}?{parsed.query}"
    return host, path
