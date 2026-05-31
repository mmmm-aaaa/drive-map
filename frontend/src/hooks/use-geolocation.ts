import { useCallback, useEffect, useRef, useState } from "react";
import type { CurrentPosition } from "@drive-map/shared";
import { GEOLOCATION_OPTIONS } from "@drive-map/shared";
import {
  createUnsupportedGeolocationFailure,
  mapGeolocationFailure,
  shouldRetryWatchOnGeolocationFailure,
  type GeolocationFailure,
  type GeolocationFailureStatus
} from "../lib/geolocation-error";

export type GeolocationStatus = "idle" | "requesting" | "ready" | GeolocationFailureStatus;

export type GeolocationRequestResult =
  | {
      ok: true;
      position: CurrentPosition;
    }
  | {
      ok: false;
      failure: GeolocationFailure;
    };

type UseGeolocationResult = {
  status: GeolocationStatus;
  position: CurrentPosition | null;
  errorMessage: string | null;
  requestCurrentPosition: () => Promise<GeolocationRequestResult>;
  startWatching: (onPosition: (position: CurrentPosition) => void, onError?: (failure: GeolocationFailure) => void) => void;
  stopWatching: () => void;
};

const WATCH_GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: GEOLOCATION_OPTIONS.enableHighAccuracy,
  maximumAge: GEOLOCATION_OPTIONS.maximumAge
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

  const applyFailure = useCallback((failure: GeolocationFailure): GeolocationRequestResult => {
    setStatus(failure.status);
    setErrorMessage(failure.errorMessage);
    return {
      ok: false,
      failure
    };
  }, []);

  const requestCurrentPosition = useCallback(async (): Promise<GeolocationRequestResult> => {
    if (!("geolocation" in navigator)) {
      return applyFailure(createUnsupportedGeolocationFailure());
    }

    setStatus("requesting");
    setErrorMessage(null);

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (geoPosition) => {
          const current = toCurrentPosition(geoPosition);
          setPosition(current);
          setStatus("ready");
          setErrorMessage(null);
          resolve({
            ok: true,
            position: current
          });
        },
        (error) => {
          resolve(applyFailure(mapGeolocationFailure(error)));
        },
        GEOLOCATION_OPTIONS
      );
    });
  }, [applyFailure]);

  const startWatching = useCallback(
    (onPosition: (current: CurrentPosition) => void, onError?: (failure: GeolocationFailure) => void) => {
      if (!("geolocation" in navigator)) {
        const failure = createUnsupportedGeolocationFailure();
        applyFailure(failure);
        onError?.(failure);
        return;
      }

      stopWatching();

      const beginWatch = (): void => {
        watchIdRef.current = navigator.geolocation.watchPosition(
          (geoPosition) => {
            const current = toCurrentPosition(geoPosition);
            setPosition(current);
            setStatus("ready");
            setErrorMessage(null);
            onPosition(current);
          },
          (error) => {
            const failure = mapGeolocationFailure(error);
            if (shouldRetryWatchOnGeolocationFailure(failure)) {
              stopWatching();
              beginWatch();
              return;
            }
            applyFailure(failure);
            onError?.(failure);
          },
          WATCH_GEOLOCATION_OPTIONS
        );
      };

      beginWatch();
    },
    [applyFailure, stopWatching]
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
