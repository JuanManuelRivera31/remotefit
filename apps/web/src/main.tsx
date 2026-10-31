import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { APP_NAME } from "./app-name.js";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(
  <StrictMode>
    <h1>{APP_NAME}</h1>
  </StrictMode>,
);
