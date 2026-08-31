// src/features/simulator/hooks/useWorldManager.ts
import { useState, useCallback } from 'react';
import * as THREE from 'three';

// 管理するオブジェクトの型定義
export type EnvObject = {
  id: string;           // ユニークID
  name: string;         // 表示名（ファイル名など）
  mesh: THREE.Object3D; // Three.jsの実体
  sourceUrl: string;    // ロード元のパス（primitive:// スキームも含む）
  position: number[];   // [x, y, z]
  rotation: number[];   // [rx, ry, rz]
  meshScale?: number[]; // SDF 等から取得したスケール
  // メッシュのローカル座標系でのバウンディングボックス中心（原点からのオフセット[x,y,z]）。
  // 原点が中心にないモデル（例: 底面が原点のコーラ缶）でも、把持の近接判定は
  // 見た目の中心を基準にできるようにするため保持する。
  centerOffset: [number, number, number];
};

// EnvObject を保存用（environment_layout.json / localStorage スナップショット）の
// エントリに変換する。exportEnvironment・自動保存・ワールド初回ロードで共有。
export function toLayoutEntry(obj: EnvObject) {
  return {
    name: obj.name,
    uri: obj.sourceUrl,
    pose: [...obj.position, ...obj.rotation],
    ...(obj.meshScale ? { scale: obj.meshScale } : {}),
  };
}

// mesh のローカル座標系でのバウンディングボックス中心を求める。
// position/rotation/scale を設定する「前」（変形が単位行列の状態）で呼ぶこと。
function computeLocalCenterOffset(mesh: THREE.Object3D): [number, number, number] {
  const box = new THREE.Box3().setFromObject(mesh);
  if (box.isEmpty()) return [0, 0, 0];
  const center = new THREE.Vector3();
  box.getCenter(center);
  return [center.x, center.y, center.z];
}

export function useWorldManager(scene: THREE.Scene | null) {
  const [obstacles, setObstacles] = useState<EnvObject[]>([]);

  const disposeObject = (obj: THREE.Object3D) => {
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else if (child.material) {
          child.material.dispose();
        }
      }
    });
  };

  const clearObstacles = useCallback(() => {
    if (!scene) return;
    obstacles.forEach(obj => {
      scene.remove(obj.mesh);
      disposeObject(obj.mesh);
    });
    setObstacles([]);
  }, [scene, obstacles]);

  const removeObjectById = useCallback((id: string) => {
    if (!scene) return;
    const target = obstacles.find(o => o.id === id);
    if (target) {
      scene.remove(target.mesh);
      disposeObject(target.mesh);
      setObstacles(prev => prev.filter(o => o.id !== id));
    }
  }, [scene, obstacles]);

  // 配置済みオブジェクトの位置・回転を更新する（移動モードで使用）。
  // position/rotation はいずれもシーン座標系での [x,y,z] / [rx,ry,rz]（オイラー XYZ）。
  const updateObjectPose = useCallback((id: string, position: number[], rotation: number[]) => {
    setObstacles(prev => {
      let changed = false;
      const next = prev.map(o => {
        if (o.id !== id) return o;
        changed = true;
        o.mesh.position.set(position[0], position[1], position[2]);
        o.mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
        return { ...o, position: [...position], rotation: [...rotation] };
      });
      return changed ? next : prev;
    });
  }, []);

  // メッシュを読み込んで obstacles に追加する。
  // ロード完了（または対応外拡張子・失敗）で解決する Promise を返し、
  // 追加された EnvObject（失敗時 null）を渡す。呼び出し側が
  // 「全部載り終わった」タイミングを掴めるようにするため。
  const addWorldModel = useCallback(async (url: string, pos = [0, 0, 0], rot = [0, 0, 0], meshScale?: number[]): Promise<EnvObject | null> => {
    if (!scene) return null;
    const ext = url.split('.').pop()?.toLowerCase();
    const fileName = url.split('/').pop() || 'Unknown Model';

    // 読み込んだ mesh をシーンに追加して EnvObject を登録する
    const commit = (mesh: THREE.Object3D): EnvObject => {
      // 変形（position/rotation/scale）を適用する前、原点=単位行列の状態で
      // ローカルのバウンディングボックス中心を求める
      const centerOffset = computeLocalCenterOffset(mesh);

      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.rotation.set(rot[0], rot[1], rot[2]);
      // ColladaLoader が unit 変換済みのスケールを持っている場合があるため
      // set ではなく乗算で SDF スケールを重ねる
      if (meshScale) {
        mesh.scale.x *= meshScale[0];
        mesh.scale.y *= meshScale[1];
        mesh.scale.z *= meshScale[2];
      }

      mesh.traverse((child: any) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      scene.add(mesh);

      const newObj: EnvObject = {
        id: crypto.randomUUID(),
        name: fileName,
        mesh,
        sourceUrl: url,
        position: pos,
        rotation: rot,
        meshScale,
        centerOffset,
      };
      setObstacles((prev) => [...prev, newObj]);
      return newObj;
    };

    // 各ローダーを Promise 化し、ロード完了で mesh を返す（失敗・非対応なら null）
    const loadMesh = async (): Promise<THREE.Object3D | null> => {
      try {
        if (ext === 'dae') {
          const { ColladaLoader } = await import('three/addons/loaders/ColladaLoader.js');
          return await new Promise<THREE.Object3D | null>((res) =>
            new ColladaLoader().load(url, (r: any) => res(r.scene), undefined, () => res(null)));
        }
        if (ext === 'glb' || ext === 'gltf') {
          const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
          return await new Promise<THREE.Object3D | null>((res) =>
            new GLTFLoader().load(url, (r: any) => res(r.scene), undefined, () => res(null)));
        }
        if (ext === 'stl') {
          const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
          return await new Promise<THREE.Object3D | null>((res) =>
            new STLLoader().load(url, (g: THREE.BufferGeometry) =>
              res(new THREE.Mesh(g, new THREE.MeshPhongMaterial({ color: 0x888888 }))), undefined, () => res(null)));
        }
        if (ext === 'obj') {
          const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
          const objLoader = new OBJLoader();

          // .obj は mtllib 行が参照する .mtl（同ディレクトリ相対）にテクスチャ/マテリアルが
          // 外出しされている（DAE/GLTFと違い自己完結しない）ため、先に .mtl を読んでから
          // OBJLoader に適用する。mtllib が無い/読めない場合はジオメトリのみで続行する。
          try {
            const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
            const objText = await fetch(url).then((r) => r.text());
            const mtlName = objText.match(/^mtllib\s+(.+)$/m)?.[1]?.trim();
            if (mtlName) {
              const { MTLLoader } = await import('three/addons/loaders/MTLLoader.js');
              const mtlLoader = new MTLLoader();
              mtlLoader.setPath(baseUrl);
              const materials = await mtlLoader.loadAsync(mtlName);
              materials.preload();
              objLoader.setMaterials(materials);
            }
          } catch {
            // マテリアル読込に失敗してもジオメトリだけは表示できるようにする
          }

          return await new Promise<THREE.Object3D | null>((res) =>
            objLoader.load(url, (o: any) => res(o), undefined, () => res(null)));
        }
      } catch {
        // 動的 import の失敗など
      }
      return null;
    };

    const mesh = await loadMesh();
    return mesh ? commit(mesh) : null;
  }, [scene]);

  // プリミティブなど事前生成済みメッシュを obstacles として登録する
  // primitiveUri: 'primitive://cylinder?r=0.15&l=0.5' のようなジオメトリ情報入り URI
  const addBuiltMesh = useCallback((mesh: THREE.Object3D, name: string, pos: number[], rot: number[], primitiveUri: string): EnvObject | null => {
    if (!scene) return null;
    const centerOffset = computeLocalCenterOffset(mesh);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.rotation.set(rot[0], rot[1], rot[2]);
    mesh.traverse((child: any) => {
      if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
    });
    scene.add(mesh);
    const newObj: EnvObject = {
      id: crypto.randomUUID(),
      name,
      mesh,
      sourceUrl: primitiveUri,
      position: pos,
      rotation: rot,
      centerOffset,
    };
    setObstacles(prev => [...prev, newObj]);
    return newObj;
  }, [scene]);

  // primitive:// URI からメッシュを再生成して追加する（ロード時に使用）
  const restorePrimitive = useCallback((uri: string, name: string, pos: number[], rot: number[]) => {
    if (!scene) return;
    try {
      // "primitive://cylinder?r=0.15&l=0.5" をパース
      const withoutScheme = uri.replace('primitive://', '');
      const [type, queryStr] = withoutScheme.split('?');
      const params: Record<string, number> = {};
      if (queryStr) {
        queryStr.split('&').forEach(kv => {
          const [k, v] = kv.split('=');
          params[k] = parseFloat(v);
        });
      }

      let geo: THREE.BufferGeometry | null = null;
      if (type === 'cylinder') {
        geo = new THREE.CylinderGeometry(params.r, params.r, params.l, 16);
      } else if (type === 'box') {
        geo = new THREE.BoxGeometry(params.x, params.y, params.z);
      } else if (type === 'sphere') {
        geo = new THREE.SphereGeometry(params.r, 16, 12);
      }

      if (!geo) return;
      const mat = new THREE.MeshPhongMaterial({ color: 0x8899aa });
      addBuiltMesh(new THREE.Mesh(geo, mat), name, pos, rot, uri);
    } catch (err) {
      console.error('Failed to restore primitive:', uri, err);
    }
  }, [scene, addBuiltMesh]);

  const exportEnvironment = useCallback(() => {
    const exportData = { objects: obstacles.map(toLayoutEntry) };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'environment_layout.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [obstacles]);

  const loadEnvironment = useCallback(async (data: any) => {
    if (!data || !data.objects || !Array.isArray(data.objects)) {
      console.error("Invalid environment JSON format");
      return;
    }
    clearObstacles();
    console.log(`📂 Restoring ${data.objects.length} objects...`);

    // 全オブジェクトを並行ロードし、全部の完了を待ってから解決する
    // （呼び出し側が「復元し終わった」タイミングを掴めるようにするため）
    await Promise.all(data.objects.map(async (obj: any) => {
      try {
        const pos = obj.pose.slice(0, 3);
        const rot = obj.pose.slice(3, 6);

        if (obj.uri?.startsWith('primitive://')) {
          // プリミティブは URI からジオメトリを再生成
          restorePrimitive(obj.uri, obj.name, pos, rot);
        } else {
          // ファイル URL は再ロード（SDF scale も復元）
          await addWorldModel(obj.uri, pos, rot, obj.scale);
        }
      } catch (err) {
        console.error(`Failed to restore object: ${obj.name}`, err);
      }
    }));
    console.log('Environment restoration complete.');
  }, [clearObstacles, addWorldModel, restorePrimitive]);

  return {
    obstacles,
    addWorldModel,
    addBuiltMesh,
    removeObjectById,
    updateObjectPose,
    clearObstacles,
    exportEnvironment,
    loadEnvironment,
  };
}
