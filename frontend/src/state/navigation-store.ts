import type { CurrentPosition, DistanceAnnouncementBucket, NavigationMachineState, NavigationRoute } from "@drive-map/shared";

export type NavigationStore = {
  machineState: NavigationMachineState;
  route: NavigationRoute | null;
  position: CurrentPosition | null;
  currentStepIndex: number;
  currentInstruction: string;
  remainingStepDistanceMeters: number;
  currentBucket: DistanceAnnouncementBucket | null;
  offRouteConsecutiveCount: number;
  stepSwitchConsecutiveCount: number;
  errorMessage: string | null;
};

type NavigationSessionState = Pick<
  NavigationStore,
  "route" | "currentStepIndex" | "currentInstruction" | "remainingStepDistanceMeters" | "currentBucket" | "offRouteConsecutiveCount" | "stepSwitchConsecutiveCount"
>;

export function createNavigationSessionState(overrides: Partial<NavigationSessionState> = {}): NavigationSessionState {
  return {
    route: null,
    currentStepIndex: 0,
    currentInstruction: "現在地を取得してください。",
    remainingStepDistanceMeters: 0,
    currentBucket: null,
    offRouteConsecutiveCount: 0,
    stepSwitchConsecutiveCount: 0,
    ...overrides
  };
}

export function createInitialNavigationStore(): NavigationStore {
  return {
    machineState: "idle",
    position: null,
    errorMessage: null,
    ...createNavigationSessionState()
  };
}
