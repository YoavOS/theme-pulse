import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Admin from "./pages/Admin";
import ThemeIntelligence from "./pages/ThemeIntelligence";
import RsAlpha from "./pages/RsAlpha";
import LiveExecution from "./pages/LiveExecution";
import Earnings from "./pages/Earnings";
import MarketDrivers from "./pages/MarketDrivers";
import MorningBrief from "./pages/MorningBrief";
import StorageManager from "./pages/StorageManager";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/login" element={<Login />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/intelligence" element={<ThemeIntelligence />} />
            <Route path="/rs-alpha" element={<RsAlpha />} />
            <Route path="/live" element={<LiveExecution />} />
            <Route path="/earnings" element={<Earnings />} />
            <Route path="/market-drivers" element={<MarketDrivers />} />
            <Route path="/morning-brief" element={<MorningBrief />} />
            <Route path="/storage" element={<StorageManager />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
