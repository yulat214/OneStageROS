# Windows（WSL2 + Docker）で nav / bt_catch が止まる件：調査と対策の手順

作成: 2026-09-25

## これまでに分かっていること

| 観測 | 内容 |
|---|---|
| 症状1 | ブラウザを最小化・非表示にすると nav 等が止まる（最小化で効率モードのプロセスが増える） |
| 症状2 | 前面表示でも、途中で TF が切れる。bt_catch も Windows だとうまく動かない |
| `/onestage/odom` の hz | 30Hz で安定（ブラウザの周期処理は回っている、送信元の重複なし） |
| `ros2 run tf2_ros tf2_monitor odom base_link` | base_link: 平均遅れ 0.846s / 最大 1.64s（**異常**、正常なら数十 ms）。odom: -0.68s（AMCL の未来日付なので正常） |
| `ros2 topic delay /onestage/odom` | 遅れが**加速しながら増え続ける** |
| cm1 未起動でも発生 | カメラ画像の負荷は原因ではなさそう |
| 環境 | Windows 11 の Chrome → WSL2 → Docker コンテナ内の rosbridge。`--network host` は動かない |

**現時点の見立て:** ブラウザ → rosbridge の経路（WSL の localhost 転送 wslrelay / Docker のポート転送）で処理待ちが溜まり、
TF が 1 秒以上遅れて届く → tf2 / Nav2 の許容時間を超えて「TF が切れた」状態になる。

---

## 試す順番

### Step 0: 切り分け（1分ずつ）

- [ ] **ブラウザを再読み込み**して `ros2 topic delay /onestage/odom` を見る
  - ほぼ 0 に戻ってまた増える → 経路での処理待ちの蓄積（Step 1 以降へ）
  - 戻らない → 時計のずれ（`wsl --shutdown` で再起動、「設定 → 時刻と言語 → 今すぐ同期」）
- [ ] コンテナ内で `top` を実行し、`rosbridge_websocket` の CPU 使用率を見る
  - 100% に張り付いている → rosbridge が処理しきれていない
  - 余裕がある → 経路（Windows と WSL の間）が怪しい

### Step 1: localhost を経由しない（WSL の転送を避ける）

- [ ] WSL で `hostname -I` を実行して IP を調べる
- [ ] Windows の Chrome で `http://<WSLのIP>:3000` を開く（rosbridge への接続先はページの URL から自動で決まる）
- [ ] `ros2 topic delay /onestage/odom` が増え続けなくなるか確認する

改善した場合は、恒久対策としてミラーモードのネットワークにする（Windows 11 22H2 以降）。
`%UserProfile%\.wslconfig`:
```ini
[wsl2]
networkingMode=mirrored
```
- [ ] 設定後に `wsl --shutdown` で再起動し、`localhost:3000` で遅れが出ないか確認する
- 授業ではこのファイルを配るだけで済む（管理者権限は不要）

### Step 2: ヘッドレス Chromium をコンテナ内で動かす

ブラウザ → rosbridge の通信がコンテナ内で完結するので、WSL の転送経路も Windows の省電力（症状1）も関係なくなる。

**インストール**（Ubuntu の `chromium-browser` は snap 版で、Docker 内では動かない）
```bash
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
apt-get update && apt-get install -y ./google-chrome-stable_current_amd64.deb
```

**起動**（run_all で OneStageROS が起動した後に実行）
```bash
google-chrome \
  --headless=new --no-sandbox \
  --use-angle=swiftshader --enable-unsafe-swiftshader \
  --disable-background-timer-throttling --disable-renderer-backgrounding \
  --window-size=1600,900 \
  --user-data-dir=$HOME/.onestage-headless \
  --remote-debugging-port=9222 \
  http://localhost:3000 &
```
- swiftshader: WebGL を CPU で処理する（カメラ画像も描ける。CPU の負荷はそれなりにかかる）
- `--user-data-dir`: localStorage（保存した位置や環境）が再起動後も残る

**画面の見方（Windows 側）**
- **Windows で `localhost:3000` を同時に開かないこと**（TF が二重に送られて衝突する）
- `docker run` に `-p 9222:9222` を追加する（必要なら起動オプションに `--remote-debugging-address=0.0.0.0` も付ける）
- Windows の Chrome で `chrome://inspect` → Configure に `localhost:9222` を追加 → 表示されたページの「inspect」で画面を見て操作できる
- 9222 番ポートからはブラウザを完全に操作できるので、外部に公開しないこと

**確認**
- [ ] `ros2 topic delay /onestage/odom` が数十 ms で安定するか
- [ ] 最小化しても（Windows 側に何も開いていなくても）nav が動き続けるか
- [ ] bt_catch が動くか

**run_all への組み込み（任意）:** `ONESTAGE_HEADLESS=1` のときだけ上の起動コマンドを実行し、
`cleanup` に `pkill -f 'google-chrome.*onestage-headless'` を追加する。

### Step 3: 定期パブリッシュをサーバ側へ移す（根本対策・要実装）

Step 1〜2 で解決しない場合、または Windows のブラウザを表示に使い続けたい場合に行う。
周期処理は `assets-server.js`（rclnodejs が常駐）に置き、ブラウザは表示・カメラ・把持判定だけを受け持つ。
タイムスタンプはすべて ROS の時計（`node.now()`）で付けるので、時計のずれの問題もなくなる。

**段階1: 移動・TF・odom** — ✅ 実装済み・Windows で確認済み（2026-09-25）: TF の最大遅れ約 9ms、scan の遅れ約 0.05 秒で増えない、前面表示でも最小化中でも Nav2 でゴール到達
- ブランチ: `test/windows-server-side-sim`（`git switch main` で従来の動作に戻る）
- 実装: `server/sim-core.js`（新規）、`server/assets-server.js`、`src/hooks/useROS.ts`、`src/components/SimulatorView.tsx`
- rclnodejs が使えない環境では、ブラウザが自動で従来どおりの送信に戻る（ブラウザのコンソールに `[SIM] mode: server|local` と出る）
- 一時停止中も TF は送り続ける（従来は一時停止すると TF も止まっていた）
- scan は段階2まではブラウザが送るが、スタンプには sim_pose の時刻（その位置の TF と同じ時刻）を使う

以下は当初の計画:
- サーバ（新規 `server/sim-core.js`、rclnodejs の `init()` は既存のノード一覧監視と共有）
  - 状態: `pose{x,y,yaw}`、`odomOrigin`、`cmdVel`、一時停止中かどうか、移動機構の有無
  - `/cmd_vel` と `/initialpose` を購読する（`/initialpose` を受けたら `odomOrigin = pose`）
  - 33ms ごとのタイマーで、位置の更新、`/tf`（odom → base_link、base_link → base_scan）と `/onestage/odom` の送信、表示用の `/onestage/sim_pose` の送信を行う
  - API: `POST /api/sim/pose`（ドラッグ・初期位置）、一時停止、移動機構の有無
- ブラウザ
  - `SimulatorView.tsx` の周期処理から位置計算と `publishTF` を削除し、`/onestage/sim_pose` を購読して `currentPoseRef` に反映する
  - `useROS.ts` から TF と odom の送信、`/initialpose` の処理を削除する
  - ロボットの位置を動かす操作は API 経由にする

**段階2: scan**
- 障害物が変わったとき（今は環境を自動保存しているタイミング）に、ブラウザで各メッシュを高さ 0.15m の水平面で切った線分を求め、`POST /api/sim/obstacles` で送る
- サーバで 360 本のレイと線分の交差を2次元で計算し、10Hz で `/scan` を送る
- 把持中の物体は scan の計算から外す

**段階3: カメラのタイムスタンプ**
- 画像の時刻には、その画像を描いたときに使った `sim_pose` の時刻を付ける（tf2 のバッファに 10 秒分残っているので、遅れて届いても位置が正しく対応する）

**この移行で解決しないこと:** ROS → ブラウザの方向（`sim_pose`、joint_states）とカメラ画像は、これまでどおり WSL の転送経路を通る。
nav は影響を受けなくなるが、表示やカメラには遅れが残る可能性がある。

---

## 補足: 症状1（最小化）への Windows 側の対策

授業で学生の PC に設定を求めるのは難しいので、あくまで参考。Step 2 または 3 で不要になる。

- 専用プロファイルで Chrome を起動する（ショートカットの「項目の場所」に以下を指定）
  ```
  "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="C:\onestage-chrome" --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling --disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling,UseEcoQoSForBackgroundProcess http://localhost:3000
  ```
  オプションが効いているかは `chrome://version` の「コマンドライン」で確認する
- Windows 全体で Power Throttling を無効にする（管理者権限、再起動が必要）
  `HKLM\SYSTEM\CurrentControlSet\Control\Power\PowerThrottling` に `PowerThrottlingOff` (DWORD) = 1
- 拡張ディスプレイに移すと止まる場合: `chrome://gpu` で GPU が切り替わっていないか、コンソールに `CONTEXT_LOST_WEBGL` が出ていないかを確認する

## 補足: 気づいた改善点

- カメラの送信が「描画 6 フレームに 1 回」なので、ディスプレイのリフレッシュレートで送信頻度が変わる（60Hz なら 10Hz、144Hz なら 24Hz）。時間ベースの間隔にした方が安定する（`RobotCameraView.tsx` の `PUBLISH_EVERY_N_FRAMES`）
- ブラウザのタイムスタンプはすべて Windows の時計（`Date.now()`）。Step 3 を行わない場合でも、rosapi の `/rosapi/get_time` との差で補正する方法がある
