import { useState, useEffect } from "react";
import { HelpCircle } from "lucide-react";
import LegendModal from "@/components/LegendModal";

const STORAGE_KEY = "hasSeenLegend";

export default function HelpButton() {
  const [open, setOpen] = useState(false);
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen) {
      setShowHint(true);
      const timer = setTimeout(() => setShowHint(false), 5000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleOpen = () => {
    setOpen(true);
    setShowHint(false);
    localStorage.setItem(STORAGE_KEY, "true");
  };

  return (
    <>
      <div className="relative">
        <button
          onClick={handleOpen}
          className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Indicator Guide"
        >
          <HelpCircle size={14} />
        </button>

        {/* First-time hint */}
        {showHint && (
          <div
            className="absolute right-0 top-full mt-2 z-50 animate-pulse cursor-pointer"
            onClick={handleOpen}
          >
            <div className="flex items-center gap-1.5 rounded-md border border-[#00f5c4]/30 bg-[#00f5c4]/10 px-3 py-1.5 whitespace-nowrap">
              <span className="text-[#00f5c4] text-sm">↑</span>
              <span className="text-[10px] font-medium text-[#00f5c4]" style={{ fontFamily: "'DM Mono', monospace" }}>
                New? See the indicator guide
              </span>
            </div>
          </div>
        )}
      </div>

      <LegendModal open={open} onOpenChange={setOpen} />
    </>
  );
}
