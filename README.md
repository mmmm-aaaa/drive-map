# drive-map

`実装計画-v1.md` に沿った MVP 実装です。

## 開発（Docker）

1. `.env.example` を `.env` としてコピーし、必要な値を設定
2. `npm run docker:up`
3. フロント: `http://localhost:5173`
4. Worker: `http://localhost:8787`

停止:

- `npm run docker:down`

型チェック（コンテナ内）:

- `npm run docker:typecheck`

## デプロイ

1. `backend` に Cloudflare 用の secret を設定
2. `npm run deploy`
3. 公開後に `document/公開準備チェックリスト.md` を実施
