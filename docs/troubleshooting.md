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

- ポート 9090 を他のプログラムが使用していないか確認してください。
- `npm start` を、ROS 2 の環境を `source` したターミナルで実行しているか確認してください。

## 別の PC や Docker のホスト機から開けない

- ブラウザのアドレスは `http://<OneStageROS を動かしている PC の IP アドレス>:3000` です。
- Docker の場合は、3000・8000・9090・9091 の 4 つのポートを転送しているか確認してください（[設定](configuration.md#docker-で使う場合)）。

## `npm start` で `Port 3000 is already in use` と表示される

OneStageROS がすでに起動しているか、他のプログラムがポート 3000 を使用しています。起動中の OneStageROS を `Ctrl+C` で停止してから、もう一度実行してください。

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

## カメラビューが「検出中...」のまま

ロボットカメラモードでは、名前に `optical` を含むリンクをカメラとして使用します。URDF にそのようなリンクがあるか確認してください。
カメラを持たないロボットでは、フリービューを使用してください。

## AI 解析でエラーが表示される

- 「AI解析 設定」で API キーが設定されているか確認してください（🤖 ボタンが緑色になっていれば設定済みです）。
- Base URL と Model 名が、利用する API サービスのものと一致しているか確認してください。
- インターネットに接続できる環境か確認してください。

## 配置したオブジェクトが消えた

自動保存された配置は、OneStageROS を再起動すると消去されます。残したい環境は、ワールド編集の「保存」でファイルに書き出してください（[ワールド編集](world-editing.md#環境を保存読み込みする)）。
