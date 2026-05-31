# MVP v1 記録

更新日: 2026-04-12（本文ベースは 2026-04-02）。**本ファイル末尾の「9. 追記」**に、同日以降の実装・会話に基づく追記がある。

## 1. この文書の目的

この会話で合意した `実装計画-v1.md` を実装した結果を、実装意図とあわせて固定する。  
後続の修正時に「なぜこの構成か」を見失わないための記録である。

## 2. MVP v1 の到達点

MVP v1 は、以下を満たす状態まで実装済み。

- スマホブラウザで位置情報取得フローを開始できる
- 希望片道時間（**合計 60 分〜 30 時間、すなわち 60〜1800 分**）と有料道路可否を入力できる
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
  - `durationMinutes` は **整数**で **`MIN_DURATION_MINUTES`（60）以上 `MAX_DURATION_MINUTES`（1800）以下**（`shared/src/constants/navigation.ts` を唯一の基準とする）
  - **60 分刻みである必要はない**（例: 61 分・90 分は有効。**59 分は却下**）
- `content-type` / `origin` 検証
  - `APP_ORIGIN` が未設定なら `503`
  - `Origin` ヘッダ欠落は `403`
  - `Origin` 不一致は `403`
- body size 制限（2KB）
- rate limit binding
  - `START_RATE_LIMIT` binding が無ければ fail-closed で `503`
  - ローカル開発時のみ `ALLOW_UNPROTECTED_START=true` で例外的に許可
  - rate limit 超過は `429`
- hard timeout（180秒 → **300 秒に変更済み、9.9 節参照**）
  - request timeout 時は `504`
  - route レベルで hard timeout を強制し、timeout / client disconnect の abort を下流の LLM / Places / Routes 呼び出しへ伝播する
- client disconnect 時は `408`
- 状態別応答:
  - `ok`
  - `no_match`
  - `validation_failed`
  - `upstream_error`
- LLM 呼び出しは汎用化されており、設定値で接続先を切り替えられる
  - 現在の既定値は Google AI Studio の OpenAI 互換 Chat Completions API
  - 既定 URL は `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
  - 既定モデルは `gemini-3.1-flash-lite-preview`
  - 環境変数は `LLM_API_KEY` / `LLM_MODEL` / `LLM_API_URL` を使用する
  - Google AI Studio には Bearer token で認証する
  - `stream: false` で問い合わせ、通常の JSON レスポンスとして読む
  - `text/event-stream` が返った場合は SSE を逐次パースして JSON が完成した時点で読み切るフォールバックも残している
  - LLM 出力契約は `{"result":"ok","query":"地名や施設名"}` または `{"result":"no_match"}` のみで、複数候補配列や `reason` は使わない
  - LLM の fetch timeout は 30 秒（`LLM_PER_CALL_TIMEOUT_MS`）、レスポンスボディ読み取り timeout は別途 30 秒（`LLM_READ_TIMEOUT_MS`）（→ **各 60 秒に変更済み、9.9 節参照**）
  - LLM fetch は 429 / 5xx に対して最大 2 回リトライする（`retries: 2`, `retryDelayMs: 1_000`）
- 候補の再質問フロー
  - 1回の LLM 応答で返す候補地は 1 件のみ
  - 以下の3ケースは「その候補は不採用」とみなし、失敗理由をフィードバックとして LLM に再質問する
    - `place` 未解決
    - `Routes 400` または `route` なし
    - ルート所要時間が希望条件と不一致
  - 再質問の上限は 2 回で、初回を含めた LLM 試行回数は最大 3 回（現行でも同じ）
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
  - 出発地からの直線距離の目安（「約 X km 圏内」）をプロンプトの制約に含めている（`estimateReachableDistanceKm` と同じ計算根拠）
  - 希望時間は **60 分以上**であり、**時間＋分の合計として解釈され得る**旨（例として 61 分・90 分）をプロンプトの制約文に含めている
  - 距離感のアンカーは **東京駅発・有料道路あり**を前提とした例で、プロンプト上は概ね次の行として含まれる（実装は `backend/src/prompts/destination-selection.ts` を正とする）:
    - 見出しに、希望分数が表の間にある場合は **距離感を補間して向きを合わせる**よう指示する
    - 60 分 → 約 50〜70km: 「鎌倉」「川越」
    - 90 分 → 約 70〜100km: 「箱根湯本」「横浜みなとみらい」（参考）
    - 120 分 → 約 80〜120km: 「箱根」「日光東照宮」
    - 180 分 → 約 150〜200km: 「軽井沢」「伊豆下田」
  - 「希望より明らかに短く着く候補（同一街区など）」は避ける指示を含めている
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
- 片道時間入力（`frontend/src/features/start-navigation/start-form.tsx`）:
  - 「**時間**」「**分**」の 2 つの数値入力で指定し、内部では合計分 `hours * 60 + minutes` を算出する
  - 変更時に合計を **`MIN_DURATION_MINUTES`（60）以上 `MAX_DURATION_MINUTES`（1800）以下**へ正規化する（この範囲外の合計はクリップされ、分は常に 0〜59）
  - UI ラベル上、最短が 1 時間である旨を表示する
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
  - API 入力スキーマ（合計分 60〜1800、59 分以下の拒否、61 分の受理など）
  - LLM 出力スキーマ
  - LLM ストリーム timeout
  - ログマスキング
  - 到達圏見積もりロジック
  - ルート時間差判定
  - 目的地選定 prompt
- Integration:
  - `start` API の `ok` / `no_match` / `validation_failed`
  - `start` API の `Origin` 欠落拒否
  - `start` API の `APP_ORIGIN` 正規化（末尾スラッシュ / パス付き設定）
  - `start` API の rate limit binding 未設定時 fail-closed
  - `start` API で `LLM_MODEL` / `LLM_API_URL` 未設定時に env default が適用されること
  - `start` API の per-call timeout で LLM fetch が中断されること（502）
  - `start` API の per-call timeout でストリーミング LLM レスポンスが中断されること（502）
  - `health` とセキュリティヘッダ
- Manual:
  - `watchPosition()` timeout 継続確認（実機）
    - 目的: 一時的 timeout で `error` 画面に遷移せず、監視再開後に位置更新が復帰すること
    - 手順:
      1. iPhone Safari / Android Chrome でナビを開始し、位置更新が動作することを確認
      2. 一時的 timeout を誘発（建物内深部移動、位置情報オフ/オンなど）
      3. timeout 後に `error` 画面へ遷移しないことを確認
      4. GPS 環境回復後に位置更新が再開することを確認

確認済みの実行結果:

- 上記リストは **過去の実行スナップショット**である。**現在の正**はリポジトリルートで `npm test` / `npm run typecheck` を実行した結果とする。
- **追記時点（2026-04-02）**: ルートで `npm test` は **12 test files / 40 tests** 成功。`npm run typecheck`（`shared` → `frontend` → `backend` の順）は成功。
- 参考（歴史）: `docker compose run --rm backend npm run test` 成功（10 files / 31 tests）などの記録は、当時のスコープ・件数であり現状と一致しない場合がある。

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
- 同日以降の追記は **「9. 追記」**を参照（`npm test` / `typecheck` の現行件数も同節で記載）

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
- Cloudflare Worker binding 設定
  - `START_RATE_LIMIT`
- Cloudflare zone-level rate limiting rule 設定
  - 初期値: `1 req / 10s / IP`
- 実機確認（iPhone Safari / Android Chrome）

公開前チェックは `公開準備チェックリスト.md` を使用する。

## 9. 追記（2026-04-02 — 本ファイル初版後の実装・会話の記録）

本章は **初版記述の後**に判明・変更した事項のみを列挙する。数値・ファイルパスはリポジトリの実装を基準にした（推測ではない）。

### 9.1 希望片道時間の下限と入力形式

- **`MIN_DURATION_MINUTES` は 60**（以前の文書にあった「30 分〜」は現状と不一致）。最短は **1 時間**。
- **`MAX_DURATION_MINUTES` は 1800**（30 時間）。変更なし。
- API スキーマ（`backend/src/schema/navigation-start.ts`）は上記の **整数の範囲チェックのみ**で、**60 分刻み（1 時間単位）の制約は付けていない**。
- フロントは **「時間」「分」両方**の入力欄を持ち、合計分を正規化して送信する（「5. フロント実装状況」参照）。

### 9.2 LLM 向けプロンプト（目的地選定）

- `backend/src/prompts/destination-selection.ts` において:
  - 希望時間が **60 分以上であること**、および **時・分の合計として 61 分や 90 分などが来得ること**を制約文に明示している。
  - 距離感の見出しで、**アンカー行の間の分数は補間して向きを合わせる**指示を出している。
  - アンカー例は **60 / 90 / 120 / 180 分**の行として記載（90 分の例示地名は **箱根湯本・横浜みなとみらい** 等。120 分行に **箱根・日光東照宮**）。**本文 4.2 節の旧記述「90 分→箱根/日光東照宮」のみ**は現行プロンプトと一致しないため、**4.2 節を本章・ソースに合わせて修正済み**。

### 9.3 Places の `locationBias` 半径

- `backend/src/domain/drive-estimate.ts` の **`MAX_PLACE_BIAS_RADIUS_METERS` は 50_000**（メートル）。Google Places API の `locationBias.circle.radius` が大きすぎると **HTTP 400** となる事象に対処するため、過去に **300_000 から 50_000 へ変更**した（「4.2 `POST /api/navigation/start`」の補足および git 履歴参照）。
- **LLM プロンプトの直線 km 目安**（`estimateReachableDistanceKm`）とは独立しており、**長い希望時間でも検索バイアリスの円半径は最大 50 km** に留まる（プロダクト上のトレードオフとして残存）。

### 9.4 テスト

- **ルート**で `npm test`（Vitest）: **12 files / 40 tests** 成功（追記確認時）。
- `tests/unit/backend/drive-estimate.test.ts`: 長時間指定時の `estimatePlaceBiasRadiusMeters` の期待値は **50_000**（上限クリップ）。
- `tests/unit/shared/navigation-start-schema.test.ts`: **59 分は拒否**、**61 分は受理**を検証。

### 9.5 本ファイルとの役割分担

- **コンフィグの正**は常に `shared/src/constants/navigation.ts` および上記各ソースファイルとする。
- 本 `mvp-v1.md` の本文（章 1〜8）は当初の実装記録を多く含むため、**数値やプロンプト文言は「9. 追記」とソースで突き合わせる**こと。

### 9.6 リファクタリングおよびセキュリティ監査（2026-04-03）

5 並列のサブエージェント（バックエンドコード品質、セキュリティ脆弱性、フロントエンドコード品質、共有型+テスト品質、設定/インフラ監査）で監査を実施し、結果を統合した。修正はバッチ 1〜5 で段階的に適用した。全変更後に `npm run typecheck`（shared → frontend → backend）成功、`npm test` で **12 files / 40 tests** 成功を確認した。

#### バッチ 1: 設定・セキュリティ即時修正

- **CSP ヘッダの修正**（`backend/src/app.ts`）
  - `font-src` に `https://fonts.gstatic.com` を追加（`frontend/index.html` が Google Fonts を読み込んでいるが、CSP で許可されておらずフォントがブロックされる本番障害があった）
  - `style-src` に `https://fonts.googleapis.com` を追加（同上、CSS 取得の許可）
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` を追加（HSTS）
  - `X-Frame-Options: DENY` を追加（クリックジャッキング防止の多層防御）
- **`.gitignore` に `**/.dev.vars` を追加**
  - docker-compose が `.env` を `backend/.dev.vars` にマウントする構成のため、手動作成された `.dev.vars` が誤ってコミットされるリスクを排除
- **`wrangler.jsonc` から `ALLOW_UNPROTECTED_START` を削除**
  - Cloudflare ダッシュボードで `"true"` に変更するとレートリミットが完全に無効化されるリスクがあったため、本番デプロイ設定から除外した
  - `ALLOW_UNPROTECTED_START` はローカル開発専用（`docker-compose.yml` の `--var ALLOW_UNPROTECTED_START:true` および `.dev.vars`）として残存
  - `backend/worker-configuration.d.ts` の `Env` 型定義では引き続き `ALLOW_UNPROTECTED_START?: string` を宣言している（ローカル開発で参照するため）

#### バッチ 2: コード正確性の修正

- **フロントのフックオブジェクト同一性問題を修正**（`frontend/src/hooks/use-navigation-machine.ts`）
  - `useSpeech()` と `useWakeLock()` はレンダーごとに新しいオブジェクトを返していたため、`useCallback` の依存配列に `speech` / `wakeLock` 全体を入れると毎レンダーで `evaluatePosition` が再生成され、位置監視の `useEffect` が再発火して `stopWatching()` → `startWatching()` がループしていた
  - 修正: `useSpeech()` / `useWakeLock()` の返り値をオブジェクトのまま保持するのではなく、`speak`、`releaseWakeLock` 等の個別コールバックを分割代入し、依存配列に個別の安定したコールバック参照を列挙する方式に変更
- **LLM レスポンスボディ読み取りタイムアウトが呼び出し元の残り時間を無視する問題を修正**（`backend/src/services/llm-chat.ts`）
  - 従来: `remainingReadTimeoutMs = Math.max(1, LLM_READ_TIMEOUT_MS)`（常に 30 秒固定）
  - 修正後: `remainingReadTimeoutMs = Math.max(1, Math.min(LLM_READ_TIMEOUT_MS, callerRemainingMs))`（`callerRemainingMs = effectiveTimeoutMs - fetchElapsedMs`）
  - fetch フェーズの経過時間を差し引き、呼び出し元のデッドラインを超えて読み取りが続く問題を解消
- **`env` マージパターンの簡素化**（`backend/src/routes/navigation-start.ts`）
  - 従来: `parseEnv(c.env)` の結果を `c.env` にスプレッドして新オブジェクトを作り、それを `env` として下流に渡していた。ランタイムバインディング（`ASSETS`、`START_RATE_LIMIT`）が新オブジェクトに含まれない fragile な構造だった
  - 修正: `parseEnv(c.env)` をバリデーション専用に使い、以降は一貫して `c.env` を渡す
- **LLM 出力フィードバックループのサニタイズ**（`backend/src/domain/select-destination.ts`）
  - LLM の `query` 出力がサニタイズなしにフィードバックプロンプトと Google Places API に渡されていた（Zod による 120 文字制限はあるが文字種制限はなし）
  - `sanitizeQuery()` 関数を追加。Unicode 文字（`\p{L}`）、数字（`\p{N}`）、空白、ハイフン、中点、読点、句点、括弧のみを許可するホワイトリスト方式（`/[^\p{L}\p{N}\s\-・、。（）()「」]/gu` で除去）
  - サニタイズ後に空文字列になった場合は `candidate_rejected`（`reason: "empty_after_sanitize"`）として不採用にし、再質問を行う
- **デッドコード除去と型名重複の解消**（`backend/src/services/llm-chat.ts`）
  - `logLlmStage` → `return parsed` の周囲にあった到達不可能な `try/catch` を除去
  - `SelectDestinationInput`（`domain/select-destination.ts` と名前が衝突）を `LlmChatInput` にリネーム

#### バッチ 3: 防御的強化

- **`readStandardResponse` の `JSON.parse` を try/catch で保護**（`backend/src/services/llm-chat.ts`）
  - LLM API が不正な JSON を返した場合、素の `SyntaxError` が汎用 500 として漏れていた
  - `UpstreamServiceError("openrouter", "LLM API returned invalid JSON")` を投げるようにした
  - デバッグログ `llm_raw_body` の `preview` を 500 文字から 200 文字に短縮した（情報漏洩リスク軽減）
- **env スキーマの簡素化**（`backend/src/schema/env.ts`）
  - `APP_ORIGIN: z.string().url().optional().or(z.literal("")).optional()` → `z.string().url().min(1).optional().or(z.literal(""))`（二重 `.optional()` を除去）
- **`watchPosition` の無限リトライループを修正**（`frontend/src/hooks/use-geolocation.ts`）
  - 従来: `shouldRetryWatchOnGeolocationFailure` が `true`（= timeout）のとき `stopWatching()` → `beginWatch()` を無条件に再帰し、GPS タイムアウトが続く環境で無限ループになっていた
  - 修正: `watchRetryCount` カウンターを導入し最大 3 回（`MAX_WATCH_RETRIES = 3`）でリトライを打ち切る。成功時にカウンターをリセットする
- **`speechSynthesis.speak()` の前に `cancel()` を追加**（`frontend/src/hooks/use-speech.ts`）
  - 従来は新しい発話が前の発話の完了を待たずにキューに追加され、遅延した端末で音声が蓄積する問題があった
  - `speak()` コールバック内で `window.speechSynthesis.cancel()` を呼んでからキューに追加する方式に変更
- **`useSpeech` のアンマウント時クリーンアップを追加**（`frontend/src/hooks/use-speech.ts`）
  - `useEffect` のクリーンアップ関数で `window.speechSynthesis.cancel()` を呼ぶようにした。ナビ終了やコンポーネントアンマウント時に音声が残り続ける問題を解消
- **API レスポンスの型安全性強化**（`frontend/src/services/api-client.ts`）
  - 従来: `(await response.json().catch(() => null)) as StartNavigationResponse | null` の unsafe キャスト
  - 修正: レスポンスを `unknown` として受け取り、`isStartNavigationStatus()` で `status` フィールドを実行時に検証してからキャストする

#### バッチ 4: インフラ整備

- **GitHub Actions CI を追加**（`.github/workflows/ci.yml`）
  - `push`（`main`、`codex/*` ブランチ）および `pull_request`（`main`）でトリガー
  - ステップ: `npm ci` → `npm run build -w shared` → `npm run typecheck` → `npm test` → `npm audit --audit-level=high`（`continue-on-error: true`）
- **本番用 `Dockerfile` を新規作成**
  - マルチステージビルド: `base`（`npm ci`）→ `build`（shared → frontend → backend を順にビルド）→ `production`（`npm ci --omit=dev` + ビルド成果物のみコピー）
  - devDependencies、テストファイル、ソースコードは本番イメージに含まれない
- **`Dockerfile.dev` を `npm ci` に変更**
  - `npm install` → `npm ci` に変更し `package-lock.json` もコピーするようにした（再現可能ビルド）
  - 不要な `COPY document ./document` を削除
- **`wrangler.jsonc` に環境分離を追加**
  - `env.staging`（Worker 名: `drive-map-staging`）と `env.production`（Worker 名: `drive-map-production`）のブロックを追加
  - `wrangler deploy --env staging` / `--env production` で別々の Worker にデプロイ可能

#### バッチ 5: リファクタリング

- **`logStage` ヘルパーの統合**
  - `backend/src/services/llm-chat.ts` と `backend/src/domain/select-destination.ts` にあった同一の `logStage` / `logLlmStage` 関数を削除し、`backend/src/lib/logger.ts` に `logStage` を追加して両ファイルからインポートする方式に統合
- **`response.ts` の型キャスト排除**（`backend/src/lib/response.ts`）
  - `c.json(body as never, status)` → `c.json(body, status)` に変更し、`body` の型を `Record<string, unknown>` にして型チェックが効くようにした
- **`selectDestination` のパラメータグループ化**（`backend/src/domain/select-destination.ts`）
  - 5 個の位置引数（`input`, `env`, `signal?`, `requestId?`, `deadlineMs?`）から、オプション引数を `SelectDestinationOptions` オブジェクト（`{ signal?, requestId?, deadlineMs? }`）にまとめた
  - 呼び出し元（`backend/src/handlers/start-navigation.ts`）も `{ signal, requestId, deadlineMs: START_HARD_TIMEOUT_MS }` の形式に変更
  - `exactOptionalPropertyTypes: true` に対応するため各プロパティに `| undefined` を明示
- **`AppBindings` 型の共有化**（`backend/src/app.ts`）
  - `type AppBindings` を `export` に変更
  - `backend/src/routes/health.ts` と `backend/src/routes/navigation-start.ts` で `Hono<{ Bindings: Env; Variables: { requestId: string } }>` と手書きしていた箇所を `Hono<AppBindings>` に統一
- **`LoadingDots` コンポーネントの重複排除**
  - `frontend/src/features/permission/permission-screen.tsx` と `frontend/src/features/start-navigation/start-form.tsx` に同一定義のあった `LoadingDots` を `frontend/src/components/loading-dots.tsx` に抽出し、両ファイルからインポートに変更
- **Vite の `loadEnv` プレフィックス修正**（`frontend/vite.config.ts`）
  - `loadEnv(mode, process.cwd(), "")` → `loadEnv(mode, process.cwd(), "VITE_")`
  - 第 3 引数 `""` は全環境変数（`LLM_API_KEY` 等含む）をビルドプロセスに露出させていた。`"VITE_"` に限定しサプライチェーン攻撃面を縮小
- **`shared/package.json` に `typescript` devDependency を追加**
  - `"typescript": "^5.8.3"` を追加し、ワークスペースホイスティングへの暗黙の依存を解消

#### 本章で記録した変更に伴う、本文（章 1〜8）との差異

- **2 節**: 「セキュリティヘッダを API レスポンスに付与している」は引き続き正だが、ヘッダセットが拡張されている（HSTS、X-Frame-Options 追加、CSP の font-src / style-src 変更）
- **2 節**: 「`watchPosition()` の `timeout` は再監視で継続」は引き続き正。2026-04-03 の回帰修正で、再監視の上限（3 回）は撤廃され、timeout は再監視を継続する挙動へ戻した（`9.7` 参照）
- **3.2 節**: 「`Dockerfile.dev` を採用」は引き続き正だが、本番用 `Dockerfile`（マルチステージ）が追加されている。`Dockerfile.dev` は `npm install` → `npm ci` に変更済み
- **4.2 節**: 「`LLM_READ_TIMEOUT_MS` は別途 30 秒」は引き続き正だが、呼び出し元の残り時間との `min` で動的に計算されるようになった
- **4.2 節**: 候補の再質問フローにおいて、LLM 出力の `query` はサニタイズ後にフィードバックおよび Places API に渡されるようになった
- **8 節**: 「`ALLOW_UNPROTECTED_START=false`」の Cloudflare secret/vars 設定は不要。`ALLOW_UNPROTECTED_START` は `wrangler.jsonc` の `vars` から除外されたため、本番では設定しない（`backend/src/lib/rate-limit.ts` が `START_RATE_LIMIT` binding 未設定で fail-closed となる設計は維持）
- **8 節**: `wrangler.jsonc` に `env.staging` / `env.production` が追加されたため、デプロイ時は `wrangler deploy --env production` 等で環境を指定する

### 9.7 退行修正（2026-04-03, 本会話での追加修正）

本節は **9.6 の監査・修正後**に判明した回帰を、実装ベースで追記する。

- **env default 適用の回帰を修正**（`backend/src/env.ts`, `backend/src/routes/navigation-start.ts`）
  - 問題: `parseEnv(c.env)` を呼ぶだけで戻り値を捨てる経路があり、`LLM_MODEL` / `LLM_API_URL` の default が下流呼び出しへ反映されないケースがあった
  - 修正:
    - `parseEnv()` は `return { ...bindings, ...envSchema.parse(bindings) }` とし、runtime binding を保持しつつ default を適用
    - `navigation-start` では `parsedEnv = parseEnv(c.env)` を作り、`checkStartRateLimit` / `handleStartNavigation` へ `parsedEnv` を渡す

- **`APP_ORIGIN` 比較の正規化不足を修正**（`backend/src/routes/navigation-start.ts`）
  - 問題: `APP_ORIGIN` を文字列完全一致で比較しており、末尾スラッシュやパス付き設定（例: `https://example.com/`, `https://example.com/app`）で `Origin` と不一致になり得た
  - 修正: `getConfiguredOrigin()` で `new URL(raw).origin` を用いて `scheme://host[:port]` へ正規化して比較

- **`watchPosition` timeout のリトライ上限を撤廃**（`frontend/src/hooks/use-geolocation.ts`）
  - 問題: 一時的な GPS timeout でも 3 回で `error` へ遷移する回帰があった
  - 修正: `watchRetryCount` / `MAX_WATCH_RETRIES` を削除し、timeout は再監視を継続する（他の失敗種別のみ `error` へ遷移）

- **既定モデル名の記述・設定を統一**（`docker-compose.yml`, `README.md`）
  - `z-ai/glm-4.5-air:free` の残存箇所を `nvidia/nemotron-3-nano-30b-a3b:free` へ統一

- **`Dockerfile` の用途を明記し、workspace 解決を補強**（`Dockerfile`）
  - ファイル先頭に「Cloudflare Workers 本番 runtime ではなく、CI の build verification 用 artifact」である旨を追記
  - `production` ステージで `frontend/package.json` も `COPY` し、workspace 依存解決の整合性を確保
  - `CMD` は追加せず（ランタイム用途ではないため）

- **回帰テストを追加/補強**（`tests/integration/backend/navigation-start.test.ts`）
  - 追加:
    - `LLM_MODEL` / `LLM_API_URL` 未指定時に default が適用されること
    - `APP_ORIGIN` が末尾スラッシュ付き・パス付きでも `200` で通ること
  - 補強:
    - 「ハングした LLM 呼び出しの timeout」テストで `fetch` モックを単発 `mockImplementationOnce` から継続 `mockImplementation` へ変更し、リトライ経路でも timeout 挙動を正しく検証できるようにした

- **この会話での実行確認（事実）**
  - `npm run test -- tests/integration/backend/navigation-start.test.ts` を実行し、**11 tests 全件成功**を確認
  - 同会話内で編集対象ファイルに対し lints を確認し、**エラーなし**を確認

### 9.8 ロジック改修実装と再質問回数の変更（2026-04-12）

本節は `document/ロジック改修計画.md` の実装結果と、その後の本会話での追加変更を、**現行ソースで確認できる事実だけ**に絞って記録する。

- **出発座標ベースの地域別距離推定へ変更**（`backend/src/domain/drive-estimate.ts`）
  - 地域区分は `tokyo_core` / `tokyo_outer` / `chukyo_core` / `kansai_core` / `regional_city` / `rural_default` の 6 種類。
  - `resolveDriveRegionProfile()` で bbox 判定し、判定優先順は `tokyo_core` → `tokyo_outer` → `chukyo_core` → `kansai_core` → `regional_city` → `rural_default`。
  - `kansai_core` と `chukyo_core` の間は `lng 136.45–136.55` を両方から除外し、**端点の `136.45` / `136.55` もどちらの core にも含めない**実装になっている。
  - 到達距離は一律平均速度ではなく、`origin + durationMinutes + tollRoadsAllowed` を入力とする段階式へ変更された。
  - 希望時間帯は `short`（<=180 分）/ `mid`（181〜360 分）/ `long`（361 分以上）の 3 バンド。
  - 速度は、最初の 180 分に地域別速度、その後 180 分に全国共通中距離速度、それ以降に全国共通長距離速度を使って積み上げる。
  - `buildDriveEstimateContext()` が `regionProfile` / `regionLabelJa` / `estimatedDistanceKm` / `durationBand` をまとめて返す。

- **Places の `locationBias` も origin ベース推定へ追従**（`backend/src/services/google-places.ts`）
  - `estimatePlaceBiasRadiusMeters(origin, durationMinutes, tollRoadsAllowed)` を使う実装へ変更された。
  - Places の `locationBias.circle.radius` は引き続き `50_000m` 上限でクランプする。
  - integration test では、`POST /api/navigation/start` 経由で Places Text Search に送る `locationBias.circle.radius` と中心座標を検証している（`tests/integration/backend/navigation-start.test.ts`）。

- **ルート所要時間の許容幅は 3 段階になった**（`backend/src/domain/validate-route-duration.ts`）
  - `60〜180 分`: `max(15分, 希望時間の20%)`、上限 `30 分`
  - `181〜360 分`: `max(30分, 希望時間の25%)`、上限 `75 分`
  - `361〜1800 分`: `max(45分, 希望時間の30%)`、上限 `180 分`
  - `buildDurationWindowMinutes()` / `validateRouteDuration()` の返却形式自体は維持されている。

- **LLM プロンプトは地域・時間適合優先へ変更**（`backend/src/prompts/destination-selection.ts`）
  - プロンプトには、出発座標、地域ラベル、希望片道時間、許容時間帯、推定直線距離、有料道路可否、前回候補フィードバックを含める。
  - 「全国的に有名かどうかは重視しない」「ローカルな具体地名・施設名でもよい」「Places Text Search で解決しやすい具体名を返す」を明示している。
  - 旧来の東京駅基準の固定アンカー例（鎌倉、川越、箱根湯本など）は現行プロンプトから削除された。
  - JSON 契約の説明は `{"result":"ok","query":"三島市"}` のような**実在の具体名**を例示し、`query` にプレースホルダーや説明文を書かないよう明示している。

- **候補不一致時の再質問フィードバックが強化された**（`backend/src/domain/select-destination.ts`）
  - `isPlaceholderDestinationQuery()` により、`地名や施設名` のような説明用プレースホルダー出力は不採用として再質問する。
  - duration mismatch 時のフィードバックには、候補名、実際の片道分数、希望時間との差分分数、許容帯、次に欲しい方向（`もっと近い候補` / `もっと遠い候補`）を含める。
  - このフィードバックは `backend/src/services/llm-chat.ts` を通じて次回の LLM プロンプトへ `feedback` として渡される。

- **目的地の再質問上限を変更**（`backend/src/domain/select-destination.ts`）
  - `LLM_REASK_LIMIT` は `LLM_MODEL_SCHEDULE.length - 1` によって決まり、現行では **2**。
  - そのため、初回候補を含めた LLM 試行回数は **最大 3 回**である。
  - 候補が空、プレースホルダー、Places 未解決、Routes 未取得、所要時間不一致のいずれでも再質問ループを継続し得る。残り時間が `MIN_REMAINING_FOR_RETRY_MS` 未満なら途中で打ち切って `no_match` を返す挙動は維持されている。

- **テスト追加・更新**（`tests/unit/backend/*`, `tests/integration/backend/navigation-start.test.ts`, `tests/live/navigation-live.test.ts`）
  - unit test:
    - 地域判定、境界、段階式距離推定、Places 半径上限、duration band、推定コンテキスト
    - 3 段階の時間許容幅
    - 新しい目的地選定プロンプト
    - プレースホルダー query 判定
  - integration test:
    - LLM プロンプトに地域ラベル・推定直線距離・長時間許容帯が入ること
    - Places Text Search に origin ベースの `locationBias` 半径が送られること
    - プレースホルダー query が続く場合に、`POST /api/navigation/start` が **3 回試行後に `no_match`** を返すこと
  - live test:
    - `tests/live/navigation-live.test.ts` を追加
    - `RUN_LIVE_NAVIGATION_TESTS=true` と実 API キーがあるときだけ有効
    - 固定座標 6 地点 × 希望時間 90 / 240 / 600 分で実 API を通す
    - ログには `fixture`, `regionProfile`, `requestedDuration`, `estimatedDistanceKm`, `allowedWindow`, `apiStatus`, `llmQuery`, `resolvedPlaceName`, `routeDurationMinutes`, `diffMinutes`, `toleranceMinutes`, `okInBand` を出力する

- **本ファイル本文との読み替え**
  - **4.2 節**の「再質問の上限は 2 回で、初回を含めた LLM 試行回数は最大 3 回」は、現行実装でも **そのまま正**と読む。
  - **4.2 節**の「hard timeout（180秒）」は、現行実装では **300 秒**（`START_HARD_TIMEOUT_MS = 300_000`）に読み替える（9.9 節参照）。
  - **4.2 節**の「LLM の fetch timeout は 30 秒」「レスポンスボディ読み取り timeout は別途 30 秒」は、現行実装では **各 60 秒**に読み替える（9.9 節参照）。
  - **4.2 節**の到達圏見積もり・許容幅・プロンプト記述のうち、一律速度・固定アンカー例・旧許容幅に関する説明は、現行実装では本節の内容を正とする。

### 9.9 LLM モデルフォールバック戦略・累積フィードバック・timeout 変更（2026-04-12, 本会話での追加変更）

本節は **9.8 の実装後**に、同日の本会話で追加・変更した事項を記録する。

#### LLM モデルフォールバックスケジュール

- **attempt ごとに使用する LLM モデルを切り替えるスケジュールを導入した**（`shared/src/constants/navigation.ts`, `backend/src/domain/select-destination.ts`, `backend/src/services/llm-chat.ts`）
  - `LLM_MODEL_GEMINI_FLASH_LITE = "gemini-3.1-flash-lite-preview"`（Google AI Studio の軽量モデル）
  - `LLM_MODEL_SCHEDULE.length` が外側の試行回数を決め、現行では 3 回試行する
  - 実際に送るモデルは `env.LLM_MODEL` を使い、既定構成では 3 回とも `gemini-3.1-flash-lite-preview` を使用する
  - 戦略: 3 回まで同一モデルで候補を探索し、不採用フィードバックを累積して精度を上げる
  - `LLM_REASK_LIMIT` は `LLM_MODEL_SCHEDULE.length - 1` で決定される
- **`selectDestinationByLlm` に `modelOverride` パラメータを追加した**（`backend/src/services/llm-chat.ts`）
  - シグネチャ: `selectDestinationByLlm(env, input, signal?, requestId?, timeoutMs?, modelOverride?)`
  - `modelOverride` が指定された場合、`env.LLM_MODEL` より優先される（`effectiveModel = modelOverride ?? env.LLM_MODEL`）
  - `select-destination.ts` の再質問ループでは、現行構成では `env.LLM_MODEL` を `modelOverride` として渡す
- **段階ログに `model` フィールドを追加した**（`backend/src/domain/select-destination.ts`）
  - `llm_started` イベントに `model: modelForAttempt` を含め、各 attempt でどのモデルが使われたかを記録する

#### 累積フィードバック

- **再質問のフィードバックを単一文字列から履歴配列に変更した**（`backend/src/domain/select-destination.ts`）
  - 従来: `feedback` 変数に最新の不採用理由のみを格納し、次の LLM 呼び出しに渡していた
  - 変更後: `feedbackHistory: string[]` 配列にすべての不採用理由を蓄積し、`feedbackHistory.join("\n")` で結合して渡す
  - これにより、LLM は過去のすべての不採用候補と理由を参照できるようになり、同じ方向に振れ続ける「振動」が抑制される
- **プロンプトのフィードバック表示形式を変更した**（`backend/src/prompts/destination-selection.ts`）
  - 従来: `前回候補のフィードバック: <単一メッセージ>`
  - 変更後: `これまでの候補フィードバック（すべて考慮して次の候補を選ぶこと）:\n<累積メッセージ>`

#### LLM 推定道路距離の追加

- **プロンプトに推定道路距離を追加した**（`backend/src/prompts/destination-selection.ts`）
  - 従来: `出発地からの推定直線距離の目安: 約 X km 圏内を念頭に置くこと（道路距離はこれより長くなる）`
  - 変更後: `出発地からの推定直線距離の目安: 約 X km（推定道路距離: 約 Y km）`（`Y = Math.round(X * 1.3)`）
  - LLM の距離感を補正し、直線距離と実走行距離の乖離による候補ミスマッチを軽減する

#### LLM malformed JSON のリトライ対応

- **LLM が不正な JSON を返した場合をリトライ可能なエラーとして扱うようにした**（`backend/src/domain/select-destination.ts`）
  - 従来: `selectDestinationByLlm` が `UpstreamServiceError` を投げると再質問ループが即座に中断し、`upstream_error` として返却されていた
  - 変更後: `UpstreamServiceError` のうち、`service === "google-ai-studio"` かつ `message` に `"invalid_"` を含むもの（JSON / schema の不正を示す）は、`feedbackHistory` に JSON 形式の修正指示を追加して `continue` する
  - これにより、LLM がマークダウンコードブロック付きの JSON や不完全な JSON を返した場合でも、次の attempt で正しい形式を返す機会が得られる

#### LLM retryable upstream error の再試行対応

- **Google AI Studio の一時的な upstream failure を再質問ループ内で再試行するようにした**（`backend/src/domain/select-destination.ts`）
  - 対象: `HTTP 429`, `HTTP 5xx`, timeout, body read stall, 一時的な fetch failure など
  - 従来: `fetchWithTimeout` の内部リトライ（最大 2 回）が尽きた時点で、最初の attempt でも `upstream_error` で即終了していた
  - 変更後: retryable と判定した `UpstreamServiceError("google-ai-studio", ...)` は `llm_retryable_error` を記録して `continue` し、残っている attempt / model schedule を使って再試行する
  - 最終 attempt まで retryable upstream failure しか得られなかった場合は、従来どおり最終結果は `upstream_error` を返す

#### timeout 定数の変更

- **LLM 関連の timeout 定数を全面的に引き上げた**（`shared/src/constants/navigation.ts`）
  - `START_HARD_TIMEOUT_MS`: `180_000`（3 分）→ `300_000`（5 分）
  - `LLM_PER_CALL_TIMEOUT_MS`: `30_000`（30 秒）→ `60_000`（60 秒）
  - `LLM_READ_TIMEOUT_MS`: `30_000`（30 秒）→ `60_000`（60 秒）
  - `MIN_REMAINING_FOR_RETRY_MS`: `15_000`（15 秒）→ `30_000`（30 秒）
  - `RETRY_SAFETY_MARGIN_MS`: `5_000`（5 秒）→ `10_000`（10 秒）
  - 変更理由: 3 回までの LLM 呼び出しと body read stall を安全に吸収するには、従来の timeout では不足するため

#### Vitest 設定の変更

- **`vitest.config.ts` でルートの `.env` ファイルを自動読み込みするようにした**（`vitest.config.ts`）
  - `loadEnvToRecord()` ヘルパーで `.env` を解析し、`test.env` に渡す
  - `envPrefix: ["LLM_", "GOOGLE_MAPS_", "RUN_LIVE_", "VITE_"]` で必要な環境変数のみを Vitest に公開する
  - これにより、live test 実行時に `.env` の API キーが自動的に利用可能になる

#### live test の rate limit 対応

- **fixture 間に待機時間を挿入した**（`tests/live/navigation-live.test.ts`）
  - `INTER_FIXTURE_WAIT_MS = 20_000`（20 秒）を fixture 切り替え時および rate limit 検出時に挿入
  - OpenRouter free tier の rate limit（リクエスト/分上限）に対応するため
- **rate limit されたリクエストを成功率計算から除外するようにした**（`tests/live/navigation-live.test.ts`）
  - `response.status === 502 && payload.status === "upstream_error"` を rate limit として検出
  - rate limit されたケースは `rateLimited` カウンターに計上し、`tested` カウンターからは除外
  - 全リクエストが rate limit された場合はアサーションをスキップする
  - 成功率の閾値は `MIN_SUCCESS_RATE = 0.5`（テストされたケースの 50% 以上が成功すれば pass）
- **live test のデフォルト LLM_MODEL を Gemini 3.1 Flash Lite に設定した**（`tests/live/navigation-live.test.ts`）
  - `env.LLM_MODEL` のフォールバック値を `"gemini-3.1-flash-lite-preview"` に設定
  - 現行実装では `env.LLM_MODEL` が各 attempt で実際に送られるモデルであり、`LLM_MODEL_SCHEDULE.length` は試行回数の上限を決める

#### テスト

- unit + integration test: **13 files / 66 tests** 成功（本会話確認時）
- live test は rate limit の影響で全件テストが完了していないが、通過した件数では以下の結果を確認した:
  - `nemotron-3-super-120b` 使用時（本会話以前の結果）: 3 件中 2 件成功
    - tokyo_core 90 分: 箱根町芦ノ湖 → 107 分（OK, 1 発成功）
    - tokyo_core 240 分: 長野市 → 200 分（OK, 3 回目成功 — 累積フィードバックが有効に機能）
  - `arcee-ai/trinity-large-preview` 使用時: 1 件中 1 件成功
    - regional_city 600 分: 富士山五合目 → 754 分（OK, 1 発成功）

#### 本ファイル本文との読み替え（9.9 追加分）

- **4.2 節**の `hard timeout（180秒）` は `300 秒` に読み替える。
- **4.2 節**の `LLM の fetch timeout は 30 秒（LLM_PER_CALL_TIMEOUT_MS）` は `60 秒` に読み替える。
- **4.2 節**の `レスポンスボディ読み取り timeout は別途 30 秒（LLM_READ_TIMEOUT_MS）` は `60 秒` に読み替える。
- **4.2 節**の `再質問ループは残り時間を追跡し〜各リトライ前に remainingMs < MIN_REMAINING_FOR_RETRY_MS（15秒）なら` は `30 秒` に読み替える。
- **4.2 節**の `既定モデルは nvidia/nemotron-3-nano-30b-a3b:free` は、現行では `gemini-3.1-flash-lite-preview` に読み替える。ただし実行時のモデル選択は `LLM_MODEL_SCHEDULE` で attempt ごとに決定される。
- **4.2 節**の「失敗理由をフィードバックとして LLM に再質問する」は、現行実装では**すべての不採用理由を累積して渡す**方式に変更されている。
- **9.4 節**の `12 files / 40 tests` は、現行では **13 files / 66 tests** に読み替える。

### 9.10 距離推定ロジックの再調整と有料道路入力の廃止（2026-04-12, 本会話での追加変更）

本節は **9.8 および 9.9 の実装後**に、同日の本会話で追加・変更した事項を記録する。

#### 距離推定ロジックの再調整

- **時間帯フェーズの閾値を短縮**（`backend/src/domain/drive-estimate.ts`）
  - 従来: 最初の 180 分（地域別速度）、180〜360 分（中距離全国速度）、361 分以上（長距離全国速度）
  - 変更後: 最初の 60 分（地域別速度）、60〜180 分（中距離全国速度）、181 分以上（長距離全国速度）
  - 出発後 1 時間程度で高速道路などの幹線に乗れるという実態に合わせ、長距離移動時の推定到達距離が悲観的になりすぎる問題を解消した。
- **有料道路利用時の想定速度（直線 km/h）を引き上げ**（`backend/src/domain/drive-estimate.ts`）
  - `tokyo_core`: 30 → 35
  - `kansai_core`: 40 → 45
  - `chukyo_core`: 45 → 50
  - `regional_city`: 50 → 55
  - `rural_default`: 55 → 60
  - 中距離全国（60〜180分）: 65 → 70
  - （`tokyo_outer` 45、長距離全国 75 は据え置き）
  - これにより、LLMプロンプト上で示される「推定道路距離（直線距離の1.3倍）」が実際の高速道路網の移動距離（平均 90km/h 程度）に合致するようになった。

#### 有料道路利用の固定化と入力廃止

- **フロントエンドの「有料道路を使う」トグルを削除**（`frontend/src/features/start-navigation/start-form.tsx`）
- **API スキーマから `tollRoadsAllowed` を削除**（`backend/src/schema/navigation-start.ts`、`shared/src/api/navigation.ts`）
- **バックエンド内部で `tollRoadsAllowed: true` を固定**（`backend/src/handlers/start-navigation.ts`）
  - `selectDestination` への入力時に常に `tollRoadsAllowed: true` を指定するよう変更し、距離計算や Google Routes API へのリクエストは常に「有料道路利用前提」で動作する。
- **LLM プロンプトへの補足指示追加**（`backend/src/prompts/destination-selection.ts`）
  - `有料道路の利用は許可されています（出発地点から高速道路のインターチェンジが近い場合は所要時間を少し短めに、遠い場合は時間を長めに見積もって候補を選定してください）`
  - 出発地から IC までの下道アクセス距離を LLM 側でも加味させる指示を追加。
- **テストコードの追従**
  - 上記の入力パラメータ変更に合わせ、各種 unit test, integration test, live test 内の `tollRoadsAllowed` パラメータ指定を削除（内部で `true` 固定のモック等は維持）し、全テストの通過を確認。

#### 本ファイル本文との読み替え（9.10 追加分）

- **2 節**の「希望片道時間（合計 60 分〜 30 時間、すなわち 60〜1800 分）と有料道路可否を入力できる」は、現行実装では**「有料道路可否の入力は廃止（内部的に利用ありで固定）」**に読み替える。
