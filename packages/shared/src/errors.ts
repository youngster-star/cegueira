/**
 * 错误码分区（见 docs/开发规范.md §7）。
 * 每个分区用 1xxx 起始，具体错误在该分区内细分。
 */
export const ErrorCode = {
  ENV: "1xxx", // 环境 / venv 自举 / 依赖安装
  CONTRACT: "2xxx", // 契约生成 / 校验
  RECORDER: "3xxx", // 录制 / 回放
  SCORER: "4xxx", // 评分 / 门控
  PROFILE: "5xxx", // 画像 / 阶梯
  DESKTOP: "6xxx", // 桌面壳 / 系统集成
} as const;

export type ErrorCodeKey = keyof typeof ErrorCode;
