import { createPortal } from "react-dom";
import LensPanel from "./LensPanel";

/** Renders the panel into the PiP window while it's open. */
export function LensPipPortal({ win, symbol, onClose }: { win: Window | null; symbol: string | null; onClose: () => void }) {
  if (!win) return null;
  return createPortal(
    <div style={{ height: "100vh" }} className="bg-background text-foreground">
      <LensPanel symbol={symbol} onClose={onClose} compactHeader />
    </div>,
    win.document.body,
  );
}
