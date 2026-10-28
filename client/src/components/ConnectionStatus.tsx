import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Wifi, WifiOff, CheckCircle } from "lucide-react";

interface ConnectionStatusProps {
  onComplete?: () => void;
}

export function ConnectionStatus({ onComplete }: ConnectionStatusProps) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showStatus, setShowStatus] = useState(true);
  const [statusPhase, setStatusPhase] = useState<"checking" | "result">("checking");

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => {
      setIsOnline(false);
      setStatusPhase("result");
      setShowStatus(true);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const checkTimer = setTimeout(() => {
      setStatusPhase("result");
    }, 800);

    const hideTimer = isOnline ? setTimeout(() => {
      setShowStatus(false);
      onComplete?.();
    }, 2500) : undefined;

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearTimeout(checkTimer);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [isOnline, onComplete]);

  return (
    <AnimatePresence>
      {showStatus && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-background"
          data-testid="connection-status-overlay"
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ type: "spring", duration: 0.5 }}
            className="flex flex-col items-center gap-6 p-8"
          >
            <motion.div
              className="relative flex h-24 w-24 items-center justify-center rounded-full bg-primary/10"
              animate={statusPhase === "checking" ? { scale: [1, 1.1, 1] } : {}}
              transition={{ repeat: Infinity, duration: 1.5 }}
            >
              <AnimatePresence mode="wait">
                {statusPhase === "checking" ? (
                  <motion.div
                    key="checking"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    className="text-primary"
                  >
                    <Wifi className="h-12 w-12" />
                  </motion.div>
                ) : isOnline ? (
                  <motion.div
                    key="online"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-green-500"
                  >
                    <CheckCircle className="h-12 w-12" />
                  </motion.div>
                ) : (
                  <motion.div
                    key="offline"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-orange-500"
                  >
                    <WifiOff className="h-12 w-12" />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            <div className="flex flex-col items-center gap-2 text-center">
              <motion.h1
                className="text-2xl font-bold text-foreground"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                OposTest Pro
              </motion.h1>

              <AnimatePresence mode="wait">
                {statusPhase === "checking" ? (
                  <motion.p
                    key="checking-text"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-muted-foreground"
                  >
                    Comprobando conexión...
                  </motion.p>
                ) : isOnline ? (
                  <motion.p
                    key="online-text"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-green-600 dark:text-green-400"
                  >
                    Conectado correctamente
                  </motion.p>
                ) : (
                  <motion.p
                    key="offline-text"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-orange-600 dark:text-orange-400"
                  >
                    Sin conexión. Los datos privados necesitan conexión para cargarse.
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
            {!isOnline && statusPhase === "result" && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-md bg-primary px-5 py-2 text-primary-foreground hover:opacity-90"
              >
                Reintentar conexión
              </button>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
