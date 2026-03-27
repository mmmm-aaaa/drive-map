import { useCallback, useMemo, useRef, useState } from "react";

type UseSpeechResult = {
  supported: boolean;
  enabled: boolean;
  initialized: boolean;
  setEnabled: (enabled: boolean) => void;
  initializeWithUserActivation: (initialText?: string) => boolean;
  speak: (text: string, key?: string) => boolean;
  resetLastSpoken: () => void;
};

export function useSpeech(): UseSpeechResult {
  const supported = useMemo(() => typeof window !== "undefined" && "speechSynthesis" in window, []);
  const [enabled, setEnabledState] = useState(supported);
  const [initialized, setInitialized] = useState(false);
  const lastSpokenKeyRef = useRef<string | null>(null);

  const setEnabled = useCallback((nextEnabled: boolean) => {
    setEnabledState(nextEnabled);
    if (!nextEnabled && supported) {
      window.speechSynthesis.cancel();
    }
  }, [supported]);

  const initializeWithUserActivation = useCallback((initialText?: string): boolean => {
    if (!supported) {
      return false;
    }

    try {
      const utterance = new SpeechSynthesisUtterance(initialText ?? "ナビを開始します。");
      utterance.lang = "ja-JP";
      utterance.volume = 1;
      window.speechSynthesis.speak(utterance);
      setInitialized(true);
      return true;
    } catch {
      setInitialized(false);
      return false;
    }
  }, [supported]);

  const speak = useCallback(
    (text: string, key?: string): boolean => {
      if (!supported || !enabled || !initialized) {
        return false;
      }

      const dedupeKey = key ?? text;
      if (lastSpokenKeyRef.current === dedupeKey) {
        return false;
      }

      try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "ja-JP";
        utterance.rate = 1;
        utterance.pitch = 1;
        window.speechSynthesis.speak(utterance);
        lastSpokenKeyRef.current = dedupeKey;
        return true;
      } catch {
        return false;
      }
    },
    [enabled, initialized, supported]
  );

  const resetLastSpoken = useCallback(() => {
    lastSpokenKeyRef.current = null;
  }, []);

  return {
    supported,
    enabled,
    initialized,
    setEnabled,
    initializeWithUserActivation,
    speak,
    resetLastSpoken
  };
}
