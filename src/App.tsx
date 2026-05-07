import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { WatchlistProvider } from "@/hooks/useWatchlistContext";
import Index from "./pages/Index";
import ThemeToggle from "@/components/ThemeToggle";
import Login from "./pages/Login";
import Admin from "./pages/Admin";
import EodHistory from "./pages/EodHistory";
import AlertCenter from "./pages/AlertCenter";
import ThemeIntelligence from "./pages/ThemeIntelligence";
import Watchlist from "./pages/Watchlist";
import RsAlpha from "./pages/RsAlpha";
import LiveExecution from "./pages/LiveExecution";
import Earnings from "./pages/Earnings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <WatchlistProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <ThemeToggle />
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/login" element={<Login />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/eod-history" element={<EodHistory />} />
              <Route path="/alerts" element={<AlertCenter />} />
              <Route path="/intelligence" element={<ThemeIntelligence />} />
              <Route path="/watchlist" element={<Watchlist />} />
              <Route path="/rs-alpha" element={<RsAlpha />} />
              <Route path="/live" element={<LiveExecution />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </WatchlistProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
