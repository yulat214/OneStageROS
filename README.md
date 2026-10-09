# OneStageROS

> ブラウザだけで ROS 2 開発を完結させる軽量開発環境

OneStageROS は、ROS 2 のロボット制御とデバッグをブラウザ 1 タブで行える Web ベースの統合開発環境です。
ロボットの 3D 表示・仮想センサー・ログ解析・コード編集・ビルド・ターミナルを 1 つの画面にまとめているため、ツールを切り替えることなく開発を進められます。

<img width="3263" height="1973" alt="OneStageROS の画面" src="https://github.com/user-attachments/assets/9528a728-ee5f-437c-af25-db9c99be44b6" />

デモは[こちらの動画](https://youtu.be/tN1MnzoIzKw)をご覧ください。

---

## 主な機能

| 機能 | 概要 | ドキュメント |
|------|------|--------------|
| シミュレータ | URDF のロボットを 3D 表示し、`/joint_states`・`/cmd_vel` に合わせて動かします。仮想 LiDAR・オドメトリ・TF を配信し、SLAM や Nav2 と組み合わせて使えます。 | [docs/simulator.md](docs/simulator.md) |
| ワールド編集 | 箱・円柱・球や、メッシュ／SDF ファイルを配置して環境を作れます。Gazebo のワールドファイルを起動時に読み込むこともできます。 | [docs/world-editing.md](docs/world-editing.md) |
| カメラビュー | ロボットに搭載したカメラの視点を表示し、カラー画像・深度画像を ROS トピックとして配信します。 | [docs/camera.md](docs/camera.md) |
| デバッグログ | `/rosout` をリアルタイムに表示します。レベル・ノードでの絞り込み、前後ログの確認、日本語訳、AI によるエラー解析ができます。 | [docs/debug-log.md](docs/debug-log.md) |
| エディター・ビルド | ホームディレクトリのファイルを編集し、そのまま `colcon build` と実行ができます。 | [docs/editor.md](docs/editor.md) |
| ターミナル | ブラウザ上でシェルを操作できます。 | [docs/terminal.md](docs/terminal.md) |

その他のドキュメント:

- [設定（環境変数・Docker での利用・ネットワーク公開・ログイン）](docs/configuration.md)
- [ROS インターフェース一覧（購読・配信トピック）](docs/ros-interface.md)
- [トラブルシューティング](docs/troubleshooting.md)

---

## 動作環境

- **OS**: Ubuntu 22.04
- **ROS 2**: Humble（Docker コンテナ内・ホスト直接のどちらでも動作します）
- **Node.js**: 20 以上、npm
- **ROS パッケージ**: `rosbridge_suite`（`rosbridge_server` と `rosapi` を含みます）
- **ブラウザ**: Google Chrome / Microsoft Edge / Firefox の最新版

ブラウザから接続するポートは `3000` だけです。

| ポート | 用途 | 待ち受けるアドレス |
|--------|------|--------------------|
| `3000` | Web 画面（バックエンド・ターミナル・ROS Bridge への通信もここを経由します） | 既定では `127.0.0.1`。`ONESTAGE_EXPOSE=true` で全インターフェース |
| `8000` | バックエンド API・ターミナル（内部用） | 常に `127.0.0.1` |
| `9090` | ROS Bridge（内部用） | 常に `127.0.0.1` |
| `9091` | カメラ画像専用の ROS Bridge（内部用） | 常に `127.0.0.1` |

起動時のログに表示される `8000`・`9090`・`9091` は内部用のポートで、公開する必要はありません。

---

## セットアップ

### 1. 必要なパッケージのインストール

```bash
sudo apt update
sudo apt install -y ros-humble-rosbridge-suite build-essential python3
```

Node.js 20 以上がインストールされていない場合は、[Node.js 公式サイト](https://nodejs.org/) の手順に従ってインストールしてください。

### 2. OneStageROS の取得

ROS 2 の環境を読み込んだターミナルで実行してください。

```bash
source /opt/ros/humble/setup.bash
cd ~
git clone https://github.com/yulat214/OneStageROS.git
cd OneStageROS
npm install
```

### 3. 設定（任意）

設定はリポジトリ直下の `.env` に記述します。ひな形をコピーして編集してください。

```bash
cp .env.example .env
```

既定では、OneStageROS を起動した PC（`localhost`）からのみ使えます。
**Docker コンテナで動かしてホスト機のブラウザから使う場合は、`ONESTAGE_EXPOSE=true` を設定し、ポート `3000` だけを転送してください。**

```yaml
# docker-compose.yaml
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      - ONESTAGE_EXPOSE=true
```

別の PC から使う場合は、ログイン（`ONESTAGE_AUTH=token`）も有効にしてください。詳しくは [設定](docs/configuration.md) を参照してください。

---

## 使い方

### 1. ロボットを起動する

OneStageROS でロボットを表示するには、`robot_state_publisher` が起動している必要があります。
動作確認したいロボットの launch ファイル（実機の bringup からハードウェア接続部分を除いたもの、`display.launch.py` など）を起動してください。

| 必要なもの | 用途 |
|------------|------|
| `robot_state_publisher` ノード | ロボットモデル（`robot_description`）の取得 |
| `/joint_states`（`sensor_msgs/msg/JointState`） | 関節角度の反映 |
| `/cmd_vel`（`geometry_msgs/msg/Twist`） | 移動ロボットの走行 |
| `/rosout`（`rcl_interfaces/msg/Log`） | デバッグログの表示 |

ロボットのメッシュファイルを含むパッケージは、ビルド済みで `ros2 pkg prefix` から見つけられる状態にしておいてください。

### 2. OneStageROS を起動する

ROS 2 の環境を読み込んだターミナルで実行します。

```bash
source /opt/ros/humble/setup.bash
source ~/ros2_ws/install/setup.bash   # ロボットのパッケージを含むワークスペース
cd ~/OneStageROS
npm start
```

ROS Bridge とバックエンドが自動で起動します。

### 3. ブラウザで開く

[http://localhost:3000](http://localhost:3000) にアクセスします。
ロボットが起動していれば、数秒でシミュレータにロボットが表示されます。

ログイン（`ONESTAGE_AUTH=token`）を有効にしている場合は、ログイン画面に `npm run token` で表示されるトークンを入力してください。

終了するときは、`npm start` を実行したターミナルで `Ctrl+C` を押してください。

### 新しいバージョンに更新する

```bash
cd ~/OneStageROS
git pull
source /opt/ros/humble/setup.bash
npm install
```

依存パッケージが変わることがあるため、更新したあとは `npm install` を実行してください。

#### 1.x から 2.0.0 に更新する場合

2.0.0 では、ブラウザから接続するポートが `3000` だけになり、既定では OneStageROS を動かしている PC（コンテナ）の中からしか開けなくなりました。

- **Docker で使っている場合**：`docker-compose.yaml` を次のように変更してください。`8000`・`9090`・`9091` の転送は不要になります。

  ```yaml
      ports:
        - "127.0.0.1:3000:3000"
      environment:
        - ONESTAGE_EXPOSE=true
  ```

- **`server/.env` に設定を書いている場合**：そのままでも読み込まれます。新しい設定はリポジトリ直下の `.env` に書いてください（[設定](docs/configuration.md)）。
- **ホスト機のプログラムから ROS Bridge（`9090`）に直接接続している場合**：接続できなくなります（[トラブルシューティング](docs/troubleshooting.md#ホスト機のプログラムから-ros-bridgewslocalhost9090に接続できない)）。

---

## 画面構成

画面上部のタブで 2 つの画面を切り替えます。

- **シミュレータ**: 左にシミュレータ、右上にカメラビュー、右下にデバッグログを表示します。
- **エディター**: 左にファイルツリー、右にコードエディターとビルドパネルを表示します。

右上の「ターミナル」ボタンで、どちらの画面からでも画面下部にターミナルを開けます。

---

## ライセンス

[MIT License](LICENSE)

ロボットモデルの表示に [urdf-loaders](https://github.com/gkjohnson/urdf-loaders)（Apache License 2.0）を使用しています。

変更履歴は [CHANGELOG.md](CHANGELOG.md) を参照してください。
