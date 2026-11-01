import { Component, type ReactNode } from "react";
import { isChunkError, reloadForNewVersion } from "@/lib/lazyPage";

interface State { error: Error | null }

/** Shows what went wrong instead of a white screen, with a way back. */
export default class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("App crashed:", error);
    if (isChunkError(error)) reloadForNewVersion();
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const update = isChunkError(error);
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md space-y-3 rounded-lg border border-border bg-card p-5 text-sm">
          <div className="text-base font-semibold text-foreground">
            {update ? "A new version of the app was published" : "Something went wrong on this page"}
          </div>
          <p className="text-muted-foreground">
            {update ? "Reload to get the latest version." : "Reloading usually fixes it. If it keeps happening, send Claude the message below."}
          </p>
          {!update && <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 font-mono text-[11px] text-loss-strong">{error.message}</pre>}
          <div className="flex gap-2">
            <button onClick={() => window.location.reload()} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">Reload</button>
            <button onClick={() => { window.location.href = "/"; }} className="rounded-md border border-border px-3 py-1.5 text-xs">Go to dashboard</button>
          </div>
        </div>
      </div>
    );
  }
}
