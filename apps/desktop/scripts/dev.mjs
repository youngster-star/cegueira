/**
 * 桌面端开发编排：同时拉起
 *   1) 本地 sidecar（真实引擎，127.0.0.1:8787）
 *   2) Vite dev server（前端，127.0.0.1:1420）
 * 任一退出即全部收尾。零第三方依赖。
 *
 * 前置：引擎（apps/cli/dist）需已构建；缺失时本脚本会先 `pnpm -r build`。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = resolve(HERE, "..");
const REPO = resolve(DESKTOP, "../..");
const SIDECAR = join(REPO, "apps", "sidecar", "server.mjs");
const CLI_DIST = join(REPO, "apps", "cli", "dist", "index.js");

// 引擎未构建则先构建（首次运行需要）。
if (!existsSync(CLI_DIST)) {
  console.log("[dev] 引擎未构建，先执行 pnpm -r build …");
  const r = spawnSync("corepack pnpm -r build", { cwd: REPO, stdio: "inherit", shell: true });
  if (r.status !== 0) {
    console.error("[dev] 构建失败，退出。");
    process.exit(1);
  }
}

// 定位 vite 可执行（node_modules/vite/bin/vite.js）。
const require = createRequire(import.meta.url);
const viteBin = join(dirname(require.resolve("vite/package.json")), "bin", "vite.js");

const children = [];
function run(name, args, cwd) {
  const p = spawn(process.execPath, args, { cwd, stdio: "inherit", env: process.env });
  p.on("exit", (code) => {
    console.log(`[dev] ${name} exited (${code})`);
    shutdown();
  });
  children.push(p);
}

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  for (const c of children) {
    try {
      c.kill();
    } catch {
      /* ignore */
    }
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

run("sidecar", [SIDECAR], REPO);
run("vite", [viteBin, "--host", "127.0.0.1", "--port", "1420"], DESKTOP);
