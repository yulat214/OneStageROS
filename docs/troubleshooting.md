# トラブルシューティング

## ロボットが表示されない

- `robot_state_publisher` が起動しているか確認してください。

  ```bash
  ros2 node list | grep robot_state_publisher
  ```

- `npm start` を実行したターミナルに `Waiting for robot_description` と表示され続ける場合は、OneStageROS と ROS 2 のノードが通信できていません。両方のターミナルで `ROS_DOMAIN_ID` が同じか確認してください。
- ロボットは表示されるがメッシュが表示されない場合は、メッシュを含むパッケージが見つかっていません。そのパッケージを含むワークスペースを `source` してから `npm start` を実行してください。ターミナルに `Package not found or skipped: <パッケージ名>` と表示されます。

## Status が Disconnected のまま

- ROS Bridge が起動していません。`rosbridge_suite` がインストールされているか確認してください。

  ```bash
  sudo apt install ros-humble-rosbridge-suite
  ```

- ポート 9090・9091 を他のプログラム（別に起動した ROS Bridge など）が使用していないか確認してください。OneStageROS は内部でこれらのポートを使用します。
- `npm start` を、ROS 2 の環境を `source` したターミナルで実行しているか確認してください。

## Docker のホスト機や別の PC から開けない

- `.env`（または `docker-compose.yaml` の `environment:`）で `ONESTAGE_EXPOSE=true` を設定し、OneStageROS を再起動してください。既定（`false`）では、OneStageROS を動かしている PC（コンテナ）の中からしか開けません（[設定](configuration.md#ネットワーク公開)）。
- Docker の場合は、ポート `3000` を転送しているか確認してください。`8000`・`9090`・`9091` の転送は不要です。
- 別の PC から開く場合、ブラウザのアドレスは `http://<OneStageROS を動かしている PC の IP アドレス>:3000` です。

## 画面は開くが、ロボットが表示されない・API が `403 Forbidden` になる

OneStageROS は、`localhost` と IP アドレス以外のホスト名でのアクセスや、他の Web サイトからのリクエストを拒否します（[設定](configuration.md#アクセス元の確認)）。

- ブラウザのアドレスが `http://localhost:3000`、`http://127.0.0.1:3000`、または `http://<IP アドレス>:3000` になっているか確認してください。`http://mypc.local:3000` のようなホスト名では開けません。
- ブラウザの拡張機能が通信の内容を書き換えている場合は、拡張機能を無効にして試してください。

## ログイン画面が表示される・トークンが正しくないと表示される

ログイン画面は `ONESTAGE_AUTH=token` を設定した場合に表示されます（[設定](configuration.md#ログイン)）。

- OneStageROS を動かしている環境（Docker の場合はコンテナ内）のターミナルで `npm run token` を実行し、表示されたトークンを入力してください。
- `npm run token -- --reset` でトークンを再発行した場合は、OneStageROS を再起動してから新しいトークンを入力してください。
- 1 分間に 10 回を超えてログインを試すと、しばらくログインできなくなります。1 分ほど待ってから再度お試しください。

## ホスト機のプログラムから ROS Bridge（`ws://localhost:9090`）に接続できない

ROS Bridge は OneStageROS の内部（`127.0.0.1`）でのみ待ち受けるため、Docker のホスト機などから直接は接続できません。
ROS 2 のノードとして同じ環境（コンテナ内）で動かすか、ブラウザと同じく `ws://localhost:3000/rosbridge` に接続してください（ログインを有効にしている場合は接続できません）。

## `npm start` で `Port 3000 is already in use` または `EADDRINUSE` と表示される

OneStageROS がすでに起動しているか、他のプログラムがポート 3000・8000 を使用しています。起動中の OneStageROS を `Ctrl+C` で停止してから、もう一度実行してください。

## ロボットが動かない

- `/cmd_vel` が配信されているか確認してください。

  ```bash
  ros2 topic echo /cmd_vel
  ```

- シミュレータが一時停止していないか確認してください（ヘッダーのボタンが「再開」になっている場合は一時停止中です）。
- URDF に `world` リンクがあるロボットは固定ロボットとして扱われ、走行しません（[シミュレータ](simulator.md#走行)）。

## カメラ画像や LiDAR の更新が止まる

ブラウザのタブが非表示（別のタブを表示中・ウィンドウを最小化中）になると、ブラウザの仕様により描画が止まり、カメラ画像の配信も止まります。カメラ画像を使うときは、OneStageROS のタブを表示したままにしてください。

LiDAR・オドメトリ・TF は、通常はタブを非表示にしても止まりません。止まる場合は、`npm start` を実行したターミナルに `[SIM] server-side simulation unavailable` と表示されていないか確認してください。表示されている場合は、次のどちらかで対処してください。

- ROS 2 の環境を `source` したターミナルで、もう一度 `npm install` を実行してから OneStageROS を再起動する
- OneStageROS のタブを表示したままにする

## カメラのトピックが RViz に表示されない・データが届かない

カメラビューのヘッダー右上のボタンが「配信停止中」になっていないか確認してください。クリックして「配信中」にすると、`/camera/camera/color/image_raw` などのトピックが配信されます（[カメラビュー](camera.md#配信のオンオフ)）。

## カメラビューが「検出中...」のまま

ロボットカメラモードでは、名前に `optical` を含むリンクをカメラとして使用します。URDF にそのようなリンクがあるか確認してください。
カメラを持たないロボットでは、フリービューを使用してください。

## AI 解析でエラーが表示される

- 「AI解析 設定」で API キーが設定されているか確認してください（🤖 ボタンが緑色になっていれば設定済みです）。
- Base URL と Model 名が、利用する API サービスのものと一致しているか確認してください。
- インターネットに接続できる環境か確認してください。

## 配置したオブジェクトが消えた

自動保存された配置は、OneStageROS を再起動すると消去されます。残したい環境は、ワールド編集の「保存」でファイルに書き出してください（[ワールド編集](world-editing.md#環境を保存読み込みする)）。
