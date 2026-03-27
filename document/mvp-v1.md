# MVP v1 記録

更新日: 2026-03-27

## 1. この文書の目的

この会話で合意した `実装計画-v1.md` を実装した結果を、実装意図とあわせて固定する。  
後続の修正時に「なぜこの構成か」を見失わないための記録である。

## 2. MVP v1 の到達点

MVP v1 は、以下を満たす状態まで実装済み。

- スマホブラウザで位置情報取得フローを開始できる
- 希望時間（30分〜30時間）と有料道路可否を入力できる
- `POST /api/navigation/start` で LLM → Places → Routes を通したルート生成ができる
- `POST /api/navigation/start` は `APP_ORIGIN` と rate limit 保護が無い状態では fail-closed で拒否する
- 目的地名を UI に表示せず、テキスト+矢印で案内できる
- しきい値（800/600/400/200/100/50/まもなく）で案内更新できる
- 逸脱判定（ヒステリシス付き）と復帰判定ができる
- 到着判定（最終 step 終端 50m 以内）ができる
- 音声案内（対応ブラウザ）と Screen Wake Lock が動作する
- セキュリティヘッダを API レスポンスに付与している
- `POST /api/navigation/start` の hard timeout 時は、応答だけでなく下流の外部 API 呼び出しにも abort を伝播させる
- 位置取得失敗時のエラー種別（`permission_denied` / `timeout` / `unavailable` / `error`）をフロント内部で区別して扱っている
- `watchPosition()` 失敗時は案内状態を `error` へ遷移させる

## 3. 実装構成

### 3.1 モノレポ構成

- `frontend`: React + TypeScript + Vite
- `backend`: Hono + TypeScript + Cloudflare Workers
- `shared`: API契約/型/定数
- `tests`: unit / integration（Vitest）

### 3.2 ローカル開発

Docker 前提で運用する。

- `docker-compose.yml` + `Dockerfile.dev` を採用
- backend コンテナはローカル開発に限り `ALLOW_UNPROTECTED_START=true` を明示して起動する
- `.dockerignore` で `.env` を build context から除外している
- 主要コマンド:
  - `npm run docker:up`
  - `npm run docker:down`
  - `npm run docker:typecheck`
  - `npm run docker:test`

## 4. API 実装状況

### 4.1 `GET /api/health`

- 正常応答 (`status: ok`) を返す
- セキュリティヘッダが付与される

### 4.2 `POST /api/navigation/start`

- 入力検証（緯度経度、時間範囲、型）
- `content-type` / `origin` 検証
  - `APP_ORIGIN` が未設定なら `503`
  - `Origin` ヘッダ欠落は `403`
  - `Origin` 不一致は `403`
- body size 制限（2KB）
- rate limit binding
  - `START_RATE_LIMIT` binding が無ければ fail-closed で `503`
  - ローカル開発時のみ `ALLOW_UNPROTECTED_START=true` で例外的に許可
  - rate limit 超過は `429`
- hard timeout（8秒）
  - request timeout 時は `504`
  - timeout / client disconnect の abort を下流の LLM / Places / Routes 呼び出しへ伝播する
- client disconnect 時は `408`
- 状態別応答:
  - `ok`
  - `no_match`
  - `validation_failed`
  - `upstream_error`
- 目的地候補の到達圏見積もりは、LLM プロンプトと Places の `locationBias.radius` で共通ロジックを使用している
- ルート所要時間の許容判定は厳密値で行い、差分表示用の分数は切り上げで返している

## 5. フロント実装状況

- 状態機械:
  - `idle`
  - `requesting_permission`
  - `ready_to_start`
  - `starting_navigation`
  - `navigating`
  - `off_route`
  - `arrived`
  - `error`
- 画面:
  - 権限取得
  - 条件入力
  - 案内
  - エラー
- 位置取得フック:
  - `getCurrentPosition()` の失敗結果を構造化して呼び出し元へ返す
  - `watchPosition()` の失敗をナビ状態へ反映する
- セッション状態:
  - ナビ中断時とエラー解除時に、`route` / 現在 step / 案内文 / 逸脱カウントを共通リセット関数で初期化する
- 案内文の既定値:
  - 「そのまま進んでください。」「元のルートに戻ってください。」「目的地付近に到着しました。安全な場所に停車してください。」を共通定数化している
- 法務導線:
  - `/legal/privacy.html`
  - `/legal/terms.html`
- Google attribution 表示: 案内画面に `Map data © Google`

## 6. テスト実装状況

Vitest で以下を実装済み。

- Unit:
  - しきい値ロジック
  - 逸脱判定補助ロジック
  - 位置取得エラーマッピング
  - 位置座標バリデーション
  - API 入力スキーマ
  - LLM 出力スキーマ
  - ログマスキング
  - 到達圏見積もりロジック
  - ルート時間差判定
- Integration:
  - `start` API の `ok` / `no_match` / `validation_failed`
  - `start` API の `Origin` 欠落拒否
  - `start` API の rate limit binding 未設定時 fail-closed
  - `start` API の hard timeout 時 abort 伝播
  - `health` とセキュリティヘッダ

実行結果（最新）:

- `docker compose run --rm backend npm run test` 成功（10 files / 31 tests）
- `docker compose run --rm backend npm run typecheck` 成功
- `docker compose run --rm backend npm run build` 成功

## 7. MVP v1 でやらないこと（維持）

以下は v1 非対象のまま。

- PWA / オフライン / バックグラウンド継続
- ロック画面中の案内継続
- 逸脱時の再ルーティング
- ルート復元/永続保存
- ログイン/履歴管理
- 地図 UI 表示

## 8. リリース前の手動作業

リポジトリ外で必要な作業。

- Cloudflare secret/vars 設定
  - `SAKURA_AI_API_KEY`
  - `SAKURA_AI_MODEL`
  - `GOOGLE_MAPS_API_KEY`
  - `APP_ORIGIN`
  - `ALLOW_UNPROTECTED_START=false`
- Cloudflare Worker binding 設定
  - `START_RATE_LIMIT`
- Cloudflare zone-level rate limiting rule 設定
  - 初期値: `1 req / 10s / IP`
- 実機確認（iPhone Safari / Android Chrome）

公開前チェックは `公開準備チェックリスト.md` を使用する。
