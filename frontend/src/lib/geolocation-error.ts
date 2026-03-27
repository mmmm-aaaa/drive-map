export type GeolocationFailureStatus = "permission_denied" | "timeout" | "unavailable" | "error";

export type GeolocationFailure = {
  status: GeolocationFailureStatus;
  errorMessage: string;
};

type GeolocationErrorLike = Pick<GeolocationPositionError, "code" | "PERMISSION_DENIED" | "POSITION_UNAVAILABLE" | "TIMEOUT">;

export function createUnsupportedGeolocationFailure(): GeolocationFailure {
  return {
    status: "unavailable",
    errorMessage: "このブラウザでは位置情報に対応していません。"
  };
}

export function mapGeolocationFailure(error: GeolocationErrorLike): GeolocationFailure {
  if (error.code === error.PERMISSION_DENIED) {
    return {
      status: "permission_denied",
      errorMessage: "位置情報の利用が拒否されました。ブラウザ設定から許可してください。"
    };
  }

  if (error.code === error.TIMEOUT) {
    return {
      status: "timeout",
      errorMessage: "位置情報の取得がタイムアウトしました。通信状況を確認して再試行してください。"
    };
  }

  if (error.code === error.POSITION_UNAVAILABLE) {
    return {
      status: "unavailable",
      errorMessage: "現在地を取得できませんでした。屋外で再試行してください。"
    };
  }

  return {
    status: "error",
    errorMessage: "位置情報の取得に失敗しました。"
  };
}
