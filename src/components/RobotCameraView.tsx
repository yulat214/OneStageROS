import { useEffect, useRef, useState } from 'react';
import { Video } from 'lucide-react';
import * as ROSLIB from 'roslib';
import type * as THREE from 'three';

// /camera/color/camera_info が取得できない場合のフォールバック比率（640×480）
const DEFAULT_ASPECT = 640 / 480;

interface RobotCameraViewProps {
  scene: THREE.Scene | null;
}

export function RobotCameraView({ scene }: RobotCameraViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  const cameraAspectRef = useRef(DEFAULT_ASPECT);
  const applyResizeRef = useRef<(() => void) | null>(null);
  // camera_info の frame_id または自動探索で確定したリンク名（空 = 未確定）
  const targetLinkRef = useRef<string>('');

  const [cameraResolution, setCameraResolution] = useState<string>('640×480');
  const [targetLinkDisplay, setTargetLinkDisplay] = useState<string>('検出中...');

  // /camera/color/camera_info を一度だけ購読してアスペクト比とフレーム名を取得
  useEffect(() => {
    const hostname = window.location.hostname;
    const ros = new ROSLIB.Ros({ url: `ws://${hostname}:9090` });

    const topic = new ROSLIB.Topic({
      ros,
      name: '/camera/color/camera_info',
      messageType: 'sensor_msgs/msg/CameraInfo',
    });

    const handleMsg = (msg: any) => {
      const w: number = msg.width;
      const h: number = msg.height;
      const frameId: string = msg.header?.frame_id ?? '';

      if (w > 0 && h > 0) {
        cameraAspectRef.current = w / h;
        setCameraResolution(`${w}×${h}`);
        if (frameId) {
          targetLinkRef.current = frameId;
          setTargetLinkDisplay(frameId);
        }
        applyResizeRef.current?.();
        topic.unsubscribe();
        ros.close();
      }
    };

    topic.subscribe(handleMsg);

    return () => {
      topic.unsubscribe();
      ros.close();
    };
  }, []);

  // ─── レンダラー・カメラ初期化 ───
  useEffect(() => {
    let isMounted = true;
    let renderer: THREE.WebGLRenderer | null = null;
    let camera: THREE.PerspectiveCamera | null = null;
    let loopId: number;
    let resizeObserver: ResizeObserver | null = null;

    const initRobotCamera = async () => {
      if (!wrapperRef.current || !canvasContainerRef.current) return;

      const canvasContainer = canvasContainerRef.current;
      const THREE = await import('three');

      if (!isMounted) return;

      // --- 1. 初期化 ---
      camera = new THREE.PerspectiveCamera(60, cameraAspectRef.current, 0.01, 100);
      camera.position.set(0.5, 0, 0.5);
      camera.lookAt(0, 0, 0);

      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setPixelRatio(window.devicePixelRatio);

      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.display = 'block';

      while (canvasContainer.firstChild) {
        canvasContainer.removeChild(canvasContainer.firstChild);
      }
      canvasContainer.appendChild(renderer.domElement);

      // --- 2. サイズ変更の監視 ---
      const doResize = (width: number, height: number) => {
        if (!renderer || !camera || !canvasContainerRef.current) return;
        const aspect = cameraAspectRef.current;

        let renderW: number, renderH: number;
        if (width / height >= aspect) {
          renderH = height;
          renderW = height * aspect;
        } else {
          renderW = width;
          renderH = width / aspect;
        }

        canvasContainerRef.current.style.width  = `${renderW}px`;
        canvasContainerRef.current.style.height = `${renderH}px`;
        renderer.setSize(renderW, renderH, false);
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      };

      applyResizeRef.current = () => {
        if (!wrapperRef.current) return;
        const { width, height } = wrapperRef.current.getBoundingClientRect();
        if (width > 0 && height > 0) doResize(width, height);
      };

      resizeObserver = new ResizeObserver((entries) => {
        if (!isMounted) return;
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) doResize(width, height);
        }
      });

      resizeObserver.observe(wrapperRef.current);

      // --- 3. 描画ループ ---
      const targetPos = new THREE.Vector3();
      const targetQuat = new THREE.Quaternion();

      const animate = () => {
        if (!isMounted) return;
        loopId = requestAnimationFrame(animate);

        if (renderer && scene && camera) {
          let targetObject: THREE.Object3D | null | undefined = null;

          if (targetLinkRef.current) {
            // camera_info または自動探索で確定済み
            targetObject = scene.getObjectByName(targetLinkRef.current);
          } else {
            // まだ未確定: "optical" を含む最初のリンクを探索してキャッシュ
            scene.traverse((obj) => {
              if (!targetObject && obj.name?.toLowerCase().includes('optical')) {
                targetObject = obj;
                targetLinkRef.current = obj.name;
                setTargetLinkDisplay(obj.name);
              }
            });
          }

          if (targetObject) {
            targetObject.getWorldPosition(targetPos);
            targetObject.getWorldQuaternion(targetQuat);
            camera.position.copy(targetPos);
            camera.quaternion.copy(targetQuat);
            // ROS カメラ光学フレーム（+Z 前方, +Y 下）→ Three.js カメラ（-Z 前方, +Y 上）
            camera.rotateX(Math.PI);
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
      applyResizeRef.current = null;
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
          LIVE ({targetLinkDisplay}) {cameraResolution}
        </span>
      </div>

      {/* コンテンツエリア */}
      <div className="flex-1 p-4 min-h-0 bg-gray-50 dark:bg-gray-900 relative overflow-hidden">

        {/* 点線枠 (Wrapper): flex で中央揃え、サイズ計算の基準 */}
        <div
          ref={wrapperRef}
          className="w-full h-full border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg flex items-center justify-center overflow-hidden"
        >
          {/* サイズは ResizeObserver が camera_info の比率で JS から設定する */}
          <div ref={canvasContainerRef} className="bg-black" />
        </div>

      </div>
    </div>
  );
}
