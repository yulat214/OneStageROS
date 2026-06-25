import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X } from 'lucide-react';
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

type PlacementKind =
  | { type: 'primitive'; geoType: 'box' | 'cylinder' | 'sphere' }
  | { type: 'sdf'; filePath: string }
  | { type: 'mesh'; url: string };

// サーバー内のファイルを取得・表示するサブコンポーネント
function ServerFileBrowser({
  onClose,
  onSelectFile,
  title = '配置するオブジェクトを選択',
  acceptExtensions = ['stl', 'dae', 'glb', 'gltf'],
}: {
  onClose: () => void;
  onSelectFile: (path: string) => void;
  title?: string;
  acceptExtensions?: string[];
}) {
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
      if (acceptExtensions.includes(ext || '')) {
        onSelectFile(item.path);
      } else {
        alert(`選択できる形式は ${acceptExtensions.join(', ')} のみです。`);
      }
    }
  };

  const handleGoUp = () => {
    const parts = currentPath.split('/');
    parts.pop();
    fetchFiles(parts.join('/'));
  };

  return (
    <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 w-96 h-[70vh] rounded-xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 dark:border-gray-700" onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <span className="font-medium text-sm text-gray-800 dark:text-gray-100">{title}</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded p-0.5 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-3 py-1 bg-gray-50 dark:bg-gray-900 text-[10px] text-gray-400 truncate flex-shrink-0">
          /{currentPath}
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
  const [isFileBrowserOpen, setIsFileBrowserOpen] = useState(false);
  const [isObjectListOpen, setIsObjectListOpen] = useState(false); // 個別削除メニューの開閉状態

  const { rosStatus, jointPositionsRef, cmdVelRef, needsUpdateRef, publishScan, odomPoseRef } = useROS(jointTopic);
  const { obstacles, addWorldModel, addBuiltMesh, removeObjectById, clearObstacles, exportEnvironment, loadEnvironment } = useWorldManager(scene);
  const { simulateLidar } = useLidarSim();

  const currentPoseRef = useRef({ x: 0, y: 0, yaw: 0 });
  const [isPaused, setIsPaused] = useState(false);

  // 配置モード（プリミティブ用カーソル追従）
  const [placement, setPlacement] = useState<PlacementKind | null>(null);
  const ghostRef = useRef<import('three').Object3D | null>(null);
  const groundMeshRef = useRef<import('three').Mesh | null>(null);
  const threeRef = useRef<typeof import('three') | null>(null);
  const overlayPointerDownRef = useRef(false);
  const placementEntryTimeRef = useRef(0);
  const isPausedRef = useRef(false);
  // Nav2 モード: true の時だけ /odom でロボット位置を上書きする
  const [isNav2Mode, setIsNav2Mode] = useState(false);
  const isNav2ModeRef = useRef(false);

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

  const enterPlacement = async (kind: PlacementKind) => {
    const THREE = await import('three');
    threeRef.current = THREE;
    const viewer = viewerRef.current as any;
    if (!viewer?.scene) return;

    // 既存ゴーストを除去
    if (ghostRef.current) {
      viewer.scene.remove(ghostRef.current);
      const g = ghostRef.current as any;
      g.geometry?.dispose(); g.material?.dispose();
      ghostRef.current = null;
    }

    if (viewer.controls) viewer.controls.enabled = false;
    overlayPointerDownRef.current = false;
    const ghostMat = () => new THREE.MeshPhongMaterial({ color: 0x4488ff, opacity: 0.6, transparent: true });

    if (kind.type === 'primitive') {
      const t = kind.geoType;
      let geo: import('three').BufferGeometry;
      if (t === 'box') geo = new THREE.BoxGeometry(1, 1, 1);
      else if (t === 'cylinder') geo = new THREE.CylinderGeometry(0.3, 0.3, 0.5, 16);
      else geo = new THREE.SphereGeometry(0.3, 16, 12);
      const ghost = new THREE.Mesh(geo, ghostMat());
      viewer.scene.add(ghost);
      ghostRef.current = ghost;
      setPlacement(kind);
      placementEntryTimeRef.current = Date.now();
    } else if (kind.type === 'mesh') {
      // メッシュファイル: プレースホルダーを先に出し、実モデルを非同期ロードしてゴースト化
      const placeholder = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), ghostMat());
      viewer.scene.add(placeholder);
      ghostRef.current = placeholder;
      setPlacement(kind);
      placementEntryTimeRef.current = Date.now();

      const applyMeshGhost = (loaded: import('three').Object3D) => {
        if (!ghostRef.current) return;
        loaded.rotation.set(-Math.PI / 2, 0, 0);
        loaded.traverse((child: any) => { if (child.isMesh) child.material = ghostMat(); });
        const parent = ghostRef.current.parent;
        if (parent) {
          const pos = ghostRef.current.position.clone();
          parent.remove(ghostRef.current);
          loaded.position.copy(pos);
          parent.add(loaded);
        }
        ghostRef.current = loaded;
      };

      const ext = kind.url.split('.').pop()?.toLowerCase();
      try {
        if (ext === 'dae') {
          const { ColladaLoader } = await import('three/addons/loaders/ColladaLoader.js');
          new ColladaLoader().load(kind.url, (r: any) => applyMeshGhost(r.scene));
        } else if (ext === 'glb' || ext === 'gltf') {
          const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
          new GLTFLoader().load(kind.url, (r: any) => applyMeshGhost(r.scene));
        } else if (ext === 'stl') {
          const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
          new STLLoader().load(kind.url, (geo: any) => applyMeshGhost(new THREE.Mesh(geo, ghostMat())));
        } else if (ext === 'obj') {
          const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
          new OBJLoader().load(kind.url, (obj: any) => applyMeshGhost(obj));
        }
      } catch { /* プレースホルダーのままにする */ }
    } else {
      // SDF / .model: まず軸+球インジケーター → バックグラウンドで実メッシュをロード
      const group = new THREE.Group();
      const indicatorSphere = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), ghostMat());
      group.add(indicatorSphere);
      group.add(new THREE.AxesHelper(0.4));
      viewer.scene.add(group);
      ghostRef.current = group;
      setPlacement(kind);
      placementEntryTimeRef.current = Date.now();

      try {
        const hostname = window.location.hostname;
        const res = await fetch(`http://${hostname}:8000/api/convert-sdf?path=${encodeURIComponent(kind.filePath)}`);
        if (!res.ok || !ghostRef.current) return;
        const data = await res.json();
        if (!ghostRef.current) return;

        let anyLoaded = false;
        await Promise.all((data.objects ?? []).map(async (obj: any) => {
          if (!ghostRef.current) return;
          const [sx = 0, sy = 0, sz = 0, , , yaw = 0] = obj.pose as number[];
          const relPos: [number, number, number] = [sx, sz, -sy];
          const rotY = -yaw;

          if (obj.type === 'mesh') {
            const meshUrl = `http://${hostname}:8000${obj.url}`;
            const ext = meshUrl.split('.').pop()?.toLowerCase();
            const orientQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
            const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
            const euler = new THREE.Euler().setFromQuaternion(
              new THREE.Quaternion().multiplyQuaternions(yawQ, orientQ), 'XYZ'
            );

            const addToGroup = (loaded: THREE.Object3D) => {
              if (!ghostRef.current) return;
              loaded.position.set(...relPos);
              loaded.rotation.set(euler.x, euler.y, euler.z);
              // ColladaLoader が単位変換スケールを持つため set ではなく *= で重ねる（addWorldModel と同じ挙動）
              const sc = obj.scale ?? [1, 1, 1];
              loaded.scale.x *= sc[0];
              loaded.scale.y *= sc[1];
              loaded.scale.z *= sc[2];
              loaded.traverse((c: any) => { if (c.isMesh) c.material = ghostMat(); });
              group.add(loaded);
              anyLoaded = true;
            };

            try {
              if (ext === 'dae') {
                const { ColladaLoader } = await import('three/addons/loaders/ColladaLoader.js');
                await new Promise<void>((ok, ng) => new ColladaLoader().load(meshUrl, r => { addToGroup(r.scene); ok(); }, undefined, ng));
              } else if (ext === 'glb' || ext === 'gltf') {
                const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
                await new Promise<void>((ok, ng) => new GLTFLoader().load(meshUrl, r => { addToGroup(r.scene); ok(); }, undefined, ng));
              } else if (ext === 'stl') {
                const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
                await new Promise<void>((ok, ng) => new STLLoader().load(meshUrl, geo => { addToGroup(new THREE.Mesh(geo, ghostMat())); ok(); }, undefined, ng));
              }
            } catch { /* 個別メッシュ失敗は無視 */ }
          } else {
            let geo: THREE.BufferGeometry | null = null;
            if (obj.type === 'cylinder') geo = new THREE.CylinderGeometry(obj.radius, obj.radius, obj.length, 16);
            else if (obj.type === 'box') { const [bx, by, bz] = obj.size ?? [0.5, 0.5, 0.5]; geo = new THREE.BoxGeometry(bx, bz, by); }
            else if (obj.type === 'sphere') geo = new THREE.SphereGeometry(obj.radius, 16, 12);
            if (geo) {
              const m = new THREE.Mesh(geo, ghostMat());
              m.position.set(...relPos);
              m.rotation.y = rotY;
              group.add(m);
              anyLoaded = true;
            }
          }
        }));

        // 実形状が1つでも読み込めたら球インジケーターを除去
        if (anyLoaded && ghostRef.current) group.remove(indicatorSphere);
      } catch { /* SDF解析失敗 → 球インジケーターのまま */ }
    }
  };

  const exitPlacement = useCallback(() => {
    const viewer = viewerRef.current as any;
    if (ghostRef.current && viewer?.scene) {
      viewer.scene.remove(ghostRef.current);
      ghostRef.current.traverse((child: any) => {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) child.material.forEach((m: any) => m.dispose());
        else child.material?.dispose();
      });
      ghostRef.current = null;
    }
    if (viewer?.controls) viewer.controls.enabled = true;
    setPlacement(null);
  }, []);

  const handlePlacementMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!ghostRef.current || !threeRef.current || !groundMeshRef.current) return;
    const THREE = threeRef.current;
    const viewer = viewerRef.current as any;
    if (!viewer?.camera) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(nx, ny), viewer.camera);
    const hits = raycaster.intersectObject(groundMeshRef.current);
    if (hits.length > 0) {
      const p = hits[0].point;
      // シーン未追加（モデル非同期ロード後）なら初回ヒット時に追加
      if (!ghostRef.current.parent) viewer.scene.add(ghostRef.current);
      ghostRef.current.position.set(p.x, p.y, p.z);
    }
  }, []);

  const handlePlacementClick = useCallback(async () => {
    if (!placement || !ghostRef.current || !threeRef.current) return;
    // 配置モード開始から500ms以内のクリックは無視（ファイル選択のダブルクリック対策）
    if (Date.now() - placementEntryTimeRef.current < 500) return;
    // オーバーレイ上で pointerdown が起きていない場合も無視
    if (!overlayPointerDownRef.current) return;
    overlayPointerDownRef.current = false;
    const THREE = threeRef.current;
    const p = ghostRef.current.position;

    if (placement.type === 'primitive') {
      const g = placement.geoType;
      let geo: import('three').BufferGeometry;
      let uri = '';
      if (g === 'box') {
        geo = new THREE.BoxGeometry(1, 1, 1);
        uri = 'primitive://box?x=1&y=1&z=1';
      } else if (g === 'cylinder') {
        geo = new THREE.CylinderGeometry(0.3, 0.3, 0.5, 16);
        uri = 'primitive://cylinder?r=0.3&l=0.5';
      } else {
        geo = new THREE.SphereGeometry(0.3, 16, 12);
        uri = 'primitive://sphere?r=0.3';
      }
      addBuiltMesh(new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: 0x8899aa })), g, [p.x, p.y, p.z], [0, 0, 0], uri);
    } else if (placement.type === 'mesh') {
      await addWorldModel(placement.url, [p.x, p.y, p.z], [-Math.PI / 2, 0, 0]);
    } else {
      // SDF モデルをクリック位置にオフセットして配置
      exitPlacement(); // ゴーストを先に消す
      const hostname = window.location.hostname;
      try {
        const res = await fetch(
          `http://${hostname}:8000/api/convert-sdf?path=${encodeURIComponent(placement.filePath)}`
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'SDF読み込みエラー');
        let loaded = 0;
        for (const obj of (data.objects ?? [])) {
          const [sx, sy, sz, , , yaw] = obj.pose as number[];
          // SDF Z-up → Three.js Y-up 変換 + クリック位置オフセット
          const pos: [number, number, number] = [
            (sx ?? 0) + p.x,
            (sz ?? 0) + p.y,
            -(sy ?? 0) + p.z,
          ];
          const rotY = -(yaw ?? 0);
          if (obj.type === 'mesh') {
            const meshUrl = `http://${hostname}:8000${obj.url}`;
            const orientQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
            const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
            const euler = new THREE.Euler().setFromQuaternion(
              new THREE.Quaternion().multiplyQuaternions(yawQ, orientQ), 'XYZ'
            );
            addWorldModel(meshUrl, pos, [euler.x, euler.y, euler.z], obj.scale ?? [1, 1, 1]);
            loaded++;
          } else {
            let geo: import('three').BufferGeometry | null = null;
            let uri = '';
            if (obj.type === 'cylinder') {
              const r = obj.radius as number, l = obj.length as number;
              geo = new THREE.CylinderGeometry(r, r, l, 16);
              uri = `primitive://cylinder?r=${r}&l=${l}`;
            } else if (obj.type === 'box') {
              const [bx, by, bz] = obj.size as number[];
              geo = new THREE.BoxGeometry(bx, bz, by);
              uri = `primitive://box?x=${bx}&y=${bz}&z=${by}`;
            } else if (obj.type === 'sphere') {
              const r = obj.radius as number;
              geo = new THREE.SphereGeometry(r, 16, 12);
              uri = `primitive://sphere?r=${r}`;
            }
            if (geo && uri) {
              const mat = new THREE.MeshPhongMaterial({ color: 0x8899aa });
              addBuiltMesh(new THREE.Mesh(geo, mat), obj.name, pos, [0, rotY, 0], uri);
              loaded++;
            }
          }
        }
        if (loaded === 0) alert('SDF から配置できる要素がありませんでした。');
      } catch (e) {
        console.error(e);
        alert('SDF の読み込みに失敗しました。');
      }
      return; // exitPlacement は上で呼び済み
    }
    exitPlacement();
  }, [placement, addBuiltMesh, addWorldModel, exitPlacement]);

  // ESC でキャンセル
  useEffect(() => {
    if (!placement) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') exitPlacement(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [placement, exitPlacement]);

  const handleFileSelect = (filePath: string) => {
    setIsFileBrowserOpen(false);
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
    if (['sdf', 'world', 'model'].includes(ext)) {
      enterPlacement({ type: 'sdf', filePath });
    } else {
      const hostname = window.location.hostname;
      enterPlacement({ type: 'mesh', url: `http://${hostname}:8000/workspace/${filePath}` });
    }
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
                // グリッド
                const gridHelper = new THREE.GridHelper(20, 20);
                gridHelper.position.y = -0.001;
                viewer.scene.add(gridHelper);
                // 不透明な地面（Y=0 より下を隠して「埋まり」を防ぐ）
                const groundGeo = new THREE.PlaneGeometry(20, 20);
                const groundMat = new THREE.MeshLambertMaterial({ color: 0xe8e8e8 });
                const ground = new THREE.Mesh(groundGeo, groundMat);
                ground.rotation.x = -Math.PI / 2;
                ground.position.y = -0.002;
                ground.receiveShadow = true;
                viewer.scene.add(ground);
                groundMeshRef.current = ground;
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
        pose: [...obj.position, ...obj.rotation],
        ...(obj.meshScale ? { scale: obj.meshScale } : {}),
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
                const odom = odomPoseRef.current;
                const useOdom = isNav2ModeRef.current
                    && odom !== null
                    && (Date.now() - odom.time) < 2000;

                if (useOdom) {
                    currentPoseRef.current.x = odom.x;
                    currentPoseRef.current.y = odom.y;
                    currentPoseRef.current.yaw = odom.yaw;
                } else {
                    const { linearX, angularZ } = cmdVelRef.current;
                    const pose = currentPoseRef.current;
                    pose.yaw += angularZ * dt;
                    pose.x += linearX * Math.cos(pose.yaw) * dt;
                    pose.y += linearX * Math.sin(pose.yaw) * dt;
                }

                urdfElement.robot.position.set(currentPoseRef.current.x, currentPoseRef.current.y, 0);
                urdfElement.robot.rotation.z = currentPoseRef.current.yaw;
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
            onClick={() => {
              isNav2ModeRef.current = !isNav2ModeRef.current;
              setIsNav2Mode(isNav2ModeRef.current);
            }}
            className={`text-xs px-3 py-1.5 rounded shadow-sm font-medium transition-colors ${
              isNav2Mode
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-gray-200 hover:bg-gray-300 text-gray-700 dark:bg-gray-600 dark:text-gray-200'
            }`}
            title="ON: /odom でロボット位置を同期（Nav2 使用時）&#10;OFF: cmd_vel デッドレコニング（手動操縦時）"
          >
            {isNav2Mode ? '📡 Nav2 ON' : '📡 Nav2 OFF'}
          </button>
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
            onClick={() => setIsFileBrowserOpen(prev => !prev)}
            className="bg-white hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-600 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-4 py-2 rounded shadow-md text-xs font-medium transition-colors"
          >
            {isFileBrowserOpen ? "✕ ファイルを閉じる" : "📂 ファイルから配置"}
          </button>

          {/* プリミティブ形状配置ボタン */}
          <div className="flex gap-1">
            {(['box', 'cylinder', 'sphere'] as const).map(g => (
              <button
                key={g}
                onClick={() => enterPlacement({ type: 'primitive', geoType: g })}
                title={`${g} を配置`}
                className="bg-white hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-600 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-3 py-2 rounded shadow-md text-xs font-medium transition-colors"
              >
                {g === 'box' ? '□ Box' : g === 'cylinder' ? '⬭ Cyl' : '○ Sph'}
              </button>
            ))}
          </div>

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



        {/* 統合ファイルブラウザ：SDF / mesh 両対応 */}
        {isFileBrowserOpen && (
          <ServerFileBrowser
            onClose={() => setIsFileBrowserOpen(false)}
            onSelectFile={handleFileSelect}
            title="配置ファイルを選択（.sdf / .world / .model / .dae / .obj / .stl / .glb / .gltf）"
            acceptExtensions={['sdf', 'world', 'model', 'dae', 'obj', 'stl', 'glb', 'gltf']}
          />
        )}

        {/* 配置モードオーバーレイ */}
        {placement && (
          <>
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 bg-blue-600 text-white text-xs px-4 py-1.5 rounded-full shadow-lg pointer-events-none select-none">
              クリックで配置 / 右クリック・ESC でキャンセル
              {placement.type === 'sdf' && ` — ${placement.filePath.split('/').pop()}`}
              {placement.type === 'mesh' && ` — ${placement.url.split('/').pop()}`}
              {placement.type === 'primitive' && ` — ${placement.geoType}`}
            </div>
            <div
              className="absolute inset-0 z-30 cursor-crosshair"
              onPointerDown={() => { overlayPointerDownRef.current = true; }}
              onPointerMove={handlePlacementMove}
              onClick={handlePlacementClick}
              onContextMenu={e => { e.preventDefault(); exitPlacement(); }}
            />
          </>
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