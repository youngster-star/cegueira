"""最小 Echo Agent：调用 LLM，把轨迹输出为 JSON Lines。"""
import json
import os
import sys
import urllib.request


def call_llm(llm_url: str, prompt: str) -> str:
    body = json.dumps({
        "model": "fake",
        "messages": [{"role": "user", "content": prompt}],
    }).encode("utf-8")
    req = urllib.request.Request(
        llm_url, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"]


def main():
    prompt = sys.argv[1] if len(sys.argv) > 1 else "hello"
    llm_url = os.environ.get("LLM_URL", "http://127.0.0.1:8000/v1/chat/completions")
    answer = call_llm(llm_url, prompt)
    sys.stdout.write(json.dumps({"type": "trace", "prompt": prompt, "answer": answer}) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
