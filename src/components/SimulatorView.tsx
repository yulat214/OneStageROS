import React, { useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';

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

  useEffect(() => {
    const initViewer = async () => {
      try {
        // Import Map経由の読み込み
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

        // ローダー設定
        viewer.loadMeshFunc = (path: string, manager: any, done: any) => {
          const ext = path.split(/\./g).pop()?.toLowerCase();
          switch (ext) {
            case 'gltf': case 'glb': new GLTFLoader(manager).load(path, (r: any) => done(r.scene), null, (e: any) => done(null, e)); break;
            case 'obj': new OBJLoader(manager).load(path, (r: any) => done(r), null, (e: any) => done(null, e)); break;
            case 'dae': new ColladaLoader(manager).load(path, (r: any) => done(r.scene), null, (e: any) => done(null, e)); break;
            case 'stl': new STLLoader(manager).load(path, (r: any) => {
                const material = new THREE.MeshPhongMaterial();
                const mesh = new THREE.Mesh(r, material);
                done(mesh);
              }, null, (e: any) => done(null, e)); break;
          }
        };

        viewer.urdf = '/urdf/lime/urdf/lime.urdf';
        
        // シーン準備待機
        const checkScene = setInterval(() => {
            if (viewer.scene) {
                clearInterval(checkScene);
                
                // 背景色設定
                viewer.scene.background = new THREE.Color('#b3e0aa');

                if (viewer.camera) {
                    // 数値が小さいほど近づく
                    viewer.camera.position.set(0.4, 0.4, 0.4);
                    viewer.camera.lookAt(0, 0, 0);

                    // OrbitControlsなどを使用している場合、手動変更を反映させるためにupdateが必要な場合があります
                    if (viewer.controls) {
                        viewer.controls.update();
                    }
                }

                // 親コンポーネントへシーンを渡す
                if (onSceneReady) {
                    onSceneReady(viewer.scene);
                }
                
                setIsLoaded(true);
            }
        }, 100);

      } catch (error) {
        console.error("Failed to load modules:", error);
      }
    };

    initViewer();
  }, [onSceneReady]);

  return (
    <div className="h-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden flex flex-col shadow-sm">
      <div className="bg-gray-100 dark:bg-gray-700 px-4 py-2 border-b border-gray-300 dark:border-gray-600 flex-shrink-0">
        <h2 className="text-sm text-gray-700 dark:text-gray-300">メインシミュレータビュー</h2>
      </div>
      
      <div className="flex-1 relative bg-gray-50 overflow-hidden">
        {/* メインビューアー (操作可能) */}
        <urdf-viewer
          ref={viewerRef}
          up="+Z"
          display-shadow
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