import { useEffect, useRef, useState } from 'react';
import * as ROSLIB from 'roslib';

export function useROS(jointTopic: string) {
  const [rosStatus, setRosStatus] = useState<string>('Disconnected');

  // 描画ループ内で参照・更新するためのRef
  const jointPositionsRef = useRef<Map<string, number>>(new Map());
  const cmdVelRef = useRef({ linearX: 0, angularZ: 0 });
  const needsUpdateRef = useRef(false);
  const rosRef = useRef<ROSLIB.Ros | null>(null);
  const scanTopicRef = useRef<ROSLIB.Topic | null>(null);
  // Nav2 オドメトリ: 受信時刻を含む。null = 未受信（デッドレコニングにフォールバック）
  const odomPoseRef = useRef<{ x: number; y: number; yaw: number; time: number } | null>(null);

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
    });
    ros.on('error', () => { setRosStatus('Error'); scanTopicRef.current = null; });
    ros.on('close', () => { setRosStatus('Disconnected'); scanTopicRef.current = null; });

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

    return () => {
      jointListener.unsubscribe();
      cmdVelListener.unsubscribe();
      odomListener.unsubscribe();
      scanTopicRef.current = null;
      odomPoseRef.current = null;
      ros.close();
    };
  }, [jointTopic]);

  const publishScan = (scanData: any) => {
    if (!scanTopicRef.current) return;
    scanTopicRef.current.publish({
      header: {
        stamp: { sec: Math.floor(Date.now() / 1000), nanosec: 0 },
        frame_id: 'base_scan',
      },
      ...scanData,
    });
  };

  return { rosStatus, jointPositionsRef, cmdVelRef, needsUpdateRef, publishScan, odomPoseRef };
}