import { useCallback, useEffect, useRef, useState } from "react";
import type { CurrentPosition } from "@drive-map/shared";
import { GEOLOCATION_OPTIONS } from "@drive-map/shared";

export type GeolocationStatus = "idle" | "requesting" | "ready" | "permission_denied" | "timeout" | "unavailable" | "error";

type UseGeolocationResult = {
  status: GeolocationStatus;
  position: CurrentPosition | null;
  errorMessage: string | null;
  requestCurrentPosition: () => Promise<CurrentPosition | null>;
  startWatching: (onPosition: (position: CurrentPosition) => void) => void;
  stopWatching: () => void;
};

function toCurrentPosition(position: GeolocationPosition): CurrentPosition {
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy,
    heading: Number.isFinite(position.coords.heading) ? position.coords.heading : null,
    speed: Number.isFinite(position.coords.speed) ? position.coords.speed : null,
    timestamp: position.timestamp
  };
}

function mapErrorMessage(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) {
    return "位置情報の利用が拒否されました。ブラウザ設定から許可してください。";
  }
  if (error.code === error.TIMEOUT) {
    return "位置情報の取得がタイムアウトしました。通信状況を確認して再試行してください。";
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return "現在地を取得できませんでした。屋外で再試行してください。";
  }
  return "位置情報の取得に失敗しました。";
}

export function useGeolocation(): UseGeolocationResult {
  const watchIdRef = useRef<number | null>(null);

  const [status, setStatus] = useState<GeolocationStatus>("idle");
  const [position, setPosition] = useState<CurrentPosition | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const stopWatching = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const requestCurrentPosition = useCallback(async (): Promise<CurrentPosition | null> => {
    if (!("geolocation" in navigator)) {
      setStatus("unavailable");
      setErrorMessage("このブラウザでは位置情報に対応していません。");
      return null;
    }

    setStatus("requesting");
    setErrorMessage(null);

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (geoPosition) => {
          const current = toCurrentPosition(geoPosition);
          setPosition(current);
          setStatus("ready");
          resolve(current);
        },
        (error) => {
          const message = mapErrorMessage(error);
          setErrorMessage(message);
          setStatus(error.code === error.PERMISSION_DENIED ? "permission_denied" : error.code === error.TIMEOUT ? "timeout" : "error");
          resolve(null);
        },
        GEOLOCATION_OPTIONS
      );
    });
  }, []);

  const startWatching = useCallback(
    (onPosition: (current: CurrentPosition) => void) => {
      if (!("geolocation" in navigator)) {
        setStatus("unavailable");
        setErrorMessage("このブラウザでは位置情報に対応していません。");
        return;
      }

      stopWatching();

      watchIdRef.current = navigator.geolocation.watchPosition(
        (geoPosition) => {
          const current = toCurrentPosition(geoPosition);
          setPosition(current);
          setStatus("ready");
          onPosition(current);
        },
        (error) => {
          setErrorMessage(mapErrorMessage(error));
          setStatus(error.code === error.PERMISSION_DENIED ? "permission_denied" : error.code === error.TIMEOUT ? "timeout" : "error");
        },
        GEOLOCATION_OPTIONS
      );
    },
    [stopWatching]
  );

  useEffect(() => stopWatching, [stopWatching]);

  return {
    status,
    position,
    errorMessage,
    requestCurrentPosition,
    startWatching,
    stopWatching
  };
}
