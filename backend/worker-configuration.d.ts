interface WorkerRateLimitResult {
  success: boolean;
}

interface WorkerRateLimitBinding {
  limit(options: { key: string }): Promise<WorkerRateLimitResult>;
}

interface Env {
  ASSETS: Fetcher;
  LLM_API_KEY: string;
  LLM_MODEL: string;
  LLM_API_URL: string;
  GOOGLE_MAPS_API_KEY: string;
  APP_ORIGIN?: string;
  ALLOW_UNPROTECTED_START?: string;
  START_RATE_LIMIT?: WorkerRateLimitBinding;
}
