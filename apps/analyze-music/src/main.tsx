import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./styles.css";

const element = document.getElementById("root");
if (!element) {
  throw new Error("Missing root element");
}

const apiBaseUrl = new URLSearchParams(window.location.search).get("api") ?? undefined;
createRoot(element).render(<App apiBaseUrl={apiBaseUrl} />);
