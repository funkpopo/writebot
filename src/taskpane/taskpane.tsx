import * as React from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, webLightTheme, createLightTheme, BrandVariants } from "@fluentui/react-components";
import App from "./components/App";

/* global Office */

// 自定义品牌色调 - 使用Microsoft风格的绿色
const customBrand: BrandVariants = {
  10: "#020402",
  20: "#101D14",
  30: "#162E1E",
  40: "#1A3D26",
  50: "#1D4D2E",
  60: "#1F5D36",
  70: "#216E3F",
  80: "#217F47",
  90: "#1F9150",
  100: "#19A359",
  110: "#0AB562",
  120: "#2FC76F",
  130: "#4FD87F",
  140: "#6FE890",
  150: "#8FF6A2",
  160: "#B0FFB6",
};

// 创建自定义主题，增加圆角
const customTheme = {
  ...createLightTheme(customBrand),
  borderRadiusMedium: "8px",
  borderRadiusLarge: "12px",
  borderRadiusXLarge: "16px",
};

Office.onReady((info) => {
  if (info.host === Office.HostType.Word) {
    const container = document.getElementById("root");
    if (container) {
      const root = createRoot(container);
      root.render(
        <FluentProvider theme={customTheme}>
          <App />
        </FluentProvider>
      );
    }
  }
});
