"""Tool Agent：依赖外部 HTTP API + SQLite 数据库 + 文件写入 + LLM 的示例 Agent。

用于 P2 端到端验收：录制时真实执行外部依赖并记录，回放时用桩替换、
无副作用、结果确定。外部依赖统一经 MockRegistry 访问，模式由环境变量决定：

- CEG_MOCK_MODE = record：真实执行并记录
- CEG_MOCK_MODE = replay：从 deps.yaml 载入桩，不触网、无副作用

环境变量：
- CEG_DEPS_DIR    录制产物目录（deps.yaml 落盘/读取位置）
- CEG_SANDBOX     文件沙箱目录
- CEG_EXTERNAL_API 外部搜索 API 地址
- LLM_URL         LLM 端点（录制代理或回放 mock）
"""
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from python.replay.mock import MockRegistry  # noqa: E402

MODE = os.environ.get("CEG_MOCK_MODE", "record")
DEPS_DIR = Path(os.environ.get("CEG_DEPS_DIR", str(ROOT / "recordings" / "tool-agent")))
SANDBOX = Path(os.environ.get("CEG_SANDBOX", str(DEPS_DIR / "sandbox")))
LLM_URL = os.environ.get("LLM_URL", "http://127.0.0.1:8000/v1/chat/completions")
EXTERNAL_API = os.environ.get("CEG_EXTERNAL_API", "http://127.0.0.1:9001/search")


def call_llm(prompt: str) -> str:
    body = json.dumps(
        {"model": "fake", "messages": [{"role": "user", "content": prompt}]}
    ).encode("utf-8")
    req = urllib.request.Request(
        LLM_URL, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"]


def run(reg: MockRegistry) -> dict:
    # 1. 数据库（知识库查询）
    reg.db.execute("CREATE TABLE IF NOT EXISTS docs (id INTEGER PRIMARY KEY, content TEXT)")
    reg.db.execute("INSERT INTO docs (content) VALUES ('RAG 是检索增强生成')")
    rows = reg.db.execute("SELECT content FROM docs WHERE id = ?", (1,))
    doc = rows[0][0]

    # 2. 外部搜索 API
    api_resp = reg.http.fetch(EXTERNAL_API + "?q=rag", method="GET")
    api_text = api_resp.decode("utf-8")

    # 3. 文件写入（缓存结果）
    reg.files.write_text("cache/result.txt", f"doc={doc}; api={api_text}")

    # 4. LLM 生成最终答案
    answer = call_llm(f"请根据资料回答：{doc}")

    return {"doc": doc, "api": api_text, "answer": answer}


def main():
    if MODE == "replay":
        reg = MockRegistry.load(DEPS_DIR, sandbox_dir=SANDBOX)
    else:
        reg = MockRegistry(mode="record", sandbox_dir=SANDBOX)

    result = run(reg)

    if MODE == "record":
        reg.save(DEPS_DIR)

    sys.stdout.write(json.dumps({"type": "trace", **result}) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
