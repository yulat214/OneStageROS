import { useEffect, useRef } from 'react';
import { Video } from 'lucide-react';
import type * as THREE from 'three';

interface RobotCameraViewProps {
  scene: THREE.Scene | null;
}

export function RobotCameraView({ scene }: RobotCameraViewProps) {
  // サイズを測るための外枠
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Three.jsを差し込むためのコンテナ
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  const targetLinkName = "imu_link"; 

  useEffect(() => {
    let isMounted = true;
    let renderer: THREE.WebGLRenderer | null = null;
    let camera: THREE.PerspectiveCamera | null = null;
    let loopId: number;
    let resizeObserver: ResizeObserver | null = null;

    const initRobotCamera = async () => {
        if (!wrapperRef.current || !canvasContainerRef.current) return;
        
        const canvasContainer = canvasContainerRef.current;
        const THREE = await import(/* @vite-ignore */ 'three');
        
        if (!isMounted) return;

        // --- 1. 初期化 ---
        // サイズはCSSで勝手に決まるので、解像度の初期値は何でも良い
        camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.01, 100);
        camera.position.set(0.5, 0, 0.5);
        camera.lookAt(0, 0, 0);

        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        
        // ★ここが重要：Canvasを親に合わせて無理やり広げる設定
        // width/height: 100% にすることで、親のサイズに追従します
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';
        renderer.domElement.style.display = 'block';

        // 既存の中身をクリアして追加
        while (canvasContainer.firstChild) {
            canvasContainer.removeChild(canvasContainer.firstChild);
        }
        canvasContainer.appendChild(renderer.domElement);


        // --- 2. サイズ変更の監視 ---
        resizeObserver = new ResizeObserver((entries) => {
            if (!isMounted || !renderer || !camera) return;

            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                if (width === 0 || height === 0) return;

                // レンダラー（画質）のサイズを更新
                renderer.setSize(width, height, false); // false: Canvasのstyle.width/heightを上書きしない
                
                // カメラのアスペクト比を更新（映像が伸びないように）
                camera.aspect = width / height;
                camera.updateProjectionMatrix();
            }
        });
        
        // 外枠（wrapper）を監視
        resizeObserver.observe(wrapperRef.current);


        // --- 3. 描画ループ ---
        const targetPos = new THREE.Vector3();
        const targetQuat = new THREE.Quaternion();

        const animate = () => {
            if (!isMounted) return;
            loopId = requestAnimationFrame(animate);

            if (renderer && scene && camera) {
                const targetObject = scene.getObjectByName(targetLinkName);
                if (targetObject) {
                    targetObject.getWorldPosition(targetPos);
                    targetObject.getWorldQuaternion(targetQuat);
                    camera.position.copy(targetPos);
                    camera.quaternion.copy(targetQuat);
                    camera.rotateY(-Math.PI / 2); 
                    camera.rotateZ(-Math.PI / 2);
                    camera.translateZ(-0.1); 
                }
                renderer.render(scene, camera);
            }
        };

        animate();
    };

    if (scene) {
        initRobotCamera();
    }

    return () => {
        isMounted = false;
        if (loopId) cancelAnimationFrame(loopId);
        if (resizeObserver) resizeObserver.disconnect();
        if (renderer) {
            renderer.dispose();
            const canvas = renderer.domElement;
            if (canvas && canvas.parentNode) {
                canvas.parentNode.removeChild(canvas);
            }
        }
    };
  }, [scene]);

  return (
    <div className="h-full w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden flex flex-col shadow-sm">
      {/* ヘッダー */}
      <div className="bg-gray-100 dark:bg-gray-700 px-4 py-2 border-b border-gray-300 dark:border-gray-600 flex items-center gap-2 flex-shrink-0">
        <Video className="w-4 h-4 text-green-600 dark:text-green-400" />
        <h2 className="text-sm text-gray-700 dark:text-gray-300">
          ロボットカメラビュー
        </h2>
        <span className="ml-auto text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
          <span className="w-2 h-2 bg-green-500 dark:bg-green-400 rounded-full animate-pulse"></span>
          LIVE ({targetLinkName})
        </span>
      </div>

      {/* コンテンツエリア */}
      {/* relative: これを基準にする */}
      {/* flex-1 min-h-0: これで親の縮小に合わせて縮むようになる */}
      <div className="flex-1 p-4 min-h-0 bg-gray-50 dark:bg-gray-900 relative overflow-hidden">
        
        {/* 点線枠 (Wrapper) */}
        {/* w-full h-full: 親に合わせて広がる */}
        <div 
            ref={wrapperRef}
            className="w-full h-full border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg relative overflow-hidden"
        >
            {/* ★ここが最大のポイント: absolute inset-0
               これにより、Canvasは「幽体」になり、親のサイズ計算に一切干渉しなくなります。
               親が縮めば、文句を言わずに一緒に縮みます。
            */}
            <div ref={canvasContainerRef} className="absolute inset-0 w-full h-full bg-black" />
            
        </div>

      </div>
    </div>
  );
}
