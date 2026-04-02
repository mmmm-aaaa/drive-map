# MVP v1 記録

更新日: 2026-04-02

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
- `watchPosition()` の `timeout` は再監視で継続し、`permission_denied` / `unavailable` / その他エラーは案内状態を `error` へ遷移させる

## 3. 実装構成

### 3.1 モノレポ構成

- `frontend`: React + TypeScript + Vite
- `backend`: Hono + TypeScript + Cloudflare Workers
- `shared`: API契約/型/定数
- `tests`: unit / integration（Vitest）

### 3.2 ローカル開発

Docker 前提で運用する。

- `docker-compose.yml` + `Dockerfile.dev` を採用
- `.env.example` を用意し、ローカル設定は `.env` で与える
- `backend` コンテナでは、repo ルートの `.env` を `/workspace/backend/.dev.vars` として mount し、`wrangler dev` の local secrets として読む
- backend コンテナはローカル開発に限り `ALLOW_UNPROTECTED_START=true` を明示して起動する
- frontend 開発サーバーは `/api/*` を backend へプロキシする
  - Vite の `server.proxy` を使用する
  - 通常のローカル起動では `VITE_API_PROXY_TARGET` の既定値として `http://localhost:8787` を使う
  - Docker 開発では `frontend` コンテナへ `VITE_API_PROXY_TARGET=http://backend:8787` を渡す
- 開発用イメージには `ca-certificates` を入れ、コンテナ内の `wrangler dev` から外部 HTTPS API へ到達できるようにしている
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
- hard timeout（180秒）
  - request timeout 時は `504`
  - route レベルで hard timeout を強制し、timeout / client disconnect の abort を下流の LLM / Places / Routes 呼び出しへ伝播する
- client disconnect 時は `408`
- 状態別応答:
  - `ok`
  - `no_match`
  - `validation_failed`
  - `upstream_error`
- LLM 呼び出しは汎用化されており、設定値で接続先を切り替えられる
  - 現在の既定値は OpenRouter の Chat Completions API
  - 既定 URL は `https://openrouter.ai/api/v1/chat/completions`
  - 既定モデルは `nvidia/nemotron-3-nano-30b-a3b:free`
  - 環境変数は `LLM_API_KEY` / `LLM_MODEL` / `LLM_API_URL` を使用する
  - OpenRouter 向けに `HTTP-Referer` と `X-Title` を付与する
  - OpenRouter には `stream: false` で問い合わせ、通常の JSON レスポンスとして読む
  - `text/event-stream` が返った場合は SSE を逐次パースして JSON が完成した時点で読み切るフォールバックも残している
  - LLM 出力契約は `{"result":"ok","query":"地名や施設名"}` または `{"result":"no_match"}` のみで、複数候補配列や `reason` は使わない
  - LLM の fetch timeout は 30 秒（`LLM_PER_CALL_TIMEOUT_MS`）、レスポンスボディ読み取り timeout は別途 30 秒（`LLM_READ_TIMEOUT_MS`）
  - LLM fetch は 429 / 5xx に対して最大 2 回リトライする（`retries: 2`, `retryDelayMs: 1_000`）
- 候補の再質問フロー
  - 1回の LLM 応答で返す候補地は 1 件のみ
  - 以下の3ケースは「その候補は不採用」とみなし、失敗理由をフィードバックとして LLM に再質問する
    - `place` 未解決
    - `Routes 400` または `route` なし
    - ルート所要時間が希望条件と不一致
  - 再質問の上限は 2 回で、初回を含めた LLM 試行回数は最大 3 回
  - `Google Routes` の `HTTP 400` は fatal な upstream error ではなく、候補不採用として `null` 扱いにする
  - `Google Routes` の `400` 以外の非 `2xx` は upstream error として扱う
  - 再質問ループの先頭で `signal.aborted` を確認し、abort 済みなら即座に中断する
  - 再質問ループは残り時間を追跡し、`handleStartNavigation` から `START_HARD_TIMEOUT_MS` をデッドラインとして受け取る
  - 各リトライ前に `remainingMs < MIN_REMAINING_FOR_RETRY_MS`（15秒）なら再質問をスキップして `no_match` で離脱する
  - 各 LLM 呼び出しの timeout は `min(LLM_PER_CALL_TIMEOUT_MS, 残り時間)` で動的に計算する
- 目的地候補の到達圏見積もりは、LLM プロンプトと Places の `locationBias.radius` で共通ロジックを使用している
  - Places API の `locationBias.circle.radius` は Google の上限 50,000m でクランプしている（`MAX_PLACE_BIAS_RADIUS_METERS = 50_000`）
- `Google Routes` の `X-Goog-FieldMask` では `maneuver` を `routes.legs.steps.navigationInstruction.maneuver` として要求する（`routes.legs.steps.maneuver` は API に存在しない）
- ルート所要時間の許容判定は厳密値で行い、差分表示用の分数は切り上げで返している
  - 許容幅は固定 ±15 分ではなく、`max(15分, 希望時間の20%)` を初期値とし、上限は ±30 分
  - 90 分指定なら許容帯は 72〜108 分、180 分指定なら 150〜210 分として扱う
- LLM prompt では希望時間そのものだけでなく「許容される片道時間帯」を明示する
  - 出発地からの直線距離の目安（「約 X km 圏内」）をプロンプトの制約に含めている
  - 距離感のアンカー例（東京駅発・有料道路あり: 60分→鎌倉/川越、90分→箱根/日光東照宮、180分→軽井沢/伊豆下田）をプロンプトに含めている
  - 再質問時は「もっと近い候補 / もっと遠い候補」を方向付きで返すフィードバックを与える
- `start` 処理では request-scoped な段階ログを出しており、`llm_*` / `places_*` / `routes_*` / `candidate_rejected` / `selection_*` を `requestId` 付きで記録する

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
  - ただし `watchPosition()` の `timeout` は、監視再開で回復できる一時的な失敗として扱い、即座にエラー画面へ落とさない
- セッション状態:
  - ナビ中断時とエラー解除時に、`route` / 現在 step / 案内文 / 逸脱カウントを共通リセット関数で初期化する
- 案内文の既定値:
  - 「そのまま進んでください。」「元のルートに戻ってください。」「目的地付近に到着しました。安全な場所に停車してください。」を共通定数化している
- 法務導線:
  - `/legal/privacy.html`
  - `/legal/terms.html`
- Google attribution 表示: 案内画面に `Map data © Google`
- API 呼び出し:
  - フロントは `fetch("/api/navigation/start")` を使用する
  - 開発時は Vite の `/api` プロキシ経由で backend へ到達させる

## 6. テスト実装状況

Vitest で以下を実装済み。

- Unit:
  - しきい値ロジック
  - 逸脱判定補助ロジック
  - 位置取得エラーマッピング
  - 位置座標バリデーション
  - API 入力スキーマ
  - LLM 出力スキーマ
  - LLM ストリーム timeout
  - ログマスキング
  - 到達圏見積もりロジック
  - ルート時間差判定
  - 目的地選定 prompt
- Integration:
  - `start` API の `ok` / `no_match` / `validation_failed`
  - `start` API の `Origin` 欠落拒否
  - `start` API の rate limit binding 未設定時 fail-closed
  - `start` API の per-call timeout で LLM fetch が中断されること（502）
  - `start` API の per-call timeout でストリーミング LLM レスポンスが中断されること（502）
  - `health` とセキュリティヘッダ

確認済みの実行結果:

- `docker compose run --rm backend npm run test` 成功（10 files / 31 tests）
- `docker compose run --rm backend npm run typecheck` 成功
- `docker compose run --rm backend npm run build` 成功
- `docker compose run --rm backend npm run test -- tests/unit/backend/llm-chat.test.ts tests/unit/backend/validate-route-duration.test.ts tests/unit/backend/destination-selection-prompt.test.ts tests/unit/frontend/geolocation-error.test.ts tests/integration/backend/navigation-start.test.ts` 成功（2026-04-02, 5 files / 19 tests）
- `docker compose run --rm backend npm run typecheck -w frontend` 成功（2026-04-02）
- `docker compose run --rm backend npm run typecheck -w backend` 成功（2026-04-02）

補足:

- 2026-03-31 以降に、LLM 出力契約・OpenRouter ストリーミング受信・timeout 値・候補再質問フローを変更している
- 2026-04-02 に、LLM ストリームの body 読み取りにも総時間上限を適用した
  - 従来は headers 受信後の `text/event-stream` 本文読み取りに個別 timeout が無く、`POST /api/navigation/start` が長時間 `starting_navigation` のまま見えることがあった
  - 実測ログでは `places` / `routes` は数百 ms で終わっており、遅延の大半は LLM 応答時間と再質問ループで発生していた
  - LLM 出力形式不正や Routes API 仕様不一致が主因ではなく、1 回目候補の所要時間不一致による再試行と、その後の長い LLM 応答が主因だった
  - 既定モデルを `qwen/qwen3.6-plus-preview:free` から `z-ai/glm-4.5-air:free` に変更した
  - 実機ログで 80 秒付近の timeout が継続したため、LLM 個別 timeout を 120 秒へ延長した
- 同日に、候補地の時間ズレが大きく出るケースに対応するため以下を調整した
  - LLM prompt に許容時間帯を明記し、近すぎる候補 / 遠すぎる候補を避ける指示を追加
  - duration mismatch の再質問フィードバックを方向付きに変更し、「もっと近い候補」「もっと遠い候補」を明示
  - 所要時間の許容幅を `max(15分, 希望時間の20%)`・上限 30 分の動的計算に変更
- 同日に、ナビ開始直後に `watchPosition()` の `timeout` でエラー画面へ落ちるケースへ対応した
  - 初回の `getCurrentPosition()` では従来どおり `timeout: 10000` を使う
  - 継続監視の `watchPosition()` では timeout を強制せず、timeout が返っても再監視して継続する
- 同日に以下のバグ修正を適用している
  - `MAX_PLACE_BIAS_RADIUS_METERS` を `300_000` → `50_000` に変更（Google Places API の `locationBias.circle.radius` 上限超過で HTTP 400）
  - Routes API の `X-Goog-FieldMask` で `routes.legs.steps.maneuver` → `routes.legs.steps.navigationInstruction.maneuver` に修正（存在しないフィールドパスで HTTP 400）
  - レスポンス型定義・読み取り箇所で `maneuver` を `navigationInstruction` 配下に移動
  - `START_HARD_TIMEOUT_MS` を `90_000` → `180_000` に変更（LLM リトライ時にタイムアウトに到達する問題）
  - 再質問ループ先頭で `signal.aborted` チェックを追加
- 同日に LLM timeout 構造の再設計と既定モデルの変更を実施した
  - 根本原因の特定: `z-ai/glm-4.5-air:free` に 30 秒アイドルタイムアウトの既知バグがあり（[vercel/ai#12949](https://github.com/vercel/ai/issues/12949)）、SSE ヘッダー返却後にトークン生成が 30 秒以上沈黙する現象が発生していた。実測ログで `llm_first_chunk_received` が一度も出力されず、ヘッダー到着後にストリームが完全停止していたことから確認した
  - LLM 個別 timeout を 120 秒 → 30 秒（`LLM_PER_CALL_TIMEOUT_MS`）に短縮した。`max_tokens: 64` のタスクで応答に 30 秒以上かかる場合はキューイング問題であり、待っても改善しないため
  - fetch timeout（接続〜ヘッダー受信）とレスポンスボディ読み取り timeout を分離した。従来は 1 つの timeout を fetch とボディ読み取りで共有しており、ヘッダー受信に 10 秒かかるとボディ読み取りに 20 秒しか残らなかった。変更後は `LLM_PER_CALL_TIMEOUT_MS`（30秒）と `LLM_READ_TIMEOUT_MS`（30秒）で独立した予算を持つ
  - 再質問ループに残り時間チェックを追加した。`selectDestination` に `deadlineMs` 引数を追加し、`handleStartNavigation` から `START_HARD_TIMEOUT_MS`（180秒）をデッドラインとして渡す。各リトライ前に `remainingMs < MIN_REMAINING_FOR_RETRY_MS`（15秒）なら再質問をスキップして `no_match` で早期離脱する。各 LLM 呼び出しの timeout は `min(LLM_PER_CALL_TIMEOUT_MS, 残り時間)` で動的に計算する
  - LLM fetch に 429 / 5xx リトライを追加した。`fetchWithTimeout` の既存リトライ機構を有効化し、`retries: 2`、`retryDelayMs: 1_000` とした。無料モデルで 429 が頻発する問題に対応
  - `stream: true` → `stream: false` に変更した。`max_tokens: 64` の応答（約 30 バイトの JSON）にストリーミングは不要であり、ストリーミングを使うと前述のアイドルタイムアウトバグに晒される。非ストリーミングでは `readStandardResponse` で完結する
  - 既定モデルを `z-ai/glm-4.5-air:free` → `nvidia/nemotron-3-nano-30b-a3b:free` に変更した。`z-ai/glm-4.5-air:free` は Z.ai インフラのスケーリング問題（[zai-org/GLM-4.5#133](https://github.com/zai-org/GLM-4.5/issues/133)）と 30 秒アイドルタイムアウトバグにより安定稼働が困難であったため
  - LLM prompt に出発地からの直線距離の目安と距離感のアンカー例を追加した。初回の所要時間不一致を減らし、リトライ回数を抑制するため
  - 非ストリーミング応答の生ボディをデバッグログ（`llm_raw_body`）として出力するようにした
  - `shared/src/constants/navigation.ts` に `LLM_PER_CALL_TIMEOUT_MS = 30_000`、`LLM_READ_TIMEOUT_MS = 30_000`、`MIN_REMAINING_FOR_RETRY_MS = 15_000`、`RETRY_SAFETY_MARGIN_MS = 5_000` を追加した
  - `selectDestinationByLlm` の timeout を引数化した（デフォルト `LLM_PER_CALL_TIMEOUT_MS`）
  - integration test のタイムアウトシナリオを 2 件に分割した: per-call timeout による LLM fetch 中断（502）と、per-call timeout によるストリーミングレスポンス中断（502）
  - `drive-estimate.test.ts` の place bias 上限は Google Places の半径上限（50,000m）に合わせた期待値（50_000）で固定した
- 後続変更後の full `docker:test` / `docker build` は、この記録では未再確認

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
  - `LLM_API_KEY`
  - `LLM_MODEL`
  - `LLM_API_URL`
  - `GOOGLE_MAPS_API_KEY`
  - `APP_ORIGIN`
  - `ALLOW_UNPROTECTED_START=false`
- Cloudflare Worker binding 設定
  - `START_RATE_LIMIT`
- Cloudflare zone-level rate limiting rule 設定
  - 初期値: `1 req / 10s / IP`
- 実機確認（iPhone Safari / Android Chrome）

公開前チェックは `公開準備チェックリスト.md` を使用する。
