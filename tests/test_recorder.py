"""录制代理（RecorderHandler）行为测试。

覆盖两处修复：
- 上游返回 4xx/5xx 时，代理如实回传真实状态码并**落盘**该状态
  （此前 urlopen 抛 HTTPError，既不记录也向上游调用方抛异常）。
- 转发 Agent 原始请求头（保留 Authorization 等鉴权头）。
"""
import sys
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from python.replay.recorder import RecorderHandler  # noqa: E402
from python.replay.session import RecordingSession  # noqa: E402


class _Upstream(BaseHTTPRequestHandler):
    """固定返回 401 的上游，并记录收到的 Authorization 头。"""

    seen_auth = None

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        self.rfile.read(length)
        _Upstream.seen_auth = self.headers.get("Authorization")
        body = b'{"error": "unauthorized"}'
        self.send_response(401)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


def test_recorder_records_real_status_and_forwards_auth():
    session = RecordingSession(run_id="r1")
    upstream = HTTPServer(("127.0.0.1", 0), _Upstream)
    threading.Thread(target=upstream.serve_forever, daemon=True).start()

    class H(RecorderHandler):
        pass

    H.recording_session = session
    H.upstream = f"http://127.0.0.1:{upstream.server_address[1]}"
    proxy = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=proxy.serve_forever, daemon=True).start()

    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{proxy.server_address[1]}/v1/chat/completions",
            data=b'{"model": "m"}',
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer secret-token",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req) as resp:
                status = resp.status
        except urllib.error.HTTPError as e:
            status = e.code

        assert status == 401, f"代理应回传上游 401，实际 {status}"
        assert _Upstream.seen_auth == "Bearer secret-token", "Authorization 应转发到上游"

        recs = list(session.http_records.values())
        assert len(recs) == 1, f"应记录 1 条 HTTP 交换，实际 {len(recs)}"
        assert recs[0]["response"]["status"] == 401, recs[0]
    finally:
        proxy.shutdown()
        upstream.shutdown()


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"  ✓ {t.__name__}")
    print(f"录制代理测试全部通过 ✅（{len(tests)} 项）")


if __name__ == "__main__":
    main()
