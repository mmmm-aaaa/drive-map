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
    <section className="navigation-screen">
      <div className="nav-status">
        <span className="state-chip">
          <span className="state-dot" />
          {props.stateLabel}
        </span>
      </div>

      <div className="arrow-container">
        <div className="arrow-glow">
          <span className="arrow">{props.arrow}</span>
        </div>
      </div>

      <div className="nav-info">
        <p className="instruction">{props.instruction}</p>
        <p className="distance-readout">次の分岐まで {formatDistance(props.remainingDistanceMeters)}</p>
      </div>

      <div className="nav-bottom">
        <button type="button" className="nav-cancel-btn" onClick={props.onCancel}>
          ナビを中止する
        </button>
        <p className="attribution">Map data © Google</p>
      </div>
    </section>
  );
}
