このプロダクトは移動時間の正確さが価値になりやすいので、Google Maps Platformのroutes apiを使用する。







ルート検索APIに求めること
・LLMが出力した行き先が妥当かどうかの判断（所要時間）
・ルート案内のための情報

・

## 取得できる情報だけまとめ
### Google Maps Platform
#### `Routes API: computeRoutes`
- ルート全体の距離
- ルート全体の所要時間
- 交通を考慮した所要時間
- 交通を考慮しない基準時間
- ルート全体のpolyline
- legごとの距離、時間、polyline
- stepごとの距離、時間、polyline
- stepごとの案内文
- stepごとのmaneuver
- 料金情報
- 警告情報
- viewport

#### `Routes API: computeRouteMatrix`
- origin-destinationごとの距離
- origin-destinationごとの所要時間
- 交通を考慮した所要時間
- 交通を考慮しない基準時間
- route condition
- fallback情報

#### `Geocoding API`
- 住所
- 住所構成要素
- 座標
- place ID
- address type

#### `Places API (New)`
- place prediction
- query prediction
- place ID
- place名
- 住所表記
- 検索文字列に対する候補

#### `Roads API: snapToRoads`
- 補正後の道路上座標
- 元の点との対応index
- 道路のplace ID
- 補間後の道路形状

### OpenRouteService
#### `Directions`
- ルート全体の距離
- ルート全体の所要時間
- ルート全体のgeometry
- segmentごとの距離、時間
- stepごとの案内情報
- stepごとの方向種別
- ルートのbbox
- `way_points`
- extra_info
  - `waytype`
  - `waycategory`
  - `surface`
  - `tollways`
  - `roadaccessrestrictions`
  - `countryinfo`
  - `osmid`
  - `steepness`
  - `suitability`
  - `green`
  - `noise`
- attributes
  - `avgspeed`

#### `Matrix`
- origin-destinationごとの距離
- origin-destinationごとの所要時間

#### `Isochrones`
- 指定時間圏のポリゴン
- 指定距離圏のポリゴン
- 複数レンジの到達可能エリア

#### `Geocoder`
- 地名や住所から座標
- 座標から地名や住所
- 入力補完候補

#### `Snapping`
- 補正後の座標
- 道路名
- 元座標から補正点までの距離
