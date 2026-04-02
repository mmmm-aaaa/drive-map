# drive-map

`実装計画-v1.md` に沿った MVP 実装です。

## 開発（Docker）

1. `.env.example` を `.env` としてコピーし、必要な値を設定
2. `npm run docker:up`
3. フロント: `http://localhost:5173`
4. Worker: `http://localhost:8787`

LLM は既定で OpenRouter の `nvidia/nemotron-3-nano-30b-a3b:free` を使います。必要な最低限の設定は以下です。

- `LLM_API_KEY`: OpenRouter API キー
- `LLM_MODEL`: 既定値は `nvidia/nemotron-3-nano-30b-a3b:free`
- `LLM_API_URL`: 既定値は `https://openrouter.ai/api/v1/chat/completions`
- `GOOGLE_MAPS_API_KEY`: Google Maps Platform API キー
- `VITE_API_PROXY_TARGET`: フロント開発サーバーから API を転送する先。通常ローカルは `http://localhost:8787`

`docker-compose` の Worker はローカル開発に限り `ALLOW_UNPROTECTED_START=true` で起動します。本番では必ず `APP_ORIGIN` と `START_RATE_LIMIT` を設定し、このフラグを `false` のままにしてください。

Docker 開発では `frontend` コンテナに `VITE_API_PROXY_TARGET=http://backend:8787` を自動設定しているため、ブラウザからの `/api/*` リクエストは backend コンテナへプロキシされます。

停止:

- `npm run docker:down`

型チェック（コンテナ内）:

- `npm run docker:typecheck`

## デプロイ

1. `backend` に Cloudflare 用の secret を設定
   - `LLM_API_KEY`
   - `LLM_MODEL`（省略時は `nvidia/nemotron-3-nano-30b-a3b:free`）
   - `LLM_API_URL`（省略時は `https://openrouter.ai/api/v1/chat/completions`）
   - `GOOGLE_MAPS_API_KEY`
2. `npm run deploy`
3. 公開後に `document/公開準備チェックリスト.md` を実施
