//! Cegueira 桌面壳。
//!
//! 职责边界（与开发文档 §5.1 一致）：Rust 只做「壳」——窗口与系统能力，
//! 不承载任何业务逻辑。契约生成 / 评分 / 画像 / 阶梯等业务能力全部在
//! 前端 TS 层（直接复用 packages/*），本文件仅负责：单实例、托盘、窗口生命周期。

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WindowEvent,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // 单实例：重复启动时聚焦已有窗口，而非再开一个实例
        .plugin(tauri_plugin_single_instance::init(
            |app, _args, _cwd| {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.unminimize();
                    let _ = win.set_focus();
                }
            },
        ))
        // 托盘 + 关闭到托盘
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let icon = app
                .default_window_icon()
                .cloned()
                .expect("未配置窗口图标（bundle.icon）");

            TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        // 关闭窗口时隐藏到托盘，而非退出进程
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, _event| {});
}
