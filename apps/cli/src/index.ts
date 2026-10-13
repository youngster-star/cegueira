/**
 * ceg CLI 入口。
 * 运行：node dist/index.js <command>
 */
import { run } from "./cli.js";

run(process.argv.slice(2)).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
