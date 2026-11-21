import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider, Panel } from "@deskwell/ui";
import "@deskwell/ui/styles.css";
import { createExtensionBackend } from "./backend";

document.documentElement.style.width = "360px";
document.documentElement.style.height = "540px";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider backend={createExtensionBackend()} role="panel">
      <Panel />
    </AppProvider>
  </StrictMode>,
);
