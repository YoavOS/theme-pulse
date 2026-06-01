import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface UniverseFilters {
  minMarketCapM: number; // millions; 0 = disabled
  minDollarVolume: number; // dollars
  minAdrPct: number; // percent
  minPrice: number; // dollars
  excludeOtc: boolean;
}

export const DEFAULT_UNIVERSE_FILTERS: UniverseFilters = {
  minMarketCapM: 300,
  minDollarVolume: 10_000_000,
  minAdrPct: 3,
  minPrice: 5,
  excludeOtc: true,
};

const STORAGE_KEY = "rs.universeFilters.v1";

export function loadUniverseFilters(): UniverseFilters {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_UNIVERSE_FILTERS;
    return { ...DEFAULT_UNIVERSE_FILTERS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_UNIVERSE_FILTERS;
  }
}

export function saveUniverseFilters(f: UniverseFilters) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(f)); } catch {}
}

interface Props {
  open: boolean;
  mode: "resume" | "restart";
  onClose: () => void;
  onConfirm: (filters: UniverseFilters) => void;
}

export default function UniverseSettingsModal({ open, mode, onClose, onConfirm }: Props) {
  const [f, setF] = useState<UniverseFilters>(loadUniverseFilters());
  useEffect(() => { if (open) setF(loadUniverseFilters()); }, [open]);

  const presets = {
    cap: [0, 300, 500, 1000, 2000],
    dv: [5_000_000, 10_000_000, 15_000_000, 25_000_000],
    adr: [2, 3, 4, 5],
    price: [2, 5, 6, 10],
  };

  const confirm = () => {
    saveUniverseFilters(f);
    onConfirm(f);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Universe Settings</DialogTitle>
          <DialogDescription>
            Configure the qualification criteria before {mode === "restart" ? "restarting" : "starting"} the scan. Settings are saved for next time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2 text-sm">
          {/* Market Cap */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="font-medium">Min Market Cap</label>
              <span className="text-xs text-muted-foreground">
                {f.minMarketCapM === 0 ? "Disabled" : `$${f.minMarketCapM >= 1000 ? (f.minMarketCapM / 1000).toFixed(1) + "B" : f.minMarketCapM + "M"}`}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {presets.cap.map((v) => (
                <button key={v} onClick={() => setF({ ...f, minMarketCapM: v })}
                  className={`rounded-md border px-2 py-1 text-xs ${f.minMarketCapM === v ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent"}`}>
                  {v === 0 ? "Off" : v >= 1000 ? `$${v / 1000}B` : `$${v}M`}
                </button>
              ))}
              <input type="number" value={f.minMarketCapM} onChange={(e) => setF({ ...f, minMarketCapM: Math.max(0, Number(e.target.value) || 0) })}
                className="w-24 rounded-md border border-border bg-background px-2 py-1 text-xs" placeholder="Custom $M" />
            </div>
          </div>

          {/* Dollar Volume */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="font-medium">Min Avg Daily Dollar Volume</label>
              <span className="text-xs text-muted-foreground">${(f.minDollarVolume / 1_000_000).toFixed(1)}M</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {presets.dv.map((v) => (
                <button key={v} onClick={() => setF({ ...f, minDollarVolume: v })}
                  className={`rounded-md border px-2 py-1 text-xs ${f.minDollarVolume === v ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent"}`}>
                  ${v / 1_000_000}M
                </button>
              ))}
              <input type="number" value={f.minDollarVolume / 1_000_000} onChange={(e) => setF({ ...f, minDollarVolume: Math.max(0, (Number(e.target.value) || 0) * 1_000_000) })}
                className="w-24 rounded-md border border-border bg-background px-2 py-1 text-xs" placeholder="Custom $M" />
            </div>
          </div>

          {/* ADR */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="font-medium">Min Avg Daily Range (ADR%)</label>
              <span className="text-xs text-muted-foreground">{f.minAdrPct}%</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {presets.adr.map((v) => (
                <button key={v} onClick={() => setF({ ...f, minAdrPct: v })}
                  className={`rounded-md border px-2 py-1 text-xs ${f.minAdrPct === v ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent"}`}>
                  {v}%
                </button>
              ))}
              <input type="number" step="0.1" value={f.minAdrPct} onChange={(e) => setF({ ...f, minAdrPct: Math.max(0, Number(e.target.value) || 0) })}
                className="w-20 rounded-md border border-border bg-background px-2 py-1 text-xs" placeholder="Custom %" />
            </div>
          </div>

          {/* Price */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="font-medium">Min Price</label>
              <span className="text-xs text-muted-foreground">${f.minPrice}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {presets.price.map((v) => (
                <button key={v} onClick={() => setF({ ...f, minPrice: v })}
                  className={`rounded-md border px-2 py-1 text-xs ${f.minPrice === v ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent"}`}>
                  ${v}
                </button>
              ))}
              <input type="number" step="0.5" value={f.minPrice} onChange={(e) => setF({ ...f, minPrice: Math.max(0, Number(e.target.value) || 0) })}
                className="w-20 rounded-md border border-border bg-background px-2 py-1 text-xs" placeholder="Custom $" />
            </div>
          </div>

          {/* OTC */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={f.excludeOtc} onChange={(e) => setF({ ...f, excludeOtc: e.target.checked })} />
            <span className="font-medium">Exclude OTC / Pink Sheet stocks</span>
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="outline" onClick={() => setF(DEFAULT_UNIVERSE_FILTERS)}>Reset Defaults</Button>
          <Button onClick={confirm}>
            {mode === "restart" ? "Restart Scan" : "Start Scan"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
