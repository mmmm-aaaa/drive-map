type ErrorScreenProps = {
  message: string;
  onRetry: () => void;
};

export function ErrorScreen(props: ErrorScreenProps) {
  return (
    <section className="panel">
      <h1 className="panel-title">エラーが発生しました</h1>
      <p className="panel-error">{props.message}</p>
      <button type="button" className="button-primary" onClick={props.onRetry}>
        入力画面に戻る
      </button>
    </section>
  );
}
