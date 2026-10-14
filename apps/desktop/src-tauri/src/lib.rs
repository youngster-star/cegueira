//! Cegueira 桌面壳。
//!
//! 职责边界（与开发文档 §5.1 一致）：Rust 只做「壳」——窗口与系统能力，
//! 不承载任何业务逻辑。契约生成 / 评分 / 画像 / 阶梯等业务能力全部在
//! 前端 TS 层（直接复用 packages/*），本文件仅负责：单实例、托盘、窗口
//! 生命周期、开机自启、密钥安全存储（API Key）。

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, RunEvent, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;

/// 安全存储密钥（写入系统密钥库，如 Windows 凭据管理器 / macOS Keychain）。
#[tauri::command]
fn set_secret(service: String, account: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(&service, &account).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

/// 读取密钥；不存在时返回错误。
#[tauri::command]
fn get_secret(service: String, account: String) -> Result<String, String> {
    let entry = keyring::Entry::new(&service, &account).map_err(|e| e.to_string())?;
    entry.get_password().map_err(|e| e.to_string())
}

/// 删除密钥。
#[tauri::command]
fn delete_secret(service: String, account: String) -> Result<(), String> {
    let entry = keyring::Entry::new(&service, &account).map_err(|e| e.to_string())?;
    entry.delete_credential().map_err(|e| e.to_string())
}

/// 本地 sidecar 子进程句柄（应用退出时结束它）。
struct Sidecar(Mutex<Option<Child>>);

/// 定位仓库根：优先环境变量 `CEG_REPO_ROOT`；否则由 exe 位置向上探测
/// （target/release → target → src-tauri → desktop → apps → 仓库根）。
fn repo_root() -> Option<std::path::PathBuf> {
    if let Ok(p) = std::env::var("CEG_REPO_ROOT") {
        let pb = std::path::PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }
    let exe = std::env::current_exe().ok()?;
    let mut d = exe.parent()?.to_path_buf(); // …/target/release
    for _ in 0..5 {
        d = d.parent()?.to_path_buf();
    }
    Some(d)
}

/// 拉起 Node sidecar（真实引擎，监听 127.0.0.1:8787）。失败返回 None（不阻塞 GUI）。
fn start_sidecar() -> Option<Child> {
    let repo = repo_root()?;
    let script = repo.join("apps").join("sidecar").join("server.mjs");
    if !script.exists() {
        return None;
    }
    Command::new("node")
        .arg(script)
        .current_dir(&repo)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()
}

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
        // 开机自启（默认不开启，前端通过 JS API 让用户自主开关）
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        // 系统通知（评分完成等场景提醒用户）
        .plugin(tauri_plugin_notification::init())
        // 本地 sidecar（真实引擎）子进程句柄
        .manage(Sidecar(Mutex::new(None)))
        // 密钥安全存储命令桥（API Key 不落盘明文）
        .invoke_handler(tauri::generate_handler![
            set_secret,
            get_secret,
            delete_secret
        ])
        // 托盘 + 关闭到托盘
        .setup(|app| {
            // 启动本地 sidecar（真实引擎）。失败也不阻塞窗口，前端会在调用时提示。
            let child = start_sidecar();
            *app.state::<Sidecar>().0.lock().unwrap() = child;

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

    app.run(|app_handle, event| {
        // 应用退出时结束 sidecar，避免残留监听 8787。
        if let RunEvent::Exit = event {
            if let Some(mut child) = app_handle.state::<Sidecar>().0.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    });
}
