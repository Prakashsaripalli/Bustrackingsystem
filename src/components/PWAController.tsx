"use client";

import { useEffect, useState } from "react";

export default function PWAController() {
  const [updateReady, setUpdateReady] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    let refreshing = false;
    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker?.addEventListener("controllerchange", onControllerChange);

    let updateIntervalId: number | undefined;

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(registration => {
        if (registration.waiting) setUpdateReady(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) setUpdateReady(worker);
          });
        });
        updateIntervalId = window.setInterval(() => registration.update(), 60 * 60 * 1000);
      }).catch(() => {});
    }

    return () => {
      navigator.serviceWorker?.removeEventListener("controllerchange", onControllerChange);
      if (updateIntervalId) window.clearInterval(updateIntervalId);
    };
  }, []);

  const update = () => updateReady?.postMessage({ type: "SKIP_WAITING" });

  return (
    <>
      {updateReady && (
        <div className="fixed bottom-4 left-4 z-[9000] max-w-sm rounded-2xl bg-white border border-blue-200 shadow-xl p-4">
          <p className="text-sm font-bold text-[#1E293B]">A new Aditya Bus Connect version is ready.</p>
          <button onClick={update} className="mt-2 text-xs font-bold text-[#2563EB] hover:underline">Update now</button>
        </div>
      )}
    </>
  );
}
