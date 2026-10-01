"""请求指纹：method + host + path + hash(normalized body)。

用于录制回放匹配（见 docs/开发文档.md §9.2）。
归一化剔除动态字段，保证同一语义请求的指纹稳定。
"""
from __future__ import annotations

import hashlib
import json

# 动态字段：参与指纹计算前剔除
_DYNAMIC_KEYS = ("timestamp", "random", "nonce", "id", "request_id")


def normalize_body(body: bytes) -> str:
    if not body:
        return ""
    try:
        obj = json.loads(body.decode("utf-8"))
    except Exception:
        return body.decode("utf-8", errors="replace")
    for key in _DYNAMIC_KEYS:
        obj.pop(key, None)
    return json.dumps(obj, sort_keys=True, ensure_ascii=False)


def fingerprint(method: str, host: str, path: str, body: bytes) -> str:
    raw = f"{method} {host}{path} {normalize_body(body)}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()
