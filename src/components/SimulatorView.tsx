import React, { useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import * as ROSLIB from 'roslib';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'urdf-viewer': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        up?: string;
        'display-shadow'?: boolean;
        'auto-recenter'?: boolean;
        ref?: any;
      };
    }
  }
}

interface SimulatorViewProps {
  onSceneReady?: (scene: THREE.Scene) => void;
  jointTopic?: string;
}

export function SimulatorView({ onSceneReady, jointTopic = '/joint_states' }: SimulatorViewProps) {
  const viewerRef = useRef<HTMLElement | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [rosStatus, setRosStatus] = useState<string>('Disconnected');

  const jointPositionsRef = useRef<Map<string, number>>(new Map());
  const needsUpdateRef = useRef(false);

  // ★追加: 現在の推定ポーズ（内部で積分して保持する）
  const currentPoseRef = useRef({
    x: 0,
    y: 0,
    yaw: 0
  });

  // ★追加: cmd_vel の値を保持するRef
  const cmdVelRef = useRef({
    linearX: 0,
    angularZ: 0
  });

  // 1. ビューアー初期化 (変更なし)
  useEffect(() => {
    const initViewer = async () => {
      try {
        const THREE = await import(/* @vite-ignore */ 'three') as typeof import('three');
        const { STLLoader } = await import(/* @vite-ignore */ 'three/addons/loaders/STLLoader.js');
        const { GLTFLoader } = await import(/* @vite-ignore */ 'three/addons/loaders/GLTFLoader.js');
        const { ColladaLoader } = await import(/* @vite-ignore */ 'three/addons/loaders/ColladaLoader.js');
        const { OBJLoader } = await import(/* @vite-ignore */ 'three/addons/loaders/OBJLoader.js');
        const customElementModule = await import(/* @vite-ignore */ '/src/urdf-loader/urdf-manipulator-element.js');
        
        if (!customElements.get('urdf-viewer')) {
          customElements.define('urdf-viewer', customElementModule.default);
        }

        const viewer = viewerRef.current as any;
        if (!viewer) return;
        const hostname = window.location.hostname;
        const ASSET_SERVER_URL = `http://${hostname}:8000/`;        

        viewer.loadMeshFunc = (path: string, manager: any, done: any) => {
          let resolvedPath = path;
          if (path.indexOf('file://') > -1) {
             const marker = '/share/';
             const index = path.lastIndexOf(marker);
             if (index > -1) {
                 resolvedPath = ASSET_SERVER_URL + "realsense-ros/" + path.substring(index + marker.length);
             }
          } else {
            resolvedPath = ASSET_SERVER_URL + path;
          }

          const ext = path.split(/\./g).pop()?.toLowerCase();
          switch (ext) {
            case 'gltf': case 'glb': new GLTFLoader(manager).load(resolvedPath, (r: any) => done(r.scene), null, (e: any) => done(null, e)); break;
            case 'obj': new OBJLoader(manager).load(resolvedPath, (r: any) => done(r), null, (e: any) => done(null, e)); break;
            case 'dae': new ColladaLoader(manager).load(resolvedPath, (r: any) => done(r.scene), null, (e: any) => done(null, e)); break;
            case 'stl': new STLLoader(manager).load(resolvedPath, (r: any) => {
                const material = new THREE.MeshPhongMaterial();
                const mesh = new THREE.Mesh(r, material);
                done(mesh);
            }, null, (e: any) => done(null, e)); break;
          }
        };

        viewer.urdf = `${ASSET_SERVER_URL}robot.urdf`;

        const checkScene = setInterval(() => {
            if (viewer.scene) {
                clearInterval(checkScene);
                viewer.scene.background = new THREE.Color('#d1d1d1');
                const gridHelper = new THREE.GridHelper(5, 10);
                gridHelper.position.y = -0.001;
                viewer.scene.add(gridHelper);
                if (viewer.camera) {
                    viewer.camera.position.set(0.4, 0.4, 0.4);
                    viewer.camera.lookAt(0, 0, 0);
                    if (viewer.controls) viewer.controls.update();
                }
                if (onSceneReady) onSceneReady(viewer.scene);
                setIsLoaded(true);
            }
        }, 100);
      } catch (error) {
        console.error("Failed to load modules:", error);
      }
    };
    initViewer();
  }, [onSceneReady]);


  // 2. ROS接続 & 運動学計算ループ
  useEffect(() => {
    const hostname = window.location.hostname;
    const ros = new ROSLIB.Ros({ url: `ws://${hostname}:9090` });
    ros.on('connection', () => setRosStatus('Connected'));
    ros.on('error', () => setRosStatus('Error'));
    ros.on('close', () => setRosStatus('Disconnected'));

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

    // ★追加: cmd_vel トピックの購読
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

    const FPS = 30;
    const INTERVAL = 1000 / FPS;

    let animationFrameId: number;
    let lastTime = performance.now(); // ★変更: dt計算のため高精度タイマーを使用

    const animate = (time: number) => {
        animationFrameId = requestAnimationFrame(animate);

        const delta = time - lastTime;
        if (delta < INTERVAL) return;
        
        // 経過秒数 (dt)
        const dt = delta / 1000;
        lastTime = time;

        const urdfElement = viewerRef.current as any;
        
        if (urdfElement?.robot) {
            
            // ★追加: 簡易シミュレーション（運動学の計算）
            const { linearX, angularZ } = cmdVelRef.current;
            const pose = currentPoseRef.current;

            // 向き(yaw)の更新
            pose.yaw += angularZ * dt;
            // 座標(x, y)の更新 (前進速度を現在の向きに合わせて分解)
            pose.x += linearX * Math.cos(pose.yaw) * dt;
            pose.y += linearX * Math.sin(pose.yaw) * dt;

            // Three.jsのオブジェクトに反映
            urdfElement.robot.position.set(pose.x, pose.y, 0);
            urdfElement.robot.rotation.z = pose.yaw; // urdf-viewerのup=+Z設定に合わせる

            // ジョイントの更新処理
            if (urdfElement.robot.joints && needsUpdateRef.current) {
                jointPositionsRef.current.forEach((position, name) => {
                    const joint = urdfElement.robot.joints[name];
                    if (joint) joint.setJointValue(position);
                });
            }

            if (urdfElement.renderer && urdfElement.scene && urdfElement.camera) {
                urdfElement.renderer.render(urdfElement.scene, urdfElement.camera);
            }
        }
    };

    animate(performance.now());

    return () => {
        cancelAnimationFrame(animationFrameId);
        jointListener.unsubscribe();
        cmdVelListener.unsubscribe(); // ★追加
        ros.close();
    };
  }, [jointTopic]); 


  return (
    <div className="h-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden flex flex-col shadow-sm relative">
      <div className="bg-gray-100 dark:bg-gray-700 px-4 py-2 border-b border-gray-300 dark:border-gray-600 flex-shrink-0 flex justify-between items-center">
        <h2 className="text-sm text-gray-700 dark:text-gray-300">メインシミュレータビュー</h2>
        <div className="text-xs px-2 py-1 rounded bg-white dark:bg-gray-600 shadow-sm">
            Status: <span className={rosStatus === 'Connected' ? 'text-green-600 font-bold' : 'text-red-500'}>{rosStatus}</span>
        </div>
      </div>
      
      <div className="flex-1 relative bg-gray-50 overflow-hidden">
        <urdf-viewer
          ref={viewerRef}
          up="+Z"
          style={{ width: '100%', height: '100%', display: 'block' }}
        ></urdf-viewer>

        {!isLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50 bg-opacity-80">
            <p className="text-gray-500">Loading...</p>
          </div>
        )}
      </div>
    </div>
  );
}
