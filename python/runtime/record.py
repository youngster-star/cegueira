"""录制编排：跑一次用户 Agent，把协议回传落成录制三件套 + manifest.json。

## 它补齐的缺口

`RecordingSession` 有写入方法、`protocol.py` 能发射 span / tool_io，但**没有
任何代码把两者接起来**——`trace.json` 与 `tool_io.log` 一直没有生产者
（见 python/replay/protocol.py 开头的说明）。本模块就是那个生产者：

    起录制代理 → 注入 CEG_PROTOCOL=1 + LLM_URL → 跑 Agent
    → 读 stdout 协议行 → RecordingSession 采集
    → save() 落三件套 → build_manifest() 落 manifest.json

## stdout 的三类行（同一根管道）

    {"type": "span",    ...}   协议：一个 span（ossia TraceCollector.end）
    {"type": "tool_io", ...}   协议：一次工具调用（agent 或 dep）
    {"type": "trace",   ...}   Agent 自己的最终输出（既有约定，含 final_answer）

按 `type` 分派。**其余行被收集但不参与采集**——用户的 Agent 可能顺带打印
别的，把一条无关输出当成致命错误过于苛刻；但它们会被记进 `stdout_noise`
返回给调用方，以便 `ceg doctor` 提示「你的 Agent 往 stdout 写了非协议内容」。

## 为什么要并发读 stderr

子进程 stdout 与 stderr 都是管道。若只在最后 `communicate()`，管道缓冲区
（Windows 约 4KB）写满后子进程会被阻塞，表现为「Agent 卡死」。因此 stdout
在主线程逐行读、stderr 在后台线程读，两边同时排空。
"""
from __future__ import annotations

import json
import os
import subprocess
import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from ..replay.manifest import build_manifest, write_manifest
from ..replay.protocol import TYPE_SPAN, TYPE_TOOL_IO, TYPE_TRACE
from ..replay.recorder import DEFAULT_UPSTREAM, serve_recorder
from ..replay.session import SCHEMA_VERSION, RecordingSession
from .ensure import ensure_venv, venv_python

# 默认 Agent 入口与产出文件名
DEFAULT_ENTRY = "main.py"
RESULT_FILE = "result.json"
# 逐 case 录制的索引文件名与传给 Agent 的约定环境变量
CASES_FILE = "cases.json"
ENV_CASE_ID = "CEG_CASE_ID"
ENV_CASE_PROMPT = "CEG_CASE_PROMPT"


class RecordError(RuntimeError):
    """录制失败（Agent 非零退出 / 超时）。

    独立类型便于 CLI 区分「用户的 Agent 挂了」（用户该看 stderr）与
    「录制框架自身出错」（我们的 bug）。
    """


@dataclass
class RecordResult:
    """一次录制的产出摘要。"""

    run_id: str
    run_dir: Path
    result: dict | None
    returncode: int
    stderr: str
    stdout_noise: list[str] = field(default_factory=list)
    span_count: int = 0
    tool_io_count: int = 0
    http_count: int = 0


def repo_root() -> Path:
    """本仓根目录（含 `python` 包）。`python/runtime/record.py` 向上两级。"""
    return Path(__file__).resolve().parents[2]


def build_child_env(
    env: dict[str, str] | None,
    *,
    llm_url: str,
    root: Path | None = None,
    base: dict[str, str] | None = None,
) -> dict[str, str]:
    """组装 Agent 子进程的环境变量。

    ## 为什么必须注入 PYTHONPATH

    用户 Agent 跑在自己的**隔离 venv** 里，而 `python.otel` / `python.replay.protocol`
    是本仓提供的**埋点脚手架**，并不在用户 venv 里。把仓库根塞进 PYTHONPATH，
    才能让 `import python.otel` 在用户 venv 中可见——这是「Agent 能发出 trace」
    的前提（PRD §6.2 可观测性硬性契约）。

    拼在**已有 PYTHONPATH 之前**：仓库根优先，避免用户的同名目录遮蔽脚手架。

    `CEG_PROTOCOL` / `LLM_URL` 由录制框架**强制**写入，调用方 `env` 不可覆盖——
    否则一句 `CEG_PROTOCOL=0` 就能让录制静默地没有产物。
    """
    root = root if root is not None else repo_root()
    child = dict(base if base is not None else os.environ)
    child.setdefault("PYTHONIOENCODING", "utf-8")

    existing = child.get("PYTHONPATH")
    child["PYTHONPATH"] = str(root) + (os.pathsep + existing if existing else "")

    child.update(env or {})
    child["CEG_PROTOCOL"] = "1"
    child["LLM_URL"] = llm_url
    return child


def _resolve_python(agent_dir: Path, python: str | os.PathLike | None) -> str:
    """确定运行 Agent 的 Python 可执行文件。

    缺省按产品设计走「每个 Agent 独立 venv」；测试可传 `sys.executable`
    跳过 venv 创建（agent 只需能 import 本仓的 python 包）。
    """
    if python is not None:
        return str(python)
    vdir = ensure_venv(agent_dir)
    return str(venv_python(vdir))


def _parse_stdout_line(
    line: str,
    session: RecordingSession,
    state: dict,
) -> None:
    """处理一行 stdout：分派协议记录，或记为最终结果 / 噪声。

    `state` 里累积 `result`（最后一次 trace 行）与 `noise`。
    """
    text = line.strip()
    if not text:
        return

    try:
        record = json.loads(text)
    except json.JSONDecodeError:
        state["noise"].append(text)
        return

    if not isinstance(record, dict):
        state["noise"].append(text)
        return

    kind = record.get("type")
    if kind == TYPE_SPAN:
        # 透传协议里的 span id：嵌套时子 span 先结束先入列，重新顺位分配会
        # 让 parent_id 指向错误对象（见 RecordingSession.add_span 的说明）。
        attrs = record.get("attributes") or {}
        if not isinstance(attrs, dict):
            attrs = {}
        session.add_span(
            name=record.get("name"),
            kind=record.get("kind"),
            start_ms=record.get("start_ms"),
            duration_ms=record.get("duration_ms"),
            parent_id=record.get("parent_id"),
            span_id=record.get("id"),
            **attrs,
        )
    elif kind == TYPE_TOOL_IO:
        session.add_tool_io(
            tool=record.get("tool"),
            input_=record.get("input") or {},
            output=record.get("output"),
            ok=record.get("ok"),
            latency_ms=record.get("latency_ms"),
            source=record.get("source", "agent"),
        )
    elif kind == TYPE_TRACE:
        # Agent 的最终输出。保留**最后一条**（多轮时以收尾为准）。
        state["result"] = record
    else:
        # 无 type 或未知 type：不属于协议，也不属于收尾行。
        state["noise"].append(text)


def record_agent(
    agent_dir: str | os.PathLike,
    run_dir: str | os.PathLike,
    *,
    entry: str = DEFAULT_ENTRY,
    upstream: str = DEFAULT_UPSTREAM,
    python: str | os.PathLike | None = None,
    env: dict[str, str] | None = None,
    run_id: str | None = None,
    timeout: float = 120.0,
) -> RecordResult:
    """跑一次 Agent 并把录制三件套 + manifest.json 落盘到 run_dir。

    参数:
        agent_dir: 用户 Agent 项目目录。
        run_dir: 录制产物输出目录（不存在则创建）。
        entry: 入口文件（相对 agent_dir）。
        upstream: 录制代理转发到的真实 LLM 上游基址。
        python: 运行 Agent 的 Python；缺省用 agent_dir 的独立 venv。
        env: 额外注入的环境变量（如 CEG_MOCK_MODE / CEG_DEPS_DIR）。
        run_id: 指定 run id；缺省随机。
        timeout: 子进程超时秒数。

    返回:
        RecordResult。

    异常:
        RecordError: Agent 非零退出或超时。
    """
    agent_dir = Path(agent_dir).resolve()
    run_dir = Path(run_dir).resolve()
    run_dir.mkdir(parents=True, exist_ok=True)

    session = RecordingSession(run_id=run_id)
    server, _thread = serve_recorder(
        port=0, recording_session=session, upstream=upstream
    )
    proxy_port = server.server_address[1]
    llm_url = f"http://127.0.0.1:{proxy_port}/v1/chat/completions"

    try:
        exe = _resolve_python(agent_dir, python)
        child_env = build_child_env(env, llm_url=llm_url)

        proc = subprocess.Popen(
            [exe, entry],
            cwd=str(agent_dir),
            env=child_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
        )

        stderr_lines: list[str] = []

        def _drain_stderr() -> None:
            assert proc.stderr is not None
            for line in proc.stderr:
                stderr_lines.append(line)

        stderr_thread = threading.Thread(target=_drain_stderr, daemon=True)
        stderr_thread.start()

        state: dict = {"result": None, "noise": []}
        assert proc.stdout is not None
        for line in proc.stdout:
            _parse_stdout_line(line, session, state)

        try:
            returncode = proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
            raise RecordError(f"Agent 超时（>{timeout}s）：{agent_dir}")

        stderr_thread.join(timeout=5.0)
        stderr_text = "".join(stderr_lines)

        if returncode != 0:
            tail = stderr_text.strip().splitlines()[-10:]
            raise RecordError(
                f"Agent 退出码 {returncode}；stderr 末尾：\n" + "\n".join(tail)
            )

        # 落三件套 + result.json（TS 加载器用）+ manifest.json（桌面端用）
        session.save(run_dir)
        result = state["result"]
        (run_dir / RESULT_FILE).write_text(
            "" if result is None else json.dumps(result, ensure_ascii=False),
            encoding="utf-8",
        )

        manifest = build_manifest(
            session.run_id,
            session.http_records,
            session.spans,
            session.tool_io,
            result,
        )
        write_manifest(run_dir / "manifest.json", manifest)

        return RecordResult(
            run_id=session.run_id,
            run_dir=run_dir,
            result=result,
            returncode=returncode,
            stderr=stderr_text,
            stdout_noise=state["noise"],
            span_count=len(session.spans),
            tool_io_count=len(session.tool_io),
            http_count=len(session.http_records),
        )
    finally:
        server.shutdown()


# ---------------------------------------------------------------------------
# 逐 case 录制（P2 防作弊「留出集」防线的数据来源）
# ---------------------------------------------------------------------------


@dataclass
class CaseRecord:
    """单个 evalset case 的录制结果摘要。"""

    id: str
    status: str  # "ok" | "failed"
    result: dict | None = None
    error: str | None = None


def load_evalset(path: str | os.PathLike) -> list[dict]:
    """读取 evalset.json，返回 `[{"id", "prompt"}]`。

    只依赖 id 与 prompt 两个字段——它们是「逐 case 运行」与「改写/硬编码检测」
    的最小必需信息，其余（expected_outcome / 引用断言）由评分层消费。
    """
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    tests = payload.get("tests") if isinstance(payload, dict) else None
    if not isinstance(tests, list) or not tests:
        raise RecordError("evalset 需含非空 tests 数组")
    cases: list[dict] = []
    for i, t in enumerate(tests):
        if not isinstance(t, dict):
            raise RecordError(f"evalset.tests[{i}] 应为对象")
        cid = t.get("id")
        prompt = t.get("prompt")
        if not isinstance(cid, str) or not isinstance(prompt, str):
            raise RecordError(f"evalset.tests[{i}] 需含字符串 id 与 prompt")
        cases.append({"id": cid, "prompt": prompt})
    return cases


def record_cases(
    agent_dir: str | os.PathLike,
    out_dir: str | os.PathLike,
    cases: list[dict],
    *,
    entry: str = DEFAULT_ENTRY,
    upstream: str = DEFAULT_UPSTREAM,
    python: str | os.PathLike | None = None,
    env: dict[str, str] | None = None,
    run_id: str | None = None,
    timeout: float = 120.0,
) -> dict:
    """按 evalset 逐 case 运行 Agent，每 case 一份三件套，并落 `cases.json` 索引。

    ## 为什么必须逐 case

    防作弊第一道防线「留出集完整性」要判断**哪些 case 真的跑了**。单次录制只有
    一份 trace，无从得知覆盖了哪些 case；只有逐 case 运行并记录，`ran_case_ids`
    才是观测事实而非自报（这与 facts.py「绝不接受 Agent 自报数值」同源）。

    ## case 输入如何传给 Agent

    通过环境变量 `CEG_CASE_ID` / `CEG_CASE_PROMPT` 注入（Agent 子进程无法从
    协议里取输入——协议是**输出**方向）。读取该变量的 Agent 即天然支持逐 case；
    不读取的 Agent 会对每个 case 产出相同结果，索引仍如实记录。

    ## 单个 case 失败不中断整体

    Agent 在某个 case 上挂掉是常见情况（健壮性不足）。把它记为 `status=failed`
    并继续跑其余 case，`ran_case_ids` 只收 `ok` 的——于是「某 case 没跑成」会
    如实表现为留出集缺失，而不是把整次录制作废。
    """
    out_dir = Path(out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    run_id = run_id or uuid.uuid4().hex

    records: list[CaseRecord] = []
    for case in cases:
        case_dir = out_dir / case["id"]
        case_env = dict(env or {})
        case_env[ENV_CASE_ID] = case["id"]
        case_env[ENV_CASE_PROMPT] = case["prompt"]
        try:
            res = record_agent(
                agent_dir,
                case_dir,
                entry=entry,
                upstream=upstream,
                python=python,
                env=case_env,
                run_id=f"{run_id}-{case['id']}",
                timeout=timeout,
            )
            records.append(CaseRecord(id=case["id"], status="ok", result=res.result))
        except RecordError as e:
            records.append(CaseRecord(id=case["id"], status="failed", error=str(e)))

    index = {
        "schema": SCHEMA_VERSION,
        "run_id": run_id,
        "cases": [
            {
                "id": r.id,
                "status": r.status,
                "dir": r.id,  # 相对 out_dir 的子目录名
                **({"error": r.error} if r.error else {}),
            }
            for r in records
        ],
        "ran_case_ids": [r.id for r in records if r.status == "ok"],
    }
    (out_dir / CASES_FILE).write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return index
