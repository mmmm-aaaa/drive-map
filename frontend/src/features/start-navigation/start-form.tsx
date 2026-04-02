import { MAX_DURATION_MINUTES, MIN_DURATION_MINUTES } from "@drive-map/shared";
import { formatDistance } from "../../lib/format";

const MAX_DURATION_HOURS = Math.floor(MAX_DURATION_MINUTES / 60);

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

/** Clamp total to [MIN_DURATION_MINUTES, MAX_DURATION_MINUTES]; minutes stay in 0..59. */
function normalizeDuration(hours: number, minutes: number): { hours: number; minutes: number } {
  const m = Math.max(0, Math.min(59, Math.round(Number.isFinite(minutes) ? minutes : 0)));
  const h = Math.max(0, Math.min(MAX_DURATION_HOURS, Math.round(Number.isFinite(hours) ? hours : 0)));
  let total = h * 60 + m;
  total = Math.max(MIN_DURATION_MINUTES, Math.min(MAX_DURATION_MINUTES, total));
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

export function StartNavigationForm(props: StartFormProps) {
  const totalMinutes = props.durationHours * 60 + props.durationMinutes;
  const durationError =
    totalMinutes < MIN_DURATION_MINUTES || totalMinutes > MAX_DURATION_MINUTES
      ? `希望時間は ${MIN_DURATION_MINUTES}分〜${MAX_DURATION_MINUTES}分の範囲で入力してください（最短は1時間です）。`
      : null;

  return (
    <section className="panel">
      <h1 className="panel-title">出発条件の入力</h1>
      <p className="panel-text">
        出発地点: {props.currentLat.toFixed(5)}, {props.currentLng.toFixed(5)} (精度 {formatDistance(props.currentAccuracy)})
      </p>
      <div className="form-row">
        <label htmlFor="duration-hours">片道時間（最短1時間）</label>
        <div className="inline-inputs">
          <input
            id="duration-hours"
            type="number"
            min={0}
            max={MAX_DURATION_HOURS}
            step={1}
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
            id="duration-minutes"
            type="number"
            min={0}
            max={59}
            step={1}
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
