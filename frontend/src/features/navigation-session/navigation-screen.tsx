import { formatDistance } from "../../lib/format";

type NavigationScreenProps = {
  stateLabel: string;
  instruction: string;
  arrow: string;
  remainingDistanceMeters: number;
  onCancel: () => void;
};

export function NavigationScreen(props: NavigationScreenProps) {
  return (
    <section className="panel navigation-panel">
      <p className="state-chip">{props.stateLabel}</p>
      <p className="arrow">{props.arrow}</p>
      <p className="instruction">{props.instruction}</p>
      <p className="panel-text">次の分岐まで: {formatDistance(props.remainingDistanceMeters)}</p>
      <button type="button" className="button-secondary" onClick={props.onCancel}>
        ナビを中止する
      </button>
      <p className="attribution">Map data © Google</p>
    </section>
  );
}
