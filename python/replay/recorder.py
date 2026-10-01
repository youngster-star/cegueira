"""录制代理：把 Agent 的 LLM 请求转发到上游，同时记录请求-响应对。"""
from __future__ import annotations

import json
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

from .fingerprint import fingerprint

DEFAULT_UPSTREAM = "http://127.0.0.1:9000"
# 逻辑 host：录制与回放使用同一标识，保证指纹一致（不依赖真实代理端口）
LOGICAL_HOST = "llm"


class Recording:
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
    recording: Recording = None
    upstream: str = DEFAULT_UPSTREAM

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        req = urllib.request.Request(
            self.upstream + self.path,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req) as resp:
            resp_body = resp.read()

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

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(resp_body)))
        self.end_headers()
        self.wfile.write(resp_body)

    def log_message(self, *args):
        pass
