import * as React from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import App from "./components/App";

/* global Office */

Office.onReady((info) => {
  if (info.host === Office.HostType.Word) {
    const container = document.getElementById("root");
    if (container) {
      const root = createRoot(container);
      root.render(
        <FluentProvider theme={webLightTheme}>
          <App />
        </FluentProvider>
      );
    }
  }
});
