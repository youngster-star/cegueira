"""P0 假设 3：向量检索延迟压测（p95 < 150ms）。"""
import numpy as np


def benchmark(n=10000, dim=768, queries=100):
    rng = np.random.default_rng(42)
    corpus = rng.random((n, dim), dtype=np.float32)
    corpus /= np.linalg.norm(corpus, axis=1, keepdims=True)
    qs = rng.random((queries, dim), dtype=np.float32)
    qs /= np.linalg.norm(qs, axis=1, keepdims=True)

    latencies = []
    for q in qs:
        t0 = __import__("time").perf_counter()
        sims = corpus @ q  # 余弦相似度（向量已归一化）
        _topk = np.argpartition(sims, -5)[-5:]
        latencies.append((__import__("time").perf_counter() - t0) * 1000)

    p95 = float(np.percentile(latencies, 95))
    mean = float(np.mean(latencies))
    return p95, mean


def main():
    p95, mean = benchmark()
    print(f"  p95: {p95:.2f} ms, mean: {mean:.2f} ms")
    assert p95 < 150, f"❌ p95 超过 150ms: {p95:.2f}"
    print("P0 向量检索压测通过 ✅")


if __name__ == "__main__":
    main()
