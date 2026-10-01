"""非确定性 fake LLM：返回含随机内容的响应，模拟真实 LLM 的非确定性。

用途：P0 录制回放原型。录制时其输出含随机数；回放时用录制响应替代，
从而验证「录制回放能把非确定性 LLM 变成确定性评分」这一核心假设。
"""
from __future__ import annotations

import json
import random
from http.server import BaseHTTPRequestHandler, HTTPServer


class FakeLLMHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        _body = self.rfile.read(length)
        content = f"answer-{random.randint(0, 999999)}"
        data = json.dumps({"choices": [{"message": {"content": content}}]}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


def serve(host: str = "127.0.0.1", port: int = 9000):
    HTTPServer((host, port), FakeLLMHandler).serve_forever()


if __name__ == "__main__":
    serve()
