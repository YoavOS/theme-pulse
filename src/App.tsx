import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import Index from "./pages/Index";
// Every other page loads only when it is opened: the dashboard no longer downloads and keeps in
// memory the code for RS Alpha, Stages, Bases, Earnings, Live Execution, Minervini, etc.
const Login = lazyPage(() => import("./pages/Login"));
const Admin = lazyPage(() => import("./pages/Admin"));
const RsAlpha = lazyPage(() => import("./pages/RsAlpha"));
const LiveExecution = lazyPage(() => import("./pages/LiveExecution"));
const Earnings = lazyPage(() => import("./pages/Earnings"));
const MarketFlag = lazyPage(() => import("./pages/MarketFlag"));
const StorageManager = lazyPage(() => import("./pages/StorageManager"));
const MinerviniChecker = lazyPage(() => import("./pages/MinerviniChecker"));
const StageAnalysis = lazyPage(() => import("./pages/StageAnalysis"));
const BaseScanner = lazyPage(() => import("./pages/BaseScanner"));
const NotFound = lazyPage(() => import("./pages/NotFound"));
import { Suspense, useEffect } from "react";
import { lazyPage } from "@/lib/lazyPage";
import AppErrorBoundary from "@/components/AppErrorBoundary";
import { scheduleStorageCleanup } from "@/lib/storageHygiene";
import { autoRunClassificationOncePerDay } from "@/lib/classification";

const queryClient = new QueryClient();

function PageLoading() {
  return <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">Loading…</div>;
}

/** Once a day, quietly continue the industry-classification queue (see classify-tickers). */
function ClassificationAutoRunner() {
  useEffect(() => { scheduleStorageCleanup(); }, []);
  useEffect(() => {
    const t = window.setTimeout(() => { autoRunClassificationOncePerDay().catch(() => undefined); }, 15_000);
    return () => window.clearTimeout(t);
  }, []);
  return null;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <ClassificationAutoRunner />
        <BrowserRouter>
          <AppErrorBoundary>
          <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/login" element={<Login />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/intelligence" element={<Navigate to="/" replace />} />
            <Route path="/rs-alpha" element={<RsAlpha />} />
            <Route path="/live" element={<LiveExecution />} />
            <Route path="/earnings" element={<Earnings />} />
            <Route path="/market-drivers" element={<Navigate to="/" replace />} />
            <Route path="/morning-brief" element={<Navigate to="/?brief=1" replace />} />
            <Route path="/market-flag" element={<MarketFlag />} />
            <Route path="/storage" element={<StorageManager />} />
            <Route path="/minervini" element={<MinerviniChecker />} />
            <Route path="/stages" element={<StageAnalysis />} />
            <Route path="/bases" element={<BaseScanner />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
          </AppErrorBoundary>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
