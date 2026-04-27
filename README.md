# OneStageROS

> ブラウザだけでROS開発を完結させる軽量開発環境

本ツールは、ROS 2 初学者が開発環境の構築や複雑なツールの切り替えに迷うことなく、ロボットの制御とデバッグに集中できるように設計された Web ベースの統合開発環境です。
<img width="3263" height="1973" alt="2026-04-23-14:18:49-screenshot" src="https://github.com/user-attachments/assets/9528a728-ee5f-437c-af25-db9c99be44b6" />

デモは[こちらの動画](https://youtu.be/tN1MnzoIzKw)をご覧ください。

---
### 主な機能
- **Robot Simulator**: 物理エンジンを使用しない、動作確認に特化した軽量 3D レンダラー。
- **Camera Viewer**: ロボットからの画像トピックをリアルタイムに表示。
- **Log & Log Analyzer**: 実行ログの表示に加え、ログ解析によってエラー分析をサポート。
- **Web Editor**: Monaco Editor を内蔵し、ブラウザ上で直接スクリプトを編集可能。

---

## 動作環境
以下の環境での動作を想定しています。

- **OS/Distro**: ROS 2 Humble (Docker コンテナ、またはホスト直接の両方に対応)
- **Runtime**: Node.js, npm
- **Network**: Docker 等を使用する場合、以下のポート開放が必要です。
    - `3000`: フロントエンド（Web 画面）
    - `8000`: バックエンド API
    - `9090`: ROS Bridge (WebSocket 通信用)

---

## セットアップ
リポジトリをクローンし、必要な依存関係をインストールします。

```bash
# ホームディレクトリ等で実行
cd ~/.
git clone https://github.com/yulat214/OneStageROS
cd OneStageROS
npm install
```

---

## 実行時に必要な情報
実機のbringup等のlaunchから、ハードウェアとの接続部分を除いた情報で使用可能です。
- /joint_states: `sensor_msgs/msg/JointState`
- /rosout: `rcl_interfaces/msg/Log`
- /cmd_vel: `geometry_msgs/msg/Twist`

- robot_state_publisherの起動

---

## 利用方法
動作確認したいロボットに関するlaunch等によって、上記topicが流れている状態で
```bash
cd OneStageROS
npm run start
```
を実行し、ブラウザから`http://localhost:3000`にアクセス

---
Dependency:
- [https://github.com/gkjohnson/urdf-loaders](https://github.com/gkjohnson/urdf-loaders)
ロボットモデルの表示に使用しています。
