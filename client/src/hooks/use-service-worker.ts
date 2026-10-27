import { useEffect, useState } from "react";

interface ServiceWorkerStatus {
  isSupported: boolean;
  isRegistered: boolean;
  isUpdateAvailable: boolean;
  registration: ServiceWorkerRegistration | null;
}

export function useServiceWorker() {
  const [status, setStatus] = useState<ServiceWorkerStatus>({
    isSupported: false,
    isRegistered: false,
    isUpdateAvailable: false,
    registration: null,
  });

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      setStatus((prev) => ({ ...prev, isSupported: false }));
      return;
    }

    setStatus((prev) => ({ ...prev, isSupported: true }));

    const registerServiceWorker = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });

        setStatus((prev) => ({
          ...prev,
          isRegistered: true,
          registration,
          isUpdateAvailable: Boolean(registration.waiting),
        }));

        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener("statechange", () => {
              if (
                newWorker.state === "installed" &&
                navigator.serviceWorker.controller
              ) {
                setStatus((prev) => ({ ...prev, isUpdateAvailable: true }));
              }
            });
          }
        });
      } catch (error) {
        console.error("Service Worker registration failed:", error);
      }
    };

    registerServiceWorker();
  }, []);

  const update = async () => {
    if (status.registration) {
      await status.registration.update();
    }
  };

  const dismissUpdateNotice = () => {
    setStatus((prev) => ({ ...prev, isUpdateAvailable: false }));
  };

  return { ...status, update, dismissUpdateNotice };
}
