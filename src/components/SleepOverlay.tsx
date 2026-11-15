import { useEffect, useState, useSyncExternalStore } from "react";
import { Moon } from "lucide-react";
import { SLEEP_CHOICES, isAsleep, setSleepMinutes, sleepMinutes, startSleepWatch, subscribeSleep } from "@/lib/appSleep";

/**
 * Shown while the app sleeps: nothing refreshes and the backend can idle. Any input wakes it.
 * The delay can be changed here (5 / 10 / 15 / 30 minutes or never).
 */
export default function SleepOverlay() {
  useEffect(() => { startSleepWatch(); }, []);
  const asleep = useSyncExternalStore(subscribeSleep, isAsleep, () => false);
  const [mins, setMins] = useState(sleepMinutes);
  if (!asleep) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70 backdrop-blur-[2px]" role="dialog" aria-label="App is sleeping">
      <div className="space-y-3 rounded-2xl border border-border bg-card px-6 py-5 text-center shadow-xl" onPointerDown={(e) => e.stopPropagation()}>
        <Moon className="mx-auto text-primary" size={26} />
        <div className="text-[15px] font-semibold">Sleeping to save Cloud usage</div>
        <p className="max-w-xs text-[12.5px] leading-snug text-muted-foreground">
          Nothing refreshes in the background while you're away. Move the mouse or press any key to wake — stale data refreshes on its own.
        </p>
        <label className="flex items-center justify-center gap-2 text-[12px] text-muted-foreground">
          Sleep after
          <select value={mins} onChange={(e) => { const v = Number(e.target.value); setMins(v); setSleepMinutes(v); }}
            className="rounded-md border border-border bg-background px-1.5 py-1 text-[12px] text-foreground">
            {SLEEP_CHOICES.map((m) => <option key={m} value={m}>{m ? `${m} minutes` : "never"}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}
