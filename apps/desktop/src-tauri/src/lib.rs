//! Cegueira 桌面壳。
//!
//! 职责边界（与开发文档 §5.1 一致）：Rust 只做「壳」——窗口与系统能力，
//! 不承载任何业务逻辑。契约生成 / 评分 / 画像 / 阶梯等业务能力全部在
//! 前端 TS 层（直接复用 packages/*），本文件仅负责启动窗口。

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
