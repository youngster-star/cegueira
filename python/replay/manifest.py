"""manifest.json：把录制三件套归一化成 TS `AgentTrace` 的形状（A2）。

## 为什么需要它

桌面端跑在 WebView 里，**没有 `node:fs`**，而且 `yaml` 没有声明
`sideEffects: false`，打包器不敢摇树——把 YAML 解析器塞进前端包并不划算。
所以 Python 在录制目录里额外写一份 `manifest.json`，其中 `trace` 字段
**已经是 `packages/trace/src/types.ts` 里 `AgentTrace` 的形状**，
桌面端只需读这一个 JSON 文件。

## 与 TS 侧的关系：两份实现、一份真相

同一份归一化逻辑存在两处：

- 本模块（Python，录制时组装 manifest.json）
- `packages/trace/src/load.ts` 的 `parseRecording`（TS，纯函数，CLI 与测试用）

两份实现必然有漂移风险，因此 `tests/test_manifest.py` 里有一条**往返断言**：
让 Node 调 `parseRecording` 解析同一份三件套，结果必须与本文写出的
`manifest.trace` 深度相等。**漂移因此变成可检测的测试失败，而不是两种静默
共存的真相**——这与 docs/常见错误与坑.md §2「未命中一律报错，绝不降级」同源。

## 归一化规则（必须与 load.ts 逐条对应）

- `http.yaml` 的 records 是「指纹 → 记录」的字典，输出**按指纹排序**的数组。
  排序而非依赖字典顺序：JS 对象键顺序对数字形状的键有特殊规则，排序才确定。
- span 的 `kind` 大小写不敏感（otel 包导出大写常量，但 `add_span` 的 kind
  由调用方传入）。`LLM` → llmSpans，`RETRIEVAL` → retrievals，
  `TOOL`/`CHAIN`/`AGENT`/`INTERNAL` 是结构性子 span，被**有意跳过**
  （工具参数与返回值以 tool_io.log 为准）。**其余 kind 一律报错**——
  静默跳过会让「埋点写错了」表现成「这个 Agent 就是没检索」，是错误归因。
- `final_answer` 是 Agent 自报的（只能如此，没有别的来源）。缺失时
  `finalAnswer` 整个键不出现，而不是编一个空答案——空答案会让
  `answer_has_citation` 恒假、`cited_doc_ids ⊆ retrieval_doc_ids` 恒真
  （空集是任何集合的子集），两种结果都误导评分。
"""
from __future__ import annotations

import json
from pathlib import Path

SCHEMA_VERSION = "1.0"

# 需要映射为轨迹数据的 span kind
_MAPPED_KINDS = ("LLM", "RETRIEVAL")
# 已知且有意忽略的结构性 kind（工具数据以 tool_io.log 为准）
_IGNORED_KINDS = ("TOOL", "CHAIN", "AGENT", "INTERNAL")


class ManifestError(ValueError):
    """录制产物无法归一化时的错误。

    独立类型便于 CLI 区分「产物读不了」（用户该重新录制）与「我们的 bug」。
    """


def _require(cond: bool, detail: str) -> None:
    if not cond:
        raise ManifestError(detail)


def _str(value, what: str) -> str:
    _require(isinstance(value, str), f"{what} 应为字符串，实际 {type(value).__name__}")
    return value


def _num(value, what: str) -> float:
    _require(
        isinstance(value, (int, float)) and not isinstance(value, bool),
        f"{what} 应为数字，实际 {type(value).__name__}",
    )
    return value


def _bool(value, what: str) -> bool:
    _require(isinstance(value, bool), f"{what} 应为布尔值，实际 {type(value).__name__}")
    return value


def _str_list(value, what: str) -> list:
    _require(isinstance(value, list), f"{what} 应为数组，实际 {type(value).__name__}")
    return [_str(x, f"{what}[{i}]") for i, x in enumerate(value)]


def _obj(value, what: str) -> dict:
    _require(isinstance(value, dict), f"{what} 应为对象，实际 {type(value).__name__}")
    return value


# ---------------------------------------------------------------------------
# http.yaml
# ---------------------------------------------------------------------------


def _http_exchanges(records: dict) -> list:
    """records（指纹 → 记录）→ 按指纹排序的 HttpExchange 数组。"""
    _require(isinstance(records, dict), "http records 应为对象")
    out = []
    for fp in sorted(records):
        rec = _obj(records[fp], f"records[{fp}]")
        req = _obj(rec.get("request"), f"records[{fp}].request")
        resp = _obj(rec.get("response"), f"records[{fp}].response")

        request = {
            "method": _str(req.get("method"), f"records[{fp}].request.method"),
            "path": _str(req.get("path"), f"records[{fp}].request.path"),
            "body": _str(req.get("body"), f"records[{fp}].request.body"),
        }
        # 旧版扁平录制（recorder.Recording）没有 host，如实留空而不是编占位值
        if req.get("host") is not None:
            request["host"] = _str(req["host"], f"records[{fp}].request.host")

        out.append(
            {
                "fingerprint": fp,
                "request": request,
                "response": {
                    "status": _num(resp.get("status"), f"records[{fp}].response.status"),
                    "body": _str(resp.get("body"), f"records[{fp}].response.body"),
                },
            }
        )
    return out


# ---------------------------------------------------------------------------
# trace.json spans
# ---------------------------------------------------------------------------


def _spans_to_trace(spans: list) -> tuple:
    """spans → (llmSpans, retrievals, ignored_count)。"""
    _require(isinstance(spans, list), "spans 应为数组")
    llm_spans = []
    retrievals = []
    ignored = 0

    for i, entry in enumerate(spans):
        where = f"spans[{i}]"
        s = _obj(entry, where)
        span_id = _str(s.get("id"), f"{where}.id")
        # 大小写不敏感：otel 导出大写常量，但 add_span 的 kind 由调用方传入
        kind = _str(s.get("kind"), f"{where}.kind").upper()
        duration_ms = _num(s.get("duration_ms"), f"{where}.duration_ms")
        attrs = s.get("attributes") or {}
        _require(isinstance(attrs, dict), f"{where}.attributes 应为对象")

        if kind in _IGNORED_KINDS:
            ignored += 1
            continue

        if kind not in _MAPPED_KINDS:
            raise ManifestError(
                f"{where}.kind 为未知的 {s.get('kind')!r}；"
                f"可识别 {' / '.join(_MAPPED_KINDS + _IGNORED_KINDS)}"
            )

        if kind == "LLM":
            # token 用量缺失记 0：无法凭空推断，0 表示「未知」而非「零消耗」。
            # 该值不参与任何评分门控，只用于展示。
            prompt = attrs.get("prompt_tokens")
            completion = attrs.get("completion_tokens")
            llm_spans.append(
                {
                    "id": span_id,
                    "promptTokens": 0 if prompt is None else _num(prompt, f"{where}.attributes.prompt_tokens"),
                    "completionTokens": 0 if completion is None else _num(completion, f"{where}.attributes.completion_tokens"),
                    "latencyMs": duration_ms,
                }
            )
            continue

        # RETRIEVAL：query 与 returned_doc_ids 是 S_outcome 的 doc_count /
        # retrieval_hit_rate 与「引用忠于检索」断言的唯一依据，缺一不可。
        if attrs.get("query") is None:
            raise ManifestError(f"{where} 是 RETRIEVAL span，但 attributes 缺 query")
        if attrs.get("returned_doc_ids") is None:
            raise ManifestError(f"{where} 是 RETRIEVAL span，但 attributes 缺 returned_doc_ids")
        call = {
            "id": span_id,
            "query": _str(attrs["query"], f"{where}.attributes.query"),
            "returnedDocIds": _str_list(
                attrs["returned_doc_ids"], f"{where}.attributes.returned_doc_ids"
            ),
        }
        # 可选：命中文档正文（供 answer.text 数据流断言）。缺省不加键，
        # 保持与 load.ts 的键集一致（往返断言依赖）。
        docs = attrs.get("returned_docs")
        if docs is not None:
            _require(
                isinstance(docs, list), f"{where}.attributes.returned_docs 应为数组"
            )
            call["returnedDocs"] = [
                {
                    "id": _str(
                        _obj(d, f"{where}.attributes.returned_docs[{j}]").get("id"),
                        f"{where}.attributes.returned_docs[{j}].id",
                    ),
                    "text": _str(
                        _obj(d, f"{where}.attributes.returned_docs[{j}]").get("text"),
                        f"{where}.attributes.returned_docs[{j}].text",
                    ),
                }
                for j, d in enumerate(docs)
            ]
        retrievals.append(call)

    return llm_spans, retrievals, ignored


# ---------------------------------------------------------------------------
# tool_io.log
# ---------------------------------------------------------------------------


SOURCE_AGENT = "agent"
SOURCE_DEP = "dep"


def _tool_calls(tool_io: list) -> list:
    """tool_io 条目 → ToolCall 数组（id 由**过滤后**的序号决定）。

    `source="dep"` 的外部依赖调用被过滤掉——计量单位不对（一次 `retrieve()`
    内部可能打 3 个外部调用，而用户眼里那是一步），且契约里 `tool_call_in`
    写的是 Agent 级工具名，永远匹配不到 `db.execute`。
    过滤规则必须与 load.ts 的 parseToolIoLog 逐条一致，由往返断言保证。
    """
    _require(isinstance(tool_io, list), "tool_io 应为数组")
    out = []
    for i, entry in enumerate(tool_io):
        where = f"tool_io[{i}]"
        rec = _obj(entry, where)

        # 缺省按 Agent 工具处理：旧版产物没有 source 字段
        source = rec.get("source", SOURCE_AGENT)
        _require(source in (SOURCE_AGENT, SOURCE_DEP), f"{where}.source 为未知值 {source!r}；可识别 agent / dep")
        if source == SOURCE_DEP:
            continue

        args = rec.get("input") or {}
        out.append(
            {
                "id": f"tool-{len(out) + 1}",
                "name": _str(rec.get("tool"), f"{where}.tool"),
                "args": _obj(args, f"{where}.input"),
                "result": rec.get("output"),
                "ok": _bool(rec.get("ok"), f"{where}.ok"),
                "latencyMs": _num(rec.get("latency_ms"), f"{where}.latency_ms"),
            }
        )
    return out


# ---------------------------------------------------------------------------
# final_answer
# ---------------------------------------------------------------------------


def final_answer_of(result: dict | None):
    """从 Agent 的 stdout trace 行提取 FinalAnswer；没有则返回 None。"""
    if result is None:
        return None
    fa = result.get("final_answer")
    if fa is None:
        return None
    fa = _obj(fa, "final_answer")
    return {
        "text": _str(fa.get("text"), "final_answer.text"),
        "citedDocIds": _str_list(fa.get("cited_doc_ids") or [], "final_answer.cited_doc_ids"),
    }


# ---------------------------------------------------------------------------
# 组装 / 落盘
# ---------------------------------------------------------------------------


def build_trace(http_records: dict, spans: list, tool_io: list, result: dict | None = None) -> dict:
    """三件套的内存表示 → TS `AgentTrace` 形状的字典。"""
    llm_spans, retrievals, _ignored = _spans_to_trace(spans)
    trace = {
        "http": _http_exchanges(http_records),
        "tools": _tool_calls(tool_io),
        "llmSpans": llm_spans,
        "retrievals": retrievals,
    }
    fa = final_answer_of(result)
    if fa is not None:
        trace["finalAnswer"] = fa
    return trace


def build_manifest(
    run_id: str,
    http_records: dict,
    spans: list,
    tool_io: list,
    result: dict | None = None,
) -> dict:
    """组装完整 manifest（含 schema 与 run_id）。"""
    # 保留 JSON Lines 协议约定的键序，便于人读
    return {
        "schema": SCHEMA_VERSION,
        "run_id": run_id,
        "trace": build_trace(http_records, spans, tool_io, result),
    }


def write_manifest(path, manifest: dict) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def read_manifest(path) -> dict:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if "trace" not in payload:
        raise ManifestError(f"{path} 缺 trace 字段")
    return payload
