# test_robot_tools

> ブラウザだけでROS開発を完結させる軽量開発環境

本ツールは、ROS 2 初学者が開発環境の構築や複雑なツールの切り替えに迷うことなく、ロボットの制御とデバッグに集中できるように設計された Web ベースの統合開発環境です。

https://github.com/user-attachments/assets/cc137886-75bb-4efb-8c5d-7c5432c0d9a7

---
### 主な機能
- **Robot Simulator**: 物理エンジンを使用しない、動作確認に特化した軽量 3D レンダラー。
- **Camera Viewer**: ロボットからの画像トピックをリアルタイムに表示。
- **Log & Log Analyzer**: 実行ログの表示に加え、LLM 等を活用したエラー分析をサポート。
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

## 実行時に必要な情報
- /joint_states: `sensor_msgs/msg/JointState`
- /rosout: `rcl_interfaces/msg/Log`
- /cmd_vel: ` geometry_msgs/msg/Twist`

- robot_state_publisherの起動

https://github.com/user-attachments/assets/260197a4-36d0-4119-a5a3-038353e26a96



---

## セットアップ
リポジトリをクローンし、必要な依存関係をインストールします。

```bash
# ホームディレクトリ等で実行
cd ~/.
git clone https://github.com/yulat214/test_robot_tools
cd test_robot_tools
npm install```

