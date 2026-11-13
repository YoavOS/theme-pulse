import { useCallback, useEffect, useState } from "react";

// Always-on-top Fundamentals Lens via the Document Picture-in-Picture API (Chrome/Edge 116+).
// The panel stays part of this React tree, so it follows the ticker with no messaging. Elsewhere
// (Safari, Firefox without support) the caller falls back to a normal pop-up window.

interface DocPip { requestWindow(o?: { width?: number; height?: number }): Promise<Window>; window: Window | null }
const api = (): DocPip | null => (typeof window !== "undefined" && "documentPictureInPicture" in window ? (window as unknown as { documentPictureInPicture: DocPip }).documentPictureInPicture : null);

/** Copy the app's styles and theme (dark class, CSS variables) into the PiP document. */
function copyStyles(to: Window) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const css = Array.from(sheet.cssRules).map((r) => r.cssText).join("\n");
      const s = to.document.createElement("style");
      s.textContent = css;
      to.document.head.appendChild(s);
    } catch {
      if (sheet.href) {   // cross-origin sheet (e.g. web fonts): link it instead
        const l = to.document.createElement("link");
        l.rel = "stylesheet"; l.href = sheet.href;
        to.document.head.appendChild(l);
      }
    }
  }
  to.document.documentElement.className = document.documentElement.className;
  const st = document.documentElement.getAttribute("style");
  if (st) to.document.documentElement.setAttribute("style", st);
  to.document.body.className = document.body.className;
  to.document.body.style.margin = "0";
  to.document.title = "Fundamentals Lens";
}

export function useLensPip() {
  const [win, setWin] = useState<Window | null>(null);
  const supported = !!api();
  const open = useCallback(async (): Promise<boolean> => {
    const a = api();
    if (!a) return false;
    try {
      if (a.window) { a.window.focus(); return true; }
      const w = await a.requestWindow({ width: 420, height: 900 });
      copyStyles(w);
      w.addEventListener("pagehide", () => setWin(null));
      setWin(w);
      return true;
    } catch (e) {
      console.warn("Picture-in-Picture unavailable", e);
      return false;
    }
  }, []);
  const close = useCallback(() => { win?.close(); setWin(null); }, [win]);
  useEffect(() => () => { win?.close(); }, [win]);
  return { win, open, close, supported };
}
