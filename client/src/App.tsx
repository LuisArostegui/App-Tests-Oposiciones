import { useState } from "react";
import { Switch, Route, useLocation, useSearch, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { MobileNav } from "@/components/MobileNav";
import { useServiceWorker } from "@/hooks/use-service-worker";
import { useAuth } from "@/hooks/use-auth";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import TestView from "@/pages/TestView";
import Results from "@/pages/Results";
import Admin from "@/pages/Admin";
import Login from "@/pages/Login";
import Register from "@/pages/Register";

const pageVariants = {
  initial: { opacity: 0, y: 8 },
  in: { opacity: 1, y: 0 },
  out: { opacity: 0, y: -8 }
};

const pageTransition = {
  type: "tween",
  ease: "easeInOut",
  duration: 0.2
};

function AnimatedPage({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial="initial"
      animate="in"
      exit="out"
      variants={pageVariants}
      transition={pageTransition}
    >
      {children}
    </motion.div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const searchString = useSearch();
  const { isAuthenticated, isLoading } = useAuth();
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  
  if (!isAuthenticated) {
    const returnTo = `${location}${searchString ? `?${searchString.replace(/^\?/, "")}` : ""}`;
    return <Redirect to={`/login?returnTo=${encodeURIComponent(returnTo)}`} />;
  }
  
  return <>{children}</>;
}

function AuthRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  
  if (isAuthenticated) {
    return <Redirect to="/" />;
  }
  
  return <>{children}</>;
}

function Router() {
  const [location] = useLocation();
  
  return (
    <AnimatePresence mode="wait">
      <Switch location={location} key={location}>
        <Route path="/login">
          <AuthRoute>
            <AnimatedPage><Login /></AnimatedPage>
          </AuthRoute>
        </Route>
        <Route path="/register">
          <AuthRoute>
            <AnimatedPage><Register /></AnimatedPage>
          </AuthRoute>
        </Route>
        <Route path="/">
          <ProtectedRoute>
            <AnimatedPage><Home /></AnimatedPage>
          </ProtectedRoute>
        </Route>
        <Route path="/test/:id">
          <ProtectedRoute><TestView /></ProtectedRoute>
        </Route>
        <Route path="/results">
          <ProtectedRoute>
            <AnimatedPage><Results /></AnimatedPage>
          </ProtectedRoute>
        </Route>
        <Route path="/admin">
          <ProtectedRoute>
            <AnimatedPage><Admin /></AnimatedPage>
          </ProtectedRoute>
        </Route>
        <Route>
          <AnimatedPage><NotFound /></AnimatedPage>
        </Route>
      </Switch>
    </AnimatePresence>
  );
}

function AppContent() {
  const [showSplash, setShowSplash] = useState(true);
  const [location] = useLocation();
  const { isAuthenticated } = useAuth();
  const serviceWorker = useServiceWorker();

  const isTestView = location.startsWith("/test/");
  const isAuthPage = location === "/login" || location === "/register";

  return (
    <>
      {showSplash && (
        <ConnectionStatus onComplete={() => setShowSplash(false)} />
      )}
      <Toaster />
      {serviceWorker.isUpdateAvailable && (
        <div className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-3 bg-amber-100 px-4 py-3 text-sm text-amber-950 shadow dark:bg-amber-950 dark:text-amber-50">
          <span>Actualización de seguridad lista. Termina el test y cierra todas las pestañas de la app para aplicarla.</span>
          <button
            type="button"
            className="rounded bg-amber-900 px-3 py-1 font-medium text-white dark:bg-amber-100 dark:text-amber-950"
            onClick={serviceWorker.dismissUpdateNotice}
          >
            Entendido
          </button>
        </div>
      )}
      <div className={isTestView || isAuthPage ? "" : "pb-16 md:pb-0"}>
        <Router />
      </div>
      {!isTestView && !isAuthPage && isAuthenticated && <MobileNav />}
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppContent />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
