export const START_NAVIGATION_STATUSES = [
  "ok",
  "no_match",
  "validation_failed",
  "upstream_error"
] as const;

export type StartNavigationStatus = (typeof START_NAVIGATION_STATUSES)[number];

export const NAVIGATION_MACHINE_STATES = [
  "idle",
  "requesting_permission",
  "ready_to_start",
  "starting_navigation",
  "navigating",
  "off_route",
  "arrived",
  "error"
] as const;

export type NavigationMachineState = (typeof NAVIGATION_MACHINE_STATES)[number];
