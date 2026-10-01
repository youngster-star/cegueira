<p align="center">
  <img src="assets/logo.svg" width="160" alt="Cegueira Logo" />
</p>

<h1 align="center">Cegueira · 失明</h1>
<p align="center"><strong>Da Cegueira à Lucidez · 从失明到复明</strong></p>

<p align="center">
  面向 <strong>Agent 开发者</strong> 的实战陪练与自动评分工具
</p>

---

## 简介

Cegueira（失明）通过「确定方向 → 生成契约与测试集 → 录制回放评分 → 沉淀技能画像」的闭环，帮助 Agent 开发者从「失明」走向「复明」（Lucidez）。

**核心判断**：Agent 项目的质量不在代码里，而在运行轨迹里。因此本产品能真正运行用户的 Agent，并通过「录制-回放」实现可复现的确定性评分。

---

## ✨ 主要功能

| 模块 | 说明 |
|---|---|
| 方向生成 | 根据技能自评推荐可上手的项目方向 |
| 契约先行 | 生成 project.md / contract.json / rubric.yaml / checks / evalset 五件套 |
| 录制回放评分 | 真实运行 Agent，确定性回放，四维评分 + 门控 |
| 技能画像 | 六档分档、三态显示、遗忘衰减 |
| 辅助阶梯 | L0–L4 分级引导，给提示而非给答案 |
| 隐私保护 | 本地脱敏 → AST 裁剪 → 外发预览 |

---

## 🛠 技术栈

| 层 | 技术 | 职责 |
|---|---|---|
| 桌面壳 | Rust + Tauri 2 | 窗口 / 托盘 / 单实例 / 更新 / 密钥库 |
| 业务层 | Node.js + TypeScript | 契约 / 录制回放 / 评分 / 画像 / 阶梯 |
| 运行时 | Python（隔离 venv） | 执行用户 Agent、采集 trace |
| 持久化 | SQLite | 画像、项目、评分 |

---

## 📁 目录结构

```
cegueira/
├── apps/          # 桌面端（Tauri） / CLI / sidecar
├── packages/      # 契约 / 录制回放 / 评分 / 画像 / 阶梯 / 隐私
├── python/        # Agent 运行时引导 / OTel / 回放 mock
└── assets/        # LOGO 等静态资源
```

---

## 🚀 快速开始

> 项目当前处于开发阶段，尚未发布稳定版。

### 环境要求

| 依赖 | 版本 |
|---|---|
| Rust | 1.75+ |
| Node.js | 20+ |
| pnpm | 9+ |
| Python | 3.11+ |

### 安装与运行

```bash
git clone https://github.com/youngster-star/cegueira.git
cd cegueira
pnpm install
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml
```

---

## 📄 协议

源码开放可见（Source Available），个人 / 学术 / 非商业用途免费。

**商业使用需联系作者授权。** 详见 [LICENSE](LICENSE)。

---

## 📮 联系作者

- GitHub：[@youngster-star](https://github.com/youngster-star)
- 邮箱：dkbzxxsd@163.com
