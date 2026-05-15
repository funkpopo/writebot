import * as React from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import App from "./components/App";
import "./taskpane.css";
import { clearAgentMemoryOnShutdown } from "../utils/storageService";
import {
  TaskpaneColorScheme,
  taskpaneDarkTheme,
  taskpaneLightTheme,
} from "./ui/nativeTokens";

/* global Office */

function parseRgbLuminance(color: string | undefined): number | null {
  if (!color) return null;
  const match = color.match(/^#?([0-9a-f]{6})$/i);
  if (!match) return null;
  const value = match[1];
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function getInitialColorScheme(): TaskpaneColorScheme {
  const officeTheme = Office.context?.officeTheme;
  const bodyLuminance = parseRgbLuminance(officeTheme?.bodyBackgroundColor);
  if (bodyLuminance !== null) {
    return bodyLuminance < 0.5 ? "dark" : "light";
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

Office.onReady((info) => {
  if (info.host === Office.HostType.Word) {
    let shutdownHandled = false;
    const handleShutdown = () => {
      if (shutdownHandled) return;
      shutdownHandled = true;
      clearAgentMemoryOnShutdown();
    };
    window.addEventListener("pagehide", handleShutdown, { once: true });
    window.addEventListener("beforeunload", handleShutdown, { once: true });
    window.addEventListener("unload", handleShutdown, { once: true });

    const container = document.getElementById("root");
    if (container) {
      const root = createRoot(container);
      const colorScheme = getInitialColorScheme();
      const theme = colorScheme === "dark" ? taskpaneDarkTheme : taskpaneLightTheme;
      document.documentElement.dataset.colorScheme = colorScheme;
      root.render(
        <FluentProvider theme={theme} style={{ height: "100%" }}>
          <App />
        </FluentProvider>
      );
    }
  }
});
