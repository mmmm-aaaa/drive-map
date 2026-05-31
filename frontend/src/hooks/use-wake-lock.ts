import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

type UseWakeLockResult = {
  supported: boolean;
  active: boolean;
  requestWakeLock: () => Promise<boolean>;
  releaseWakeLock: () => Promise<void>;
};

export function useWakeLock(): UseWakeLockResult {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);
  const shouldRestoreRef = useRef(false);
  const [active, setActive] = useState(false);
  const supported = useMemo(() => typeof navigator !== "undefined" && "wakeLock" in navigator, []);

  const releaseWakeLock = useCallback(async () => {
    shouldRestoreRef.current = false;
    if (!sentinelRef.current) {
      setActive(false);
      return;
    }
    try {
      await sentinelRef.current.release();
    } finally {
      sentinelRef.current = null;
      setActive(false);
    }
  }, []);

  const requestWakeLock = useCallback(async () => {
    const wakeLockNavigator = navigator as WakeLockNavigator;
    if (!supported || !wakeLockNavigator.wakeLock) {
      return false;
    }

    try {
      sentinelRef.current = await wakeLockNavigator.wakeLock.request("screen");
      shouldRestoreRef.current = true;
      setActive(true);
      return true;
    } catch {
      sentinelRef.current = null;
      setActive(false);
      return false;
    }
  }, [supported]);

  useEffect(() => {
    const onVisibilityChange = (): void => {
      if (document.visibilityState !== "visible" || !shouldRestoreRef.current) {
        return;
      }

      void requestWakeLock();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [requestWakeLock]);

  return {
    supported,
    active,
    requestWakeLock,
    releaseWakeLock
  };
}
