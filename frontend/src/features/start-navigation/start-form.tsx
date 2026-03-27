import { MAX_DURATION_MINUTES, MIN_DURATION_MINUTES } from "@drive-map/shared";
import { formatDistance } from "../../lib/format";

type StartFormProps = {
  durationHours: number;
  durationMinutes: number;
  tollRoadsAllowed: boolean;
  currentLat: number;
  currentLng: number;
  currentAccuracy: number;
  loading: boolean;
  speechSupported: boolean;
  speechEnabled: boolean;
  onSpeechEnabledChange: (enabled: boolean) => void;
  onChange: (value: { durationHours: number; durationMinutes: number; tollRoadsAllowed: boolean }) => void;
  onSubmit: () => void;
};

function normalizeDuration(hours: number, minutes: number): { hours: number; minutes: number } {
  const normalizedMinutes = Math.max(0, Math.min(59, minutes));
  const normalizedHours = Math.max(0, Math.min(30, hours));
  return {
    hours: normalizedHours,
    minutes: normalizedMinutes
  };
}

export function StartNavigationForm(props: StartFormProps) {
  const totalMinutes = props.durationHours * 60 + props.durationMinutes;
  const durationError =
    totalMinutes < MIN_DURATION_MINUTES || totalMinutes > MAX_DURATION_MINUTES
      ? `希望時間は ${MIN_DURATION_MINUTES}分〜${MAX_DURATION_MINUTES}分の範囲で入力してください。`
      : null;

  return (
    <section className="panel">
      <h1 className="panel-title">出発条件の入力</h1>
      <p className="panel-text">
        出発地点: {props.currentLat.toFixed(5)}, {props.currentLng.toFixed(5)} (精度 {formatDistance(props.currentAccuracy)})
      </p>
      <div className="form-row">
        <label htmlFor="duration-hours">片道時間</label>
        <div className="inline-inputs">
          <input
            id="duration-hours"
            type="number"
            min={0}
            max={30}
            value={props.durationHours}
            onChange={(event) => {
              const next = normalizeDuration(Number(event.target.value), props.durationMinutes);
              props.onChange({
                durationHours: next.hours,
                durationMinutes: next.minutes,
                tollRoadsAllowed: props.tollRoadsAllowed
              });
            }}
          />
          <span>時間</span>
          <input
            type="number"
            min={0}
            max={59}
            value={props.durationMinutes}
            onChange={(event) => {
              const next = normalizeDuration(props.durationHours, Number(event.target.value));
              props.onChange({
                durationHours: next.hours,
                durationMinutes: next.minutes,
                tollRoadsAllowed: props.tollRoadsAllowed
              });
            }}
          />
          <span>分</span>
        </div>
      </div>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={props.tollRoadsAllowed}
          onChange={(event) => {
            props.onChange({
              durationHours: props.durationHours,
              durationMinutes: props.durationMinutes,
              tollRoadsAllowed: event.target.checked
            });
          }}
        />
        <span>有料道路を使う</span>
      </label>
      {props.speechSupported ? (
        <label className="checkbox-row">
          <input type="checkbox" checked={props.speechEnabled} onChange={(event) => props.onSpeechEnabledChange(event.target.checked)} />
          <span>音声案内を使う</span>
        </label>
      ) : (
        <p className="panel-text muted">このブラウザでは音声案内に対応していません。</p>
      )}
      {durationError ? <p className="panel-error">{durationError}</p> : null}
      <button type="button" className="button-primary" onClick={props.onSubmit} disabled={Boolean(durationError) || props.loading}>
        {props.loading ? "ナビ開始中..." : "ナビ開始"}
      </button>
    </section>
  );
}
