import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Admin from "./pages/Admin";
import RsAlpha from "./pages/RsAlpha";
import LiveExecution from "./pages/LiveExecution";
import Earnings from "./pages/Earnings";
import MarketFlag from "./pages/MarketFlag";
import StorageManager from "./pages/StorageManager";
import MinerviniChecker from "./pages/MinerviniChecker";
import StageAnalysis from "./pages/StageAnalysis";
import BaseScanner from "./pages/BaseScanner";
import NotFound from "./pages/NotFound";
import { useEffect } from "react";
import { autoRunClassificationOncePerDay } from "@/lib/classification";

const queryClient = new QueryClient();

/** Once a day, quietly continue the industry-classification queue (see classify-tickers). */
function ClassificationAutoRunner() {
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
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
