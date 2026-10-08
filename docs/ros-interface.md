# ROS インターフェース一覧

OneStageROS が ROS 2 とやり取りするトピック・ノードの一覧です。

---

## 起動するノード

`npm start` で以下のノードが自動的に起動します。

| ノード | 用途 |
|--------|------|
| `rosbridge_websocket` | ブラウザと ROS 2 の通信（ポート 9090） |
| `rosbridge_websocket_camera` | カメラ画像の配信（ポート 9091） |
| `rosapi` | ノード・トピック一覧の取得 |
| `onestage_graph_monitor` | ROS ノードの監視と、LiDAR・オドメトリ・TF の配信 |

---

## 購読するトピック・パラメータ

| 名前 | 型 | 用途 |
|------|----|------|
| `/robot_state_publisher` の `robot_description` | パラメータ | ロボットモデルの表示 |
| `/joint_states` | `sensor_msgs/msg/JointState` | 関節角度の反映 |
| `/cmd_vel` | `geometry_msgs/msg/Twist` | ロボットの走行 |
| `/onestage/sim_pose` | `geometry_msgs/msg/PoseStamped` | 3D ビューへのロボットの位置の反映 |
| `/initialpose` | `geometry_msgs/msg/PoseWithCovarianceStamped` | 自己位置の初期化（RViz の 2D Pose Estimate） |
| `/rosout` | `rcl_interfaces/msg/Log` | デバッグログの表示 |
| `/camera/color/camera_info` | `sensor_msgs/msg/CameraInfo` | カメラビューの縦横比 |

---

## 配信するトピック

| 名前 | 型 | 内容 |
|------|----|------|
| `/scan` | `sensor_msgs/msg/LaserScan` | 仮想 LiDAR（`base_scan` フレーム、約 10 Hz） |
| `/tf` | `tf2_msgs/msg/TFMessage` | `odom` → `base_link`、`base_link` → `base_scan` |
| `/tf_static` | `tf2_msgs/msg/TFMessage` | `base_link` → `base_scan` |
| `/onestage/odom` | `nav_msgs/msg/Odometry` | オドメトリ（`odom` → `base_link`） |
| `/onestage/sim_pose` | `geometry_msgs/msg/PoseStamped` | ロボットの位置（`onestage_world` フレーム） |
| `/camera/camera/color/image_raw` | `sensor_msgs/msg/Image` | カラー画像 |
| `/camera/camera/depth/image_rect_raw` | `sensor_msgs/msg/Image` | 深度画像 |
| `/camera/camera/color/camera_info` | `sensor_msgs/msg/CameraInfo` | カメラの内部パラメータ |

各トピックの詳細は [シミュレータ](simulator.md#仮想センサー) と [カメラビュー](camera.md#配信するトピック) を参照してください。

---

## SLAM と組み合わせる

シミュレータが配信する `/scan` と TF を使って、地図を作成できます。

### slam_toolbox

```bash
ros2 launch slam_toolbox online_async_launch.py
```

LiDAR の計測範囲は最大 3.5 m です。slam_toolbox のパラメータ `max_laser_range` を `3.5` 以下に設定すると、何も検出しなかった方向に壁が誤って作られるのを防げます。

### Cartographer

オドメトリはトピック名 `/onestage/odom` で配信しています。Cartographer でオドメトリを使う場合は、`odom` を `/onestage/odom` にリマップして起動してください。

```bash
ros2 run cartographer_ros cartographer_node \
  -configuration_directory <設定ディレクトリ> \
  -configuration_basename <設定ファイル>.lua \
  --ros-args -r odom:=/onestage/odom
```

---

## Nav2 と組み合わせる

作成した地図と Nav2 を使って、自律移動を試せます。

1. Nav2 を地図付きで起動します。

   ```bash
   ros2 launch nav2_bringup bringup_launch.py map:=<地図ファイル>.yaml
   ```

2. RViz の **2D Pose Estimate** でロボットの初期位置を指定します。
   OneStageROS は `/initialpose` を受信すると、3D ビュー上のロボットの位置はそのままに、`odom` を指定位置に合わせて初期化します。
3. RViz の **Nav2 Goal** で目的地を指定すると、Nav2 が配信する `/cmd_vel` に従ってロボットが移動します。

Nav2 のオドメトリ入力にトピックを使う場合は、`odom` を `/onestage/odom` にリマップしてください。
