import { describe, expect, it } from "vitest";
import {
  createUnsupportedGeolocationFailure,
  mapGeolocationFailure,
  shouldRetryWatchOnGeolocationFailure
} from "../../../frontend/src/lib/geolocation-error";

function createGeolocationError(code: number) {
  return {
    code,
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3
  } as const;
}

describe("geolocation error helpers", () => {
  it("maps permission-denied errors", () => {
    expect(mapGeolocationFailure(createGeolocationError(1))).toEqual({
      status: "permission_denied",
      errorMessage: "位置情報の利用が拒否されました。ブラウザ設定から許可してください。"
    });
  });

  it("maps timeout and unavailable errors to explicit statuses", () => {
    expect(mapGeolocationFailure(createGeolocationError(3))).toEqual({
      status: "timeout",
      errorMessage: "位置情報の取得がタイムアウトしました。通信状況を確認して再試行してください。"
    });

    expect(mapGeolocationFailure(createGeolocationError(2))).toEqual({
      status: "unavailable",
      errorMessage: "現在地を取得できませんでした。屋外で再試行してください。"
    });
  });

  it("creates a consistent failure for unsupported browsers", () => {
    expect(createUnsupportedGeolocationFailure()).toEqual({
      status: "unavailable",
      errorMessage: "このブラウザでは位置情報に対応していません。"
    });
  });

  it("falls back to a generic error for unexpected codes", () => {
    expect(mapGeolocationFailure(createGeolocationError(99))).toEqual({
      status: "error",
      errorMessage: "位置情報の取得に失敗しました。"
    });
  });

  it("only retries watchPosition when the failure is a timeout", () => {
    expect(
      shouldRetryWatchOnGeolocationFailure({
        status: "timeout",
        errorMessage: "位置情報の取得がタイムアウトしました。通信状況を確認して再試行してください。"
      })
    ).toBe(true);

    expect(
      shouldRetryWatchOnGeolocationFailure({
        status: "unavailable",
        errorMessage: "現在地を取得できませんでした。屋外で再試行してください。"
      })
    ).toBe(false);
  });
});
