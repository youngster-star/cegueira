"""`python -m python.runtime.cli`：运行时侧的录制入口（供 ceg CLI / sidecar 调起）。

## 为什么放在 Python 侧

录制必须**同时**拥有：录制代理进程、Agent 子进程、以及协议行的读端。这三者
都在 Python 域，把编排放这里可以避免 Node 侧再实现一遍「注入 env + 读协议行 +
落三件套」。Node/sidecar 只需 `spawn` 本模块并透传参数。

用法::

    python -m python.runtime.cli record --agent <dir> --out <run_dir> \
        [--entry main.py] [--upstream http://host:port] [--python <exe>] [--timeout 120]

成功时打印一行 JSON 摘要（便于 Node 侧解析），失败时走 stderr 且退出码非 0。
"""
from __future__ import annotations

import argparse
import json
import sys

from ..replay.recorder import DEFAULT_UPSTREAM
from .record import RecordError, load_evalset, record_agent, record_cases


def _cmd_record(args: argparse.Namespace) -> int:
    # 逐 case 模式：按 evalset 逐条运行，落 cases.json 索引。
    if args.evalset:
        try:
            cases = load_evalset(args.evalset)
            index = record_cases(
                agent_dir=args.agent,
                out_dir=args.out,
                cases=cases,
                entry=args.entry,
                upstream=args.upstream,
                python=args.python,
                timeout=args.timeout,
            )
        except RecordError as e:
            print(f"[record] 失败：{e}", file=sys.stderr)
            return 1
        failed = [c["id"] for c in index["cases"] if c["status"] != "ok"]
        summary = {
            "run_id": index["run_id"],
            "run_dir": str(args.out),
            "cases": len(index["cases"]),
            "ran_case_ids": index["ran_case_ids"],
            "failed_case_ids": failed,
        }
        print(json.dumps(summary, ensure_ascii=False))
        return 0

    try:
        res = record_agent(
            agent_dir=args.agent,
            run_dir=args.out,
            entry=args.entry,
            upstream=args.upstream,
            python=args.python,
            timeout=args.timeout,
        )
    except RecordError as e:
        print(f"[record] 失败：{e}", file=sys.stderr)
        return 1

    summary = {
        "run_id": res.run_id,
        "run_dir": str(res.run_dir),
        "spans": res.span_count,
        "tool_io": res.tool_io_count,
        "http": res.http_count,
        "has_result": res.result is not None,
    }
    if res.stdout_noise:
        # 只提示，不失败：用户 Agent 往 stdout 写了非协议内容。
        summary["stdout_noise"] = len(res.stdout_noise)
        print(
            f"[record] 警告：stdout 有 {len(res.stdout_noise)} 行非协议内容，"
            "已忽略（日志应写 stderr）",
            file=sys.stderr,
        )
    print(json.dumps(summary, ensure_ascii=False))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m python.runtime.cli")
    sub = parser.add_subparsers(dest="command", required=True)

    rec = sub.add_parser("record", help="跑一次 Agent 并落录制三件套 + manifest.json")
    rec.add_argument("--agent", required=True, help="用户 Agent 项目目录")
    rec.add_argument("--out", required=True, help="录制产物输出目录")
    rec.add_argument("--entry", default="main.py", help="入口文件（相对 --agent）")
    rec.add_argument("--upstream", default=DEFAULT_UPSTREAM, help="真实 LLM 上游基址")
    rec.add_argument("--python", default=None, help="运行 Agent 的 Python（缺省用独立 venv）")
    rec.add_argument("--timeout", type=float, default=120.0, help="子进程超时秒数")
    rec.add_argument(
        "--evalset",
        default=None,
        help="evalset.json 路径；提供则按 case 逐条录制，产出 cases.json 索引",
    )
    rec.set_defaults(func=_cmd_record)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
