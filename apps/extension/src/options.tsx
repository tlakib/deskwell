import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider, Dashboard } from "@deskwell/ui";
import "@deskwell/ui/styles.css";
import { createExtensionBackend } from "./backend";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider backend={createExtensionBackend()} role="options">
      <Dashboard />
    </AppProvider>
  </StrictMode>,
);
