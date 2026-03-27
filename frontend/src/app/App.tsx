import { useMemo } from "react";
import { ErrorScreen } from "../features/error-state/error-screen";
import { NavigationScreen } from "../features/navigation-session/navigation-screen";
import { PermissionScreen } from "../features/permission/permission-screen";
import { StartNavigationForm } from "../features/start-navigation/start-form";
import { useNavigationMachine } from "../hooks/use-navigation-machine";

function stateLabel(state: ReturnType<typeof useNavigationMachine>["store"]["machineState"]): string {
  switch (state) {
    case "starting_navigation":
      return "ルートを準備中";
    case "off_route":
      return "ルート逸脱";
    case "arrived":
      return "到着";
    case "navigating":
      return "案内中";
    default:
      return "待機中";
  }
}

export function App() {
  const navigation = useNavigationMachine();
  const { store } = navigation;

  const isPermissionView = store.machineState === "idle" || store.machineState === "requesting_permission";
  const isFormView = store.machineState === "ready_to_start" || store.machineState === "starting_navigation";
  const isNavigationView = store.machineState === "navigating" || store.machineState === "off_route" || store.machineState === "arrived";

  const navigationStatusLabel = useMemo(() => stateLabel(store.machineState), [store.machineState]);

  return (
    <main className="app-root">
      <div className="screen-stack">
        {isPermissionView ? (
          <PermissionScreen
            loading={store.machineState === "requesting_permission"}
            errorMessage={navigation.geolocationError}
            onRequestPermission={() => {
              void navigation.requestPermission();
            }}
          />
        ) : null}

        {isFormView && store.position ? (
          <StartNavigationForm
            durationHours={navigation.formState.durationHours}
            durationMinutes={navigation.formState.durationMinutes}
            tollRoadsAllowed={navigation.formState.tollRoadsAllowed}
            currentLat={store.position.lat}
            currentLng={store.position.lng}
            currentAccuracy={store.position.accuracy}
            loading={store.machineState === "starting_navigation"}
            speechSupported={navigation.speechSupported}
            speechEnabled={navigation.speechEnabled}
            onSpeechEnabledChange={navigation.setSpeechEnabled}
            onChange={navigation.setFormState}
            onSubmit={() => {
              void navigation.startNavigationSession();
            }}
          />
        ) : null}

        {isNavigationView ? (
          <NavigationScreen
            stateLabel={navigationStatusLabel}
            instruction={store.currentInstruction}
            arrow={navigation.arrow}
            remainingDistanceMeters={store.remainingStepDistanceMeters}
            onCancel={() => {
              void navigation.cancelNavigationSession();
            }}
          />
        ) : null}

        {store.machineState === "error" ? <ErrorScreen message={store.errorMessage ?? "不明なエラーです。"} onRetry={navigation.clearError} /> : null}
      </div>
      <footer className="legal-footer">
        <a href="/legal/privacy.html" target="_blank" rel="noreferrer">
          プライバシーポリシー
        </a>
        <span className="legal-separator">|</span>
        <a href="/legal/terms.html" target="_blank" rel="noreferrer">
          利用規約
        </a>
      </footer>
    </main>
  );
}
