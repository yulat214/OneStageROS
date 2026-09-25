import { useCallback, useEffect, useRef, useState } from 'react';
import * as ROSLIB from 'roslib';

type RosStamp = { sec: number; nanosec: number };

// 'server': サーバー（assets-server.js の sim-core）が移動計算と /tf・/onestage/odom を担当し、
//           ブラウザは /onestage/sim_pose を描画するだけ
// 'local' : サーバー側が使えない（rclnodejs 不可など）ので従来どおりブラウザが publish する
// 'unknown': 判定前。二重 publish を避けるため、この間はどちらの publish もしない
export type SimMode = 'unknown' | 'server' | 'local';

export function useROS(jointTopic: string) {
  const [rosStatus, setRosStatus] = useState<string>('Disconnected');
  const [simMode, setSimMode] = useState<SimMode>('unknown');
  const simModeRef = useRef<SimMode>('unknown');
  // サーバー側シミュレーションのロボット位置（ワールド座標）と、その TF と同じスタンプ
  const simPoseRef = useRef<{ x: number; y: number; yaw: number; stamp: RosStamp } | null>(null);
  // rosbridge 切断時にインクリメントして useEffect を張り直す（roslib は自動再接続しないため）
  const [reconnectKey, setReconnectKey] = useState(0);

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
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

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
      // 切断中に最後の速度指令で走り続けないよう停止させる
      cmdVelRef.current = { linearX: 0, angularZ: 0 };
      if (!disposed && !reconnectTimer) {
        reconnectTimer = setTimeout(() => setReconnectKey((k) => k + 1), 2000);
      }
    });

    // rosbridge(Python) は全メッセージを JSON 化して送るため、高頻度トピックを
    // そのまま購読すると rosbridge が詰まり WebSocket 切断の原因になる。
    // 連続して流れる状態系トピックだけ間引く（最新値が次の周期で必ず届くもの）。
    // /cmd_vel・/initialpose は最後の1通（停止指令等）を落とすと困るので間引かない。

    // ジョイント状態の購読（joint_state_broadcaster は 100Hz → 描画周期の 30Hz に間引く）
    const jointListener = new ROSLIB.Topic({
      ros: ros,
      name: jointTopic,
      messageType: 'sensor_msgs/msg/JointState',
      throttle_rate: 33,
      queue_length: 1,
    });

    jointListener.subscribe((message: any) => {
      for (let i = 0; i < message.name.length; i++) {
        jointPositionsRef.current.set(message.name[i], message.position[i]);
      }
      needsUpdateRef.current = true;
    });

    // Nav2 オドメトリの購読（diff_drive_controller は 50Hz → 10Hz に間引く）
    const odomListener = new ROSLIB.Topic({
      ros,
      name: '/odom',
      messageType: 'nav_msgs/msg/Odometry',
      throttle_rate: 100,
      queue_length: 1,
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

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      jointListener.unsubscribe();
      odomListener.unsubscribe();
      scanTopicRef.current = null;
      tfTopicRef.current = null;
      odomPubTopicRef.current = null;
      odomPoseRef.current = null;
      ros.close();
    };
  }, [jointTopic, reconnectKey]);

  // サーバー側シミュレーションの有無を判定する（assets-server が起動するまで再試行）
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = async () => {
      try {
        const res = await fetch(`http://${window.location.hostname}:8000/api/sim/status`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { enabled } = await res.json() as { enabled: boolean };
        if (cancelled) return;
        const mode: SimMode = enabled ? 'server' : 'local';
        simModeRef.current = mode;
        setSimMode(mode);
        console.log(`[SIM] mode: ${mode}`);
      } catch {
        if (!cancelled) timer = setTimeout(check, 3000);
      }
    };
    check();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  // モードごとの購読・publish（接続し直すたびに張り直す）
  useEffect(() => {
    const ros = rosRef.current;
    if (!ros || rosStatus !== 'Connected' || simMode === 'unknown') return;

    if (simMode === 'server') {
      const simPoseListener = new ROSLIB.Topic({
        ros,
        name: '/onestage/sim_pose',
        messageType: 'geometry_msgs/msg/PoseStamped',
        throttle_rate: 33,
        queue_length: 1,
      });
      simPoseListener.subscribe((message: any) => {
        const p = message.pose.position;
        const o = message.pose.orientation;
        simPoseRef.current = {
          x: p.x,
          y: p.y,
          yaw: Math.atan2(2 * (o.w * o.z + o.x * o.y), 1 - 2 * (o.y * o.y + o.z * o.z)),
          stamp: message.header.stamp,
        };
      });
      return () => { simPoseListener.unsubscribe(); };
    }

    // --- 以下 local モード（従来のブラウザ publish） ---

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

    // 速度指令の購読
    const cmdVelListener = new ROSLIB.Topic({
      ros,
      name: '/cmd_vel',
      messageType: 'geometry_msgs/msg/Twist'
    });

    cmdVelListener.subscribe((message: any) => {
      cmdVelRef.current = {
        linearX: message.linear.x,
        angularZ: message.angular.z
      };
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
      cmdVelListener.unsubscribe();
      initialPoseListener.unsubscribe();
    };
  }, [rosStatus, simMode]);

  // stampMs省略時はDate.now()を使うが、可能な限り同一フレームでpublishTFに
  // 渡した値と揃えること。scanのタイムスタンプがTFより後になると、AMCL側の
  // tf2が「未来への外挿」としてルックアップを拒否し
  // "Couldn't determine robot's pose associated with laser scan" の原因になる。
  // local モード専用（server モードではサーバーが /scan を出す）。stamp は ms か ROS の stamp
  const publishScan = (scanData: any, stamp?: number | RosStamp) => {
    if (!scanTopicRef.current) return;
    let rosStamp: RosStamp;
    if (typeof stamp === 'object') {
      rosStamp = stamp;
    } else {
      const now = stamp ?? Date.now();
      rosStamp = { sec: Math.floor(now / 1000), nanosec: (now % 1000) * 1_000_000 };
    }
    scanTopicRef.current.publish({
      header: {
        stamp: rosStamp,
        frame_id: 'base_scan',
      },
      ...scanData,
    });
  };

  // odom → base_link の動的 TF を publish
  // Nav2 ON 時は Nav2 スタック自身が odom → base_link TF を出すため呼ばない
  const publishTF = useCallback((x: number, y: number, yaw: number, stampMs?: number) => {
    if (!tfTopicRef.current || simModeRef.current !== 'local') return;
    try {
      const now = stampMs ?? Date.now();
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

  return { rosStatus, jointPositionsRef, cmdVelRef, needsUpdateRef, publishScan, publishTF, odomPoseRef, initialPoseRef, simMode, simModeRef, simPoseRef };
}