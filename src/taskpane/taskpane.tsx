import * as React from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, webLightTheme, createLightTheme, BrandVariants } from "@fluentui/react-components";
import App from "./components/App";

/* global Office */

// 自定义品牌色调 - 使用Word风格的蓝色
const customBrand: BrandVariants = {
  10: "#020305",
  20: "#0D1520",
  30: "#142338",
  40: "#182F4D",
  50: "#1B3C63",
  60: "#1E4979",
  70: "#205790",
  80: "#2165A8",
  90: "#2174C0",
  100: "#2B579A",
  110: "#3A6BAE",
  120: "#4A7FC2",
  130: "#5B93D6",
  140: "#6DA7EA",
  150: "#8FBCF5",
  160: "#B2D1FF",
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
