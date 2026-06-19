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
};

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

  const addWorldModel = useCallback(async (url: string, pos = [0, 0, 0], rot = [0, 0, 0], meshScale?: number[]) => {
    if (!scene) return;
    const ext = url.split('.').pop()?.toLowerCase();
    const fileName = url.split('/').pop() || 'Unknown Model';

    const onLoad = (mesh: THREE.Object3D) => {
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

      setObstacles((prev) => [...prev, {
        id: crypto.randomUUID(),
        name: fileName,
        mesh,
        sourceUrl: url,
        position: pos,
        rotation: rot,
        meshScale,
      }]);
    };

    if (ext === 'dae') {
      const { ColladaLoader } = await import('three/addons/loaders/ColladaLoader.js');
      new ColladaLoader().load(url, (result: any) => onLoad(result.scene));
    } else if (ext === 'glb' || ext === 'gltf') {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      new GLTFLoader().load(url, (result: any) => onLoad(result.scene));
    } else if (ext === 'stl') {
      const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
      new STLLoader().load(url, (geometry: THREE.BufferGeometry) => {
        const material = new THREE.MeshPhongMaterial({ color: 0x888888 });
        onLoad(new THREE.Mesh(geometry, material));
      });
    }
  }, [scene]);

  // プリミティブなど事前生成済みメッシュを obstacles として登録する
  // primitiveUri: 'primitive://cylinder?r=0.15&l=0.5' のようなジオメトリ情報入り URI
  const addBuiltMesh = useCallback((mesh: THREE.Object3D, name: string, pos: number[], rot: number[], primitiveUri: string) => {
    if (!scene) return;
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.rotation.set(rot[0], rot[1], rot[2]);
    mesh.traverse((child: any) => {
      if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
    });
    scene.add(mesh);
    setObstacles(prev => [...prev, {
      id: crypto.randomUUID(),
      name,
      mesh,
      sourceUrl: primitiveUri,
      position: pos,
      rotation: rot,
    }]);
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
    const exportData = {
      objects: obstacles.map(obj => ({
        name: obj.name,
        uri: obj.sourceUrl,
        pose: [...obj.position, ...obj.rotation],
        ...(obj.meshScale ? { scale: obj.meshScale } : {}),
      }))
    };

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

    for (const obj of data.objects) {
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
    }
    console.log('Environment restoration complete.');
  }, [clearObstacles, addWorldModel, restorePrimitive]);

  return {
    obstacles,
    addWorldModel,
    addBuiltMesh,
    removeObjectById,
    clearObstacles,
    exportEnvironment,
    loadEnvironment,
  };
}
