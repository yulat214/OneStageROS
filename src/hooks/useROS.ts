import { useCallback, useEffect, useRef, useState } from 'react';
import * as ROSLIB from 'roslib';

export function useROS(jointTopic: string) {
  const [rosStatus, setRosStatus] = useState<string>('Disconnected');

  // 描画ループ内で参照・更新するためのRef
  const jointPositionsRef = useRef<Map<string, number>>(new Map());
  const cmdVelRef = useRef({ linearX: 0, angularZ: 0 });
  const needsUpdateRef = useRef(false);
  const rosRef = useRef<ROSLIB.Ros | null>(null);
  const scanTopicRef = useRef<ROSLIB.Topic | null>(null);
  const tfTopicRef = useRef<ROSLIB.Topic | null>(null);
  const odomPubTopicRef = useRef<ROSLIB.Topic | null>(null);
  // Nav2 オドメトリ: 受信時刻を含む。null = 未受信（デッドレコニングにフォールバック）
  const odomPoseRef = useRef<{ x: number; y: number; yaw: number; time: number } | null>(null);
  // 2D Pose Estimate 受信時の初期位置（マップフレーム座標）。pending=true で未適用
  const initialPoseRef = useRef<{ pending: boolean } | null>(null);

  useEffect(() => {
    const hostname = window.location.hostname;
    const ros = new ROSLIB.Ros({ url: `ws://${hostname}:9090` });
    rosRef.current = ros;

    ros.on('connection', () => {
      setRosStatus('Connected');
      scanTopicRef.current = new ROSLIB.Topic({
        ros,
        name: '/scan',
        messageType: 'sensor_msgs/msg/LaserScan',
      });

      tfTopicRef.current = new ROSLIB.Topic({
        ros,
        name: '/tf',
        messageType: 'tf2_msgs/msg/TFMessage',
      });

      // 実機/フェイクハードウェアの diff_drive_controller 等が /odom を
      // 既に使っている場合に衝突しないよう、専用トピックに publish する。
      // cartographer 等 SLAM 側は起動コマンドで `-r odom:=/onestage/odom` を
      // remap してこちらを購読させる。
      odomPubTopicRef.current = new ROSLIB.Topic({
        ros,
        name: '/onestage/odom',
        messageType: 'nav_msgs/msg/Odometry',
      });

      // base_link → base_scan の静的 TF を1回 publish
      // latch: true 必須 — 指定しないと rosbridge 側の publisher lifespan が1秒に制限され、
      // 接続から1秒以上経ってから起動した slam_toolbox / RViz がこの static transform を受信できない
      const tfStaticTopic = new ROSLIB.Topic({
        ros,
        name: '/tf_static',
        messageType: 'tf2_msgs/msg/TFMessage',
        latch: true,
      });
      const now = Date.now();
      tfStaticTopic.publish(({
        transforms: [{
          header: {
            stamp: { sec: Math.floor(now / 1000), nanosec: (now % 1000) * 1_000_000 },
            frame_id: 'base_link',
          },
          child_frame_id: 'base_scan',
          transform: {
            translation: { x: 0, y: 0, z: 0.15 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
          },
        }],
      }));
    });
    ros.on('error', (event: any) => {
      console.error(`[ROS] error at ${new Date().toISOString()}`, event);
      setRosStatus('Error');
      scanTopicRef.current = null;
      odomPubTopicRef.current = null;
    });
    ros.on('close', (event: any) => {
      // event.code/reason/wasClean は生の WebSocket CloseEvent。
      // code=1006 は異常切断（相手側クラッシュ・タイムアウト等）を示す。
      console.warn(
        `[ROS] closed at ${new Date().toISOString()} code=${event?.code} reason="${event?.reason}" wasClean=${event?.wasClean}`,
      );
      setRosStatus('Disconnected');
      scanTopicRef.current = null;
      odomPubTopicRef.current = null;
    });

    // ジョイント状態の購読
    const jointListener = new ROSLIB.Topic({
      ros: ros,
      name: jointTopic,
      messageType: 'sensor_msgs/msg/JointState'
    });

    jointListener.subscribe((message: any) => {
      for (let i = 0; i < message.name.length; i++) {
        jointPositionsRef.current.set(message.name[i], message.position[i]);
      }
      needsUpdateRef.current = true;
    });

    // 速度指令の購読
    const cmdVelListener = new ROSLIB.Topic({
      ros: ros,
      name: '/cmd_vel',
      messageType: 'geometry_msgs/msg/Twist'
    });

    cmdVelListener.subscribe((message: any) => {
      cmdVelRef.current = {
        linearX: message.linear.x,
        angularZ: message.angular.z
      };
    });

    // Nav2 オドメトリの購読
    const odomListener = new ROSLIB.Topic({
      ros,
      name: '/odom',
      messageType: 'nav_msgs/msg/Odometry',
    });

    odomListener.subscribe((message: any) => {
      const pos = message.pose.pose.position;
      const ori = message.pose.pose.orientation;
      // クォータニオン → ヨー角（Z 軸周り回転）
      const yaw = Math.atan2(
        2 * (ori.w * ori.z + ori.x * ori.y),
        1 - 2 * (ori.y * ori.y + ori.z * ori.z),
      );
      odomPoseRef.current = { x: pos.x, y: pos.y, yaw, time: Date.now() };
    });

    // 2D Pose Estimate を受信したら odom を即座に (0,0,0) にリセット
    // AMCL は次のスキャン処理時に odom→base_link TF を参照して map→odom を計算する。
    // その前に TF=(0,0,0) を push しておくことで map→odom = initialpose となり位置ずれを防ぐ。
    const initialPoseListener = new ROSLIB.Topic({
      ros,
      name: '/initialpose',
      messageType: 'geometry_msgs/msg/PoseWithCovarianceStamped',
    });
    initialPoseListener.subscribe((_message: any) => {
      // animation frame を待たずに即座に TF=(0,0,0) を publish
      if (tfTopicRef.current) {
        try {
          const now = Date.now();
          const sec = Math.floor(now / 1000);
          const nanosec = (now % 1000) * 1_000_000;
          tfTopicRef.current.publish({
            transforms: [
              {
                header: { stamp: { sec, nanosec }, frame_id: 'odom' },
                child_frame_id: 'base_link',
                transform: {
                  translation: { x: 0, y: 0, z: 0 },
                  rotation: { x: 0, y: 0, z: 0, w: 1 },
                },
              },
              {
                header: { stamp: { sec, nanosec }, frame_id: 'base_link' },
                child_frame_id: 'base_scan',
                transform: {
                  translation: { x: 0, y: 0, z: 0.15 },
                  rotation: { x: 0, y: 0, z: 0, w: 1 },
                },
              },
            ],
          });
        } catch {}
      }
      // animation loop にも currentPoseRef を (0,0,0) にリセットさせる
      initialPoseRef.current = { pending: true };
    });

    return () => {
      jointListener.unsubscribe();
      cmdVelListener.unsubscribe();
      odomListener.unsubscribe();
      initialPoseListener.unsubscribe();
      scanTopicRef.current = null;
      tfTopicRef.current = null;
      odomPubTopicRef.current = null;
      odomPoseRef.current = null;
      ros.close();
    };
  }, [jointTopic]);

  const publishScan = (scanData: any) => {
    if (!scanTopicRef.current) return;
    const now = Date.now();
    scanTopicRef.current.publish({
      header: {
        stamp: { sec: Math.floor(now / 1000), nanosec: (now % 1000) * 1_000_000 },
        frame_id: 'base_scan',
      },
      ...scanData,
    });
  };

  // odom → base_link の動的 TF を publish
  // Nav2 ON 時は Nav2 スタック自身が odom → base_link TF を出すため呼ばない
  const publishTF = useCallback((x: number, y: number, yaw: number) => {
    if (!tfTopicRef.current) return;
    try {
      const now = Date.now();
      const sec = Math.floor(now / 1000);
      const nanosec = (now % 1000) * 1_000_000;
      const qz = Math.sin(yaw / 2);
      const qw = Math.cos(yaw / 2);

      tfTopicRef.current.publish(({
        transforms: [
          {
            header: { stamp: { sec, nanosec }, frame_id: 'odom' },
            child_frame_id: 'base_link',
            transform: {
              translation: { x, y, z: 0 },
              rotation: { x: 0, y: 0, z: qz, w: qw },
            },
          },
          // /tf_static の latch に依存しないよう毎フレーム /tf にも含める
          {
            header: { stamp: { sec, nanosec }, frame_id: 'base_link' },
            child_frame_id: 'base_scan',
            transform: {
              translation: { x: 0, y: 0, z: 0.15 },
              rotation: { x: 0, y: 0, z: 0, w: 1 },
            },
          },
        ],
      }));

      // AMCL のモーションモデルに必要な /odom トピックも publish
      odomPubTopicRef.current?.publish(({
        header: { stamp: { sec, nanosec }, frame_id: 'odom' },
        child_frame_id: 'base_link',
        pose: {
          pose: {
            position: { x, y, z: 0 },
            orientation: { x: 0, y: 0, z: qz, w: qw },
          },
          covariance: Array(36).fill(0),
        },
        twist: {
          twist: { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } },
          covariance: Array(36).fill(0),
        },
      }));
    } catch {}
  }, []);

  return { rosStatus, jointPositionsRef, cmdVelRef, needsUpdateRef, publishScan, publishTF, odomPoseRef, initialPoseRef };
}