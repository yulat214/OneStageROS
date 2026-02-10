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
}

export function SimulatorView({ onSceneReady }: SimulatorViewProps) {
  const viewerRef = useRef<HTMLElement | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [rosStatus, setRosStatus] = useState<string>('Disconnected');

  // ★変更点1: 配列をやめて「辞書（Map）」にする
  // これにより、データが無限に溜まることを防ぎ、常に最新値だけを保持します
  const jointPositionsRef = useRef<Map<string, number>>(new Map());
  // 描画が必要かどうかのフラグ
  const needsUpdateRef = useRef(false);

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

        viewer.loadMeshFunc = (path: string, manager: any, done: any) => {
          const ASSET_SERVER_URL = 'http://localhost:8000/';
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

        viewer.urdf = 'http://localhost:8000/robot.urdf';

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


  // 2. ROS接続 & 辞書ベースの高速描画
  useEffect(() => {
    const ros = new ROSLIB.Ros({ url: 'ws://localhost:9090' });

    ros.on('connection', () => setRosStatus('Connected'));
    ros.on('error', () => setRosStatus('Error'));
    ros.on('close', () => setRosStatus('Disconnected'));

    const jointListener = new ROSLIB.Topic({
      ros: ros,
      name: '/joint_states',
      messageType: 'sensor_msgs/msg/JointState'
    });

    // ★変更点2: 受信時にMapを更新する
    jointListener.subscribe((message: any) => {
        for (let i = 0; i < message.name.length; i++) {
            // 各ジョイントの「最新の値」を上書き保存
            jointPositionsRef.current.set(message.name[i], message.position[i]);
        }
        needsUpdateRef.current = true; // 「新しいデータがあるよ」フラグを立てる
    });

    // FPS制限 (30fps)
    const FPS = 30;
    const INTERVAL = 1000 / FPS;

    let animationFrameId: number;
    let lastTime = 0;

    const animate = (currentTime: number) => {
        animationFrameId = requestAnimationFrame(animate);

        const delta = currentTime - lastTime;
        if (delta < INTERVAL) {
            return;
        }
        lastTime = currentTime - (delta % INTERVAL);

        const urdfElement = viewerRef.current as any;
        
        // ★変更点3: Mapの中身を適用する
        // データが何万回来ようが、ここは「ジョイントの数」しかループしないので超高速・一定負荷
        if (urdfElement?.robot?.joints) {
            
            // 新しいデータが来ている時だけ関節を動かす
            if (needsUpdateRef.current) {
                jointPositionsRef.current.forEach((position, name) => {
                    const joint = urdfElement.robot.joints[name];
                    if (joint) {
                        joint.setJointValue(position);
                    }
                });
                // needsUpdateRef.current = false; // ← 安全のため、あえてフラグを下ろさず毎回適用してもOK（今回は念には念を入れて常時適用モードにします）
            }

            // 強制描画は常に行う
            if (urdfElement.renderer && urdfElement.scene && urdfElement.camera) {
                urdfElement.renderer.render(urdfElement.scene, urdfElement.camera);
            }
        }
    };

    animate(0);

    return () => {
        cancelAnimationFrame(animationFrameId);
        jointListener.unsubscribe();
        ros.close();
    };
  }, []); 


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
