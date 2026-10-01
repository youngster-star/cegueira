"""回放 mock：读录制文件，按指纹返回录制响应；未命中即报错。"""
from __future__ import annotations

from http.server import BaseHTTPRequestHandler, HTTPServer

from .fingerprint import fingerprint

LOGICAL_HOST = "llm"


class ReplayerHandler(BaseHTTPRequestHandler):
    records: dict = {}

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        fp = fingerprint("POST", LOGICAL_HOST, self.path, body)

        rec = self.records.get(fp)
        if rec is None:
            # 未命中：报错而非静默放行，保证确定性（见 docs/常见错误与坑.md §2）
            self.send_error(500, f"no recording for fingerprint {fp}")
            return

        resp_body = rec["response"]["body"].encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(resp_body)))
        self.end_headers()
        self.wfile.write(resp_body)

    def log_message(self, *args):
        pass
