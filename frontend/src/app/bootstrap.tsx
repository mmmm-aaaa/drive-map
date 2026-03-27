import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

export function bootstrap(): void {
  const container = document.getElementById("root");
  if (!container) {
    throw new Error("Root element was not found");
  }

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
