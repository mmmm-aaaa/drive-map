type PermissionScreenProps = {
  loading: boolean;
  errorMessage: string | null;
  onRequestPermission: () => void;
};

function LoadingDots() {
  return (
    <span className="loading-dots">
      <span />
      <span />
      <span />
    </span>
  );
}

export function PermissionScreen(props: PermissionScreenProps) {
  return (
    <section className="panel">
      <div className="panel-icon" aria-hidden="true">📍</div>
      <h1 className="panel-title">現在地の利用許可</h1>
      <p className="panel-text">
        このアプリはナビ案内のために現在地を利用します。許可後に出発条件を入力できます。
      </p>
      {props.errorMessage ? <p className="panel-error">{props.errorMessage}</p> : null}
      <button type="button" className="button-primary" onClick={props.onRequestPermission} disabled={props.loading}>
        {props.loading ? <LoadingDots /> : "現在地を取得する"}
      </button>
    </section>
  );
}
