import React, { useEffect, useRef, useState, useCallback } from 'react';
import type * as THREE from 'three';
import { useROS } from '../hooks/useROS';
import { useWorldManager } from '../hooks/useWorldManager'; 
import { useLidarSim } from '../hooks/useLidarSim';         

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

// サーバー内のファイルを取得・表示するサブコンポーネント
function ServerFileBrowser({ onClose, onSelectFile }: { onClose: () => void, onSelectFile: (path: string) => void }) {
  const [currentPath, setCurrentPath] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const hostname = window.location.hostname;

  const fetchFiles = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const res = await fetch(`http://${hostname}:8000/api/ls?path=${path}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setItems(data);
      setCurrentPath(path);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [hostname]);

  useEffect(() => {
    fetchFiles(''); 
  }, [fetchFiles]);

  const handleItemClick = (item: any) => {
    if (item.isDirectory) {
      fetchFiles(item.path);
    } else {
      const ext = item.name.split('.').pop()?.toLowerCase();
      if (['stl', 'dae', 'glb', 'gltf'].includes(ext || '')) {
        onSelectFile(item.path);
      } else {
        alert('配置できるのは3Dモデル形式（.stl, .dae, .glb, .gltf）のみです。');
      }
    }
  };

  const handleGoUp = () => {
    const parts = currentPath.split('/');
    parts.pop();
    fetchFiles(parts.join('/'));
  };

  return (
    <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center">
      <div className="bg-white dark:bg-gray-800 w-96 h-[70vh] rounded-xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 dark:border-gray-700">

        <div className="p-2 bg-gray-100 dark:bg-gray-900 text-[10px] text-gray-500 truncate flex-shrink-0">
          Current: /{currentPath}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-2">
          {loading ? (
            <div className="text-center py-4 text-gray-500">Loading...</div>
          ) : (
            <ul className="space-y-1">
              {currentPath !== '' && (
                <li 
                  className="px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer rounded flex items-center gap-2 text-gray-500"
                  onClick={handleGoUp}
                >
                  📁 <span className="font-medium">.. (上の階層へ)</span>
                </li>
              )}
              {items.map((item, idx) => (
                <li 
                  key={idx}
                  className="px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-900 cursor-pointer rounded flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"
                  onClick={() => handleItemClick(item)}
                >
                  {item.isDirectory ? '📁' : '📄'} {item.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function SimulatorView({ onSceneReady, jointTopic = '/joint_states' }: SimulatorViewProps) {
  const viewerRef = useRef<HTMLElement | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [scene, setScene] = useState<THREE.Scene | null>(null); 
  const [isBrowserOpen, setIsBrowserOpen] = useState(false); 
  const [isObjectListOpen, setIsObjectListOpen] = useState(false); // 個別削除メニューの開閉状態

  const { rosStatus, jointPositionsRef, cmdVelRef, needsUpdateRef, publishScan } = useROS(jointTopic);
  const { obstacles, addWorldModel, removeObjectById, clearObstacles, exportEnvironment, loadEnvironment } = useWorldManager(scene);
  const { simulateLidar } = useLidarSim();

  const currentPoseRef = useRef({ x: 0, y: 0, yaw: 0 });
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);

  const STORAGE_POSE_KEY = 'onestage_ros_pose';
  const STORAGE_ENV_KEY = 'onestage_ros_environment';
  const isRestoringRef = useRef(false);
  const obstaclesInitRef = useRef(true);

  const togglePause = () => {
    isPausedRef.current = !isPausedRef.current;
    setIsPaused(isPausedRef.current);
  };

  const resetPose = () => {
    currentPoseRef.current = { x: 0, y: 0, yaw: 0 };
    cmdVelRef.current = { linearX: 0, angularZ: 0 };
    isPausedRef.current = false;
    setIsPaused(false);
    const urdfElement = viewerRef.current as any;
    if (urdfElement?.robot) {
      urdfElement.robot.position.set(0, 0, 0);
      urdfElement.robot.rotation.z = 0;
    }
  };

  const handleServerFileSelect = (filePath: string) => {
    setIsBrowserOpen(false);
    const hostname = window.location.hostname;
    const fileUrl = `http://${hostname}:8000/workspace/${filePath}`;
    
    const input = window.prompt("配置する座標を「X, Y, Z」のカンマ区切りで入力してください\n（例: ロボットの前方なら 1.5, 0, 0）", "1.5, 0, 0");
    if (!input) return;

    const [x, y, z] = input.split(',').map(Number);
    if (addWorldModel) {
      addWorldModel(fileUrl, [x || 0, y || 0, z || 0], [-Math.PI / 2, 0, 0]);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const blobUrl = URL.createObjectURL(file);
    const input = window.prompt("配置する座標を「X, Y, Z」のカンマ区切りで入力してください", "1.5, 0, 0");
    
    if (input && addWorldModel) {
      const [x, y, z] = input.split(',').map(Number);
      addWorldModel(blobUrl, [x || 0, y || 0, z || 0], [-Math.PI / 2, 0, 0]);
    }
    event.target.value = '';
  };

  useEffect(() => {
    const initViewer = async () => {
      try {
        const THREE = await import('three') as typeof import('three');
        const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
        const { ColladaLoader } = await import('three/addons/loaders/ColladaLoader.js');
        const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
        const customElementModule = await import('../urdf-loader/urdf-manipulator-element.js');
        
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
                
                setScene(viewer.scene);
                setIsLoaded(true);
            }
        }, 100);
      } catch (error) {
        console.error("Failed to load modules:", error);
      }
    };
    initViewer();
  }, [onSceneReady]);

  // シーン準備完了時に保存済み状態を復元する
  useEffect(() => {
    if (!isLoaded) return;

    try {
      const raw = localStorage.getItem(STORAGE_POSE_KEY);
      if (raw) currentPoseRef.current = JSON.parse(raw);
    } catch {}

    (async () => {
      try {
        const raw = localStorage.getItem(STORAGE_ENV_KEY);
        if (raw) {
          isRestoringRef.current = true;
          await loadEnvironment(JSON.parse(raw));
          isRestoringRef.current = false;
        }
      } catch {
        isRestoringRef.current = false;
      }
    })();
  }, [isLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // ポーズを1秒ごとに自動保存
  useEffect(() => {
    const id = setInterval(() => {
      localStorage.setItem(STORAGE_POSE_KEY, JSON.stringify(currentPoseRef.current));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // 障害物が変化するたびに環境を自動保存（初回・復元中はスキップ）
  useEffect(() => {
    if (obstaclesInitRef.current) { obstaclesInitRef.current = false; return; }
    if (isRestoringRef.current) return;
    localStorage.setItem(STORAGE_ENV_KEY, JSON.stringify({
      objects: obstacles.map(obj => ({
        name: obj.name,
        uri: obj.sourceUrl,
        pose: [...obj.position, ...obj.rotation]
      }))
    }));
  }, [obstacles]);

  useEffect(() => {
    if (!scene) return;

    const FPS = 30;
    const INTERVAL = 1000 / FPS;
    let animationFrameId: number;
    let lastTime = performance.now();
    let scanCounter = 0; 

    const animate = (time: number) => {
        animationFrameId = requestAnimationFrame(animate);

        const delta = time - lastTime;
        if (delta < INTERVAL) return;
        
        const dt = delta / 1000;
        lastTime = time;

        const urdfElement = viewerRef.current as any;
        
        if (urdfElement?.robot) {
            if (!isPausedRef.current) {
                const { linearX, angularZ } = cmdVelRef.current;
                const pose = currentPoseRef.current;

                pose.yaw += angularZ * dt;
                pose.x += linearX * Math.cos(pose.yaw) * dt;
                pose.y += linearX * Math.sin(pose.yaw) * dt;

                urdfElement.robot.position.set(pose.x, pose.y, 0);
                urdfElement.robot.rotation.z = pose.yaw;
            }

            if (urdfElement.robot.joints && needsUpdateRef.current) {
                jointPositionsRef.current.forEach((position, name) => {
                    const joint = urdfElement.robot.joints[name];
                    if (joint) joint.setJointValue(position);
                });
            }

            if (scanCounter++ % 3 === 0) {
              // renderer.render() より前なので matrixWorld が古い。
              // transformDirection が正しく動くよう事前に更新する。
              urdfElement.robot.updateMatrixWorld(true);
              const meshList = obstacles.map(obj => obj.mesh);
              const scanData = simulateLidar(urdfElement.robot, meshList);
              publishScan(scanData);
            }

            if (urdfElement.renderer && urdfElement.scene && urdfElement.camera) {
                urdfElement.renderer.render(urdfElement.scene, urdfElement.camera);
            }
        }
    };

    animate(performance.now());
    return () => cancelAnimationFrame(animationFrameId);
  }, [scene, obstacles, cmdVelRef, jointPositionsRef, needsUpdateRef, simulateLidar, publishScan]); 

  return (
    <div className="h-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden flex flex-col shadow-sm relative">
      
      {/* ヘッダー部分 */}
      <div className="bg-gray-100 dark:bg-gray-700 px-4 py-2 border-b border-gray-300 dark:border-gray-600 flex justify-between items-center z-20">
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">メインシミュレータビュー</h2>
        <div className="flex gap-3 items-center">
          <button
            onClick={togglePause}
            className={`text-xs px-3 py-1.5 rounded shadow-sm font-medium transition-colors ${
              isPaused
                ? 'bg-green-500 hover:bg-green-600 text-white'
                : 'bg-yellow-500 hover:bg-yellow-600 text-white'
            }`}
          >
            {isPaused ? '▶ 再開' : '⏸ 停止'}
          </button>
          <button
            onClick={resetPose}
            className="text-xs bg-gray-500 hover:bg-gray-600 text-white px-3 py-1.5 rounded shadow-sm font-medium transition-colors"
          >
            ↩ リセット
          </button>
          <button
            onClick={exportEnvironment}
            className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded shadow-sm flex items-center transition-colors"
          >
            💾 配置を保存
          </button>
          <label className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded shadow-sm cursor-pointer transition-all">
            📂 配置呼び出し
            <input 
              type="file" 
              accept=".json" 
              className="hidden" 
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = (event) => {
                  try {
                    const json = JSON.parse(event.target?.result as string);
                    loadEnvironment(json);
                  } catch (err) {
                    alert("JSONの解析に失敗しました。");
                  }
                };
                reader.readAsText(file);
                e.target.value = '';
              }} 
            />
          </label>
          <div className="text-xs px-2 py-1 rounded bg-white dark:bg-gray-600 shadow-sm border border-gray-200 dark:border-gray-500">
            Status: <span className={rosStatus === 'Connected' ? 'text-green-600 font-bold' : 'text-red-500'}>{rosStatus}</span>
          </div>
        </div>
      </div>
      
      <div className="flex-1 relative bg-gray-50 overflow-hidden">
        
        {/* メイン操作ボタン群（右上） */}
        <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 items-end">

          <button 
            onClick={() => setIsBrowserOpen(prev => !prev)}
            className="bg-white hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-600 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-4 py-2 rounded shadow-md text-xs font-medium transition-colors"
          >
            {isBrowserOpen ? "✕ 一覧を閉じる" : "📂 配置するオブジェクトを選択"}
          </button>

          <button 
            onClick={() => setIsObjectListOpen(prev => !prev)}
            className={`px-4 py-2 rounded shadow-md text-xs font-medium transition-colors border ${
              isObjectListOpen 
              ? "bg-amber-50 border-amber-200 text-amber-700" 
              : "bg-white hover:bg-gray-50 border-gray-200 text-gray-700 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200"
            }`}
          >
            {isObjectListOpen ? "✕ 削除メニューを閉じる" : "✂️ 選択したオブジェクトを削除"}
          </button>

          <button 
            onClick={clearObstacles}
            className="bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 px-4 py-2 rounded shadow-md text-xs font-medium transition-colors mt-2"
          >
            🗑️ すべてのオブジェクトを消去
          </button>
        </div>

        {/* 個別削除用オーバーレイメニュー */}
        {isObjectListOpen && (
          <div className="absolute top-4 left-4 z-30 w-56 bg-white/90 dark:bg-gray-800/90 backdrop-blur border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl overflow-hidden">

            <div className="max-h-60 overflow-y-auto p-1">
              {obstacles.length === 0 ? (
                <div className="text-[11px] text-gray-400 text-center py-4">配置されたオブジェクトはありません</div>
              ) : (
                <ul className="space-y-0.5">
                  {obstacles.map(obj => (
                    <li key={obj.id} className="flex justify-between items-center hover:bg-red-50 dark:hover:bg-red-900/20 px-2 py-1.5 rounded transition-colors group">
                      <span className="text-[11px] truncate text-gray-700 dark:text-gray-300 mr-2">{obj.name}</span>
                      <button 
                        onClick={() => removeObjectById(obj.id)}
                        className="text-gray-300 group-hover:text-red-500 transition-colors px-1"
                      >
                        🗑️
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* サーバーファイルブラウザ（オーバーレイ） */}
        {isBrowserOpen && (
          <ServerFileBrowser 
            onClose={() => setIsBrowserOpen(false)} 
            onSelectFile={handleServerFileSelect} 
          />
        )}

        <urdf-viewer
          ref={viewerRef}
          up="+Z"
          style={{ width: '100%', height: '100%', display: 'block' }}
        ></urdf-viewer>

        {!isLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50/80 backdrop-blur-sm z-40">
            <p className="text-gray-500 font-medium tracking-wide animate-pulse">Loading Simulator...</p>
          </div>
        )}
      </div>
    </div>
  );
}