import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { reloadForNewVersion } from "./lib/lazyPage";

// Vite reports a page file that no longer exists (deleted by a newer Publish): reload once.
window.addEventListener("vite:preloadError", (e) => {
  if (reloadForNewVersion()) e.preventDefault();
});

createRoot(document.getElementById("root")!).render(<App />);
