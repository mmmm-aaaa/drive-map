import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CurrentPosition, RouteStep } from "@drive-map/shared";
import {
  ARRIVAL_INSTRUCTION,
  ARRIVAL_DISTANCE_METERS,
  DEFAULT_STEP_INSTRUCTION,
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  OFF_ROUTE_INSTRUCTION
} from "@drive-map/shared";
import { distanceBetweenMeters, minDistanceToPolylineMeters } from "../lib/distance";
import { angularDifferenceDegrees, bearingDegrees } from "../lib/heading";
import { buildInstruction, maneuverToArrow } from "../lib/format";
import { toDistanceBucket } from "../lib/navigation-threshold";
import { nextOffRouteConsecutiveCount, onRouteThresholdMeters } from "../lib/off-route";
import { decodePolyline } from "../lib/polyline";
import { startNavigation } from "../services/api-client";
import { createInitialNavigationStore, createNavigationSessionState, type NavigationStore } from "../state/navigation-store";
import { useGeolocation } from "./use-geolocation";
import { useSpeech } from "./use-speech";
import { useWakeLock } from "./use-wake-lock";

type StartFormState = {
  durationHours: number;
  durationMinutes: number;
  tollRoadsAllowed: boolean;
};

type NavigationMachineResult = {
  store: NavigationStore;
  geolocationStatus: ReturnType<typeof useGeolocation>["status"];
  geolocationError: string | null;
  formState: StartFormState;
  setFormState: (next: StartFormState) => void;
  requestPermission: () => Promise<void>;
  startNavigationSession: () => Promise<void>;
  cancelNavigationSession: () => Promise<void>;
  clearError: () => void;
  arrow: string;
  speechSupported: boolean;
  speechEnabled: boolean;
  setSpeechEnabled: (enabled: boolean) => void;
};

function totalDurationMinutes(form: StartFormState): number {
  return form.durationHours * 60 + form.durationMinutes;
}

function stepPolyline(step: RouteStep): ReturnType<typeof decodePolyline> {
  return decodePolyline(step.polyline);
}

export function useNavigationMachine(): NavigationMachineResult {
  const [store, setStore] = useState<NavigationStore>(createInitialNavigationStore);
  const [formState, setFormState] = useState<StartFormState>({
    durationHours: 1,
    durationMinutes: 30,
    tollRoadsAllowed: true
  });

  const storeRef = useRef(store);
  storeRef.current = store;

  const {
    status: geolocationStatus,
    errorMessage: geolocationError,
    requestCurrentPosition,
    startWatching,
    stopWatching
  } = useGeolocation();
  const {
    supported: speechSupported,
    enabled: speechEnabled,
    setEnabled: setSpeechEnabled,
    initializeWithUserActivation,
    speak,
    resetLastSpoken
  } = useSpeech();
  const { requestWakeLock, releaseWakeLock } = useWakeLock();

  const patchStore = useCallback((updater: (current: NavigationStore) => NavigationStore) => {
    setStore((current) => {
      const next = updater(current);
      storeRef.current = next;
      return next;
    });
  }, []);

  const evaluatePosition = useCallback(
    (position: CurrentPosition) => {
      const currentStore = storeRef.current;
      if (!currentStore.route) {
        return;
      }

      const route = currentStore.route;
      if (route.steps.length === 0) {
        patchStore((current) => ({
          ...current,
          machineState: "error",
          errorMessage: "ルート情報が不正です。もう一度ナビを開始してください。"
        }));
        return;
      }
      const routePolyline = route.polyline ? decodePolyline(route.polyline) : route.steps.flatMap((step) => stepPolyline(step));
      const routeDistance = minDistanceToPolylineMeters(position, routePolyline);
      const onRouteThreshold = onRouteThresholdMeters(position.accuracy);

      const finalStepIndex = route.steps.length - 1;
      const finalStep = route.steps[finalStepIndex];
      if (!finalStep) {
        return;
      }
      const finalDistance = distanceBetweenMeters(position, finalStep.endLocation);

      if (
        finalDistance <= ARRIVAL_DISTANCE_METERS &&
        (currentStore.currentStepIndex >= finalStepIndex || currentStore.machineState === "off_route")
      ) {
        patchStore((current) => ({
          ...current,
          machineState: "arrived",
          position,
          currentInstruction: ARRIVAL_INSTRUCTION,
          remainingStepDistanceMeters: finalDistance,
          currentBucket: "soon",
          offRouteConsecutiveCount: 0,
          stepSwitchConsecutiveCount: 0
        }));
        void releaseWakeLock();
        return;
      }

      if (currentStore.machineState === "off_route") {
        if (routeDistance <= onRouteThreshold) {
          patchStore((current) => ({
            ...current,
            machineState: "navigating",
            position,
            offRouteConsecutiveCount: 0
          }));
        } else {
          patchStore((current) => ({
            ...current,
            position,
            currentInstruction: OFF_ROUTE_INSTRUCTION,
            remainingStepDistanceMeters: routeDistance
          }));
        }
        return;
      }

      const offRouteCount = nextOffRouteConsecutiveCount(routeDistance, position.accuracy, currentStore.offRouteConsecutiveCount);
      if (offRouteCount >= 2) {
        patchStore((current) => ({
          ...current,
          machineState: "off_route",
          position,
          offRouteConsecutiveCount: offRouteCount,
          currentInstruction: OFF_ROUTE_INSTRUCTION,
          remainingStepDistanceMeters: routeDistance,
          currentBucket: null
        }));
        speak(OFF_ROUTE_INSTRUCTION, "off_route");
        return;
      }

      let nextStepIndex = currentStore.currentStepIndex;
      const currentStep = route.steps[nextStepIndex];
      if (!currentStep) {
        return;
      }
      const nextStep = route.steps[nextStepIndex + 1];
      let stepSwitchConsecutiveCount = currentStore.stepSwitchConsecutiveCount;

      if (nextStep) {
        const currentStepDistance = minDistanceToPolylineMeters(position, stepPolyline(currentStep));
        const nextStepDistance = minDistanceToPolylineMeters(position, stepPolyline(nextStep));
        const nearBranch = distanceBetweenMeters(position, currentStep.endLocation) <= 30;
        const nearerToNext = nextStepDistance + 5 < currentStepDistance;

        let headingSupportsNext = false;
        if (Number.isFinite(position.heading)) {
          const heading = position.heading as number;
          const currentBearing = bearingDegrees(currentStep.startLocation, currentStep.endLocation);
          const nextBearing = bearingDegrees(nextStep.startLocation, nextStep.endLocation);
          headingSupportsNext = angularDifferenceDegrees(heading, nextBearing) + 10 < angularDifferenceDegrees(heading, currentBearing);
        }

        if (nearerToNext || nearBranch) {
          stepSwitchConsecutiveCount += 1;
        } else {
          stepSwitchConsecutiveCount = 0;
        }

        if (nearBranch || (nearerToNext && (stepSwitchConsecutiveCount >= 2 || headingSupportsNext))) {
          nextStepIndex += 1;
          stepSwitchConsecutiveCount = 0;
        }
      }

      const step = route.steps[nextStepIndex];
      if (!step) {
        return;
      }
      const remainingDistance = distanceBetweenMeters(position, step.endLocation);
      const bucket = toDistanceBucket(remainingDistance);
      const instruction = buildInstruction(step, bucket);
      const shouldUpdateInstruction = currentStore.currentStepIndex !== nextStepIndex || currentStore.currentBucket !== bucket;

      patchStore((current) => ({
        ...current,
        machineState: "navigating",
        position,
        currentStepIndex: nextStepIndex,
        remainingStepDistanceMeters: remainingDistance,
        currentInstruction: shouldUpdateInstruction ? instruction : current.currentInstruction,
        currentBucket: shouldUpdateInstruction ? bucket : current.currentBucket,
        offRouteConsecutiveCount: offRouteCount,
        stepSwitchConsecutiveCount
      }));

      if (shouldUpdateInstruction) {
        speak(instruction, `${nextStepIndex}:${bucket}`);
      }
    },
    [patchStore, speak, releaseWakeLock]
  );

  useEffect(() => {
    if (store.machineState !== "navigating" && store.machineState !== "off_route") {
      stopWatching();
      return;
    }

    startWatching(
      (position) => {
        evaluatePosition(position);
      },
      (failure) => {
        patchStore((current) => ({
          ...current,
          machineState: "error",
          errorMessage: failure.errorMessage
        }));
        void releaseWakeLock();
      }
    );

    return () => {
      stopWatching();
    };
  }, [evaluatePosition, patchStore, startWatching, stopWatching, store.machineState, releaseWakeLock]);

  const requestPermission = useCallback(async () => {
    patchStore((current) => ({
      ...current,
      machineState: "requesting_permission",
      errorMessage: null
    }));

    const result = await requestCurrentPosition();
    if (result.ok) {
      patchStore((current) => ({
        ...current,
        machineState: "ready_to_start",
        position: result.position,
        errorMessage: null
      }));
      return;
    }

    patchStore((current) => ({
      ...current,
      machineState: "error",
      errorMessage: result.failure.errorMessage
    }));
  }, [patchStore, requestCurrentPosition]);

  const startNavigationSession = useCallback(async () => {
    const current = storeRef.current;
    const currentPosition = current.position;
    if (!currentPosition) {
      patchStore((state) => ({
        ...state,
        machineState: "error",
        errorMessage: "先に現在地を取得してください。"
      }));
      return;
    }

    const requestedDuration = totalDurationMinutes(formState);
    if (requestedDuration < MIN_DURATION_MINUTES || requestedDuration > MAX_DURATION_MINUTES) {
      patchStore((state) => ({
        ...state,
        machineState: "error",
        errorMessage: `希望時間は ${MIN_DURATION_MINUTES}分〜${MAX_DURATION_MINUTES}分で入力してください（最短1時間）。`
      }));
      return;
    }

    initializeWithUserActivation("ナビを開始します。");

    patchStore((state) => ({
      ...state,
      machineState: "starting_navigation",
      errorMessage: null
    }));

    try {
      const response = await startNavigation({
        origin: {
          lat: currentPosition.lat,
          lng: currentPosition.lng
        },
        durationMinutes: requestedDuration,
        tollRoadsAllowed: formState.tollRoadsAllowed
      });

      if (response.status !== "ok") {
        patchStore((state) => ({
          ...state,
          machineState: "error",
          errorMessage: response.message
        }));
        return;
      }

      const route = response.route;
      const initialStep = route.steps[0];
      const initialInstruction = response.ui.initialInstruction || initialStep?.instruction || DEFAULT_STEP_INSTRUCTION;
      const initialRemainingDistance = initialStep ? distanceBetweenMeters(currentPosition, initialStep.endLocation) : 0;
      const initialBucket = initialStep ? toDistanceBucket(initialRemainingDistance) : null;

      patchStore((state) => ({
        ...state,
        machineState: "navigating",
        route,
        currentStepIndex: 0,
        currentInstruction: initialInstruction,
        remainingStepDistanceMeters: initialRemainingDistance,
        currentBucket: initialBucket,
        errorMessage: null,
        offRouteConsecutiveCount: 0,
        stepSwitchConsecutiveCount: 0
      }));

      if (speechEnabled) {
        speak(initialInstruction, "initial_instruction");
      }

      await requestWakeLock();
    } catch (error) {
      patchStore((state) => ({
        ...state,
        machineState: "error",
        errorMessage: error instanceof Error ? error.message : "ナビ開始に失敗しました。"
      }));
    }
  }, [formState, patchStore, speechEnabled, speak, initializeWithUserActivation, requestWakeLock]);

  const cancelNavigationSession = useCallback(async () => {
    stopWatching();
    resetLastSpoken();
    await releaseWakeLock();

    patchStore((current) => ({
      ...current,
      machineState: "ready_to_start",
      ...createNavigationSessionState({
        currentInstruction: "ナビを終了しました。"
      })
    }));
  }, [patchStore, resetLastSpoken, stopWatching, releaseWakeLock]);

  const clearError = useCallback(() => {
    patchStore((current) => ({
      ...current,
      machineState: current.position ? "ready_to_start" : "idle",
      errorMessage: null,
      ...createNavigationSessionState({
        currentInstruction: current.position ? "出発条件を入力してください。" : "現在地を取得してください。"
      })
    }));
  }, [patchStore]);

  const arrow = useMemo(() => {
    if (!store.route) {
      return "↑";
    }
    return maneuverToArrow(store.route.steps[store.currentStepIndex]?.maneuver);
  }, [store.currentStepIndex, store.route]);

  return {
    store,
    geolocationStatus,
    geolocationError,
    formState,
    setFormState,
    requestPermission,
    startNavigationSession,
    cancelNavigationSession,
    clearError,
    arrow,
    speechSupported,
    speechEnabled,
    setSpeechEnabled
  };
}
