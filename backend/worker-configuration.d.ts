interface WorkerRateLimitResult {
  success: boolean;
}

interface WorkerRateLimitBinding {
  limit(options: { key: string }): Promise<WorkerRateLimitResult>;
}

interface Env {
  ASSETS: Fetcher;
  SAKURA_AI_API_KEY: string;
  SAKURA_AI_MODEL: string;
  GOOGLE_MAPS_API_KEY: string;
  APP_ORIGIN?: string;
  ALLOW_UNPROTECTED_START?: string;
  START_RATE_LIMIT?: WorkerRateLimitBinding;
}
