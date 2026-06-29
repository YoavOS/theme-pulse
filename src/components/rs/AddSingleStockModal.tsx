import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAdded?: () => void | Promise<void>;
}

function cleanTicker(raw: string): string {
  let t = raw.trim().toUpperCase();
  const colonIdx = t.indexOf(":");
  if (colonIdx >= 0) t = t.slice(colonIdx + 1);
  return t.replace(/[^A-Z0-9.\-]/g, "");
}

export default function AddSingleStockModal({ open, onOpenChange, onAdded }: Props) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleAdd = async () => {
    const symbol = cleanTicker(value);
    if (!symbol) {
      toast.error("Please enter a ticker symbol.");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("add-single-stock", {
        body: { symbol },
      });
      if (error) throw error;
      if ((data as any)?.alreadyExists) {
        toast.message(`Ticker ${symbol} is already in the universe.`);
      } else if ((data as any)?.added) {
        toast.success(`Ticker ${symbol} successfully added to the universe.`);
        setValue("");
        await onAdded?.();
      } else if ((data as any)?.error) {
        throw new Error((data as any).error);
      }
    } catch (e: any) {
      toast.error(`Failed to add: ${e?.message ?? "unknown error"}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Single Stock to Universe</DialogTitle>
          <DialogDescription>
            Add a ticker directly to the qualified universe. No qualification checks are run — the stock
            is added regardless of market cap, volume, or ADR. Run "Recalculate RS Scores" afterwards to
            populate RS values.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !submitting) void handleAdd(); }}
            placeholder="e.g. AAPL, TSLA, NVDA"
            autoFocus
            disabled={submitting}
            className="uppercase"
          />
          <Button onClick={handleAdd} disabled={submitting || !value.trim()} className="w-full">
            {submitting ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Adding…</>
            ) : (
              <><Plus className="h-4 w-4" /> Add Stock</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
