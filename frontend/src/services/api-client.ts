import type { StartNavigationRequest, StartNavigationResponse } from "@drive-map/shared";

export class ApiClientError extends Error {
  readonly status: number;
  readonly response: StartNavigationResponse | null;

  constructor(status: number, message: string, response: StartNavigationResponse | null = null) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.response = response;
  }
}

export async function startNavigation(request: StartNavigationRequest): Promise<StartNavigationResponse> {
  const response = await fetch("/api/navigation/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(request)
  });

  const payload = (await response.json().catch(() => null)) as StartNavigationResponse | null;

  if (!payload) {
    throw new ApiClientError(response.status, "レスポンスの解析に失敗しました。");
  }

  if (!response.ok) {
    if (payload.status === "validation_failed") {
      return payload;
    }
    if (payload.status === "upstream_error") {
      throw new ApiClientError(response.status, payload.message, payload);
    }
    if (payload.status === "no_match") {
      return payload;
    }
    throw new ApiClientError(response.status, "ナビ開始に失敗しました。", payload);
  }

  return payload;
}
