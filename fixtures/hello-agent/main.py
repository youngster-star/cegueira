"""最小 Hello Agent：输出一行 JSON Lines，验证运行时引导。"""
import json
import sys


def main():
    msg = {"type": "hello", "agent": "hello-agent", "ok": True}
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()
    # 故意打一条日志到 stderr，验证 stdout/stderr 分离
    sys.stderr.write("[log] hello-agent started\n")
    sys.stderr.flush()


if __name__ == "__main__":
    main()
