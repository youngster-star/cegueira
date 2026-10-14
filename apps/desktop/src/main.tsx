import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// 桌面应用观感：仅在 Tauri 运行时禁用「网页味」交互——
// 右键菜单、Ctrl+滚轮/±缩放、拖放文件导致导航。浏览器预览不受影响。
const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
if (inTauri) {
  window.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    },
    { passive: false },
  );
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && ["+", "-", "=", "0"].includes(e.key)) {
      e.preventDefault();
    }
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
