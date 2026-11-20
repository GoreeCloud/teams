import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./vendor/gc-ui/tokens.css";
import "./styles.css";

// Preserve the existing automatic OS light/dark preference. This is only a
// local CSS scope; no preferences, credentials or telemetry are stored.
const systemAppearance = window.matchMedia("(prefers-color-scheme: dark)");
const synchronizeAppearance = () => {
  document.documentElement.dataset.gcTheme = systemAppearance.matches ? "dark" : "light";
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const canvas = getComputedStyle(document.documentElement).getPropertyValue("--gc-canvas").trim();
  if (themeColor && canvas) themeColor.content = canvas;
};
systemAppearance.addEventListener("change", synchronizeAppearance);
synchronizeAppearance();

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
