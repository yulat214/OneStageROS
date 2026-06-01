import { useEffect, useRef, useState } from 'react';
import { Video } from 'lucide-react';
import * as ROSLIB from 'roslib';
import type * as THREE from 'three';

const DEFAULT_ASPECT = 640 / 480;
// requestAnimationFrame (~60fps) の何フレームに1回パブリッシュするか → ~10fps
const PUBLISH_EVERY_N_FRAMES = 6;

interface RobotCameraViewProps {
  scene: THREE.Scene | null;
}

export function RobotCameraView({ scene }: RobotCameraViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  const cameraAspectRef = useRef(DEFAULT_ASPECT);
  const applyResizeRef = useRef<(() => void) | null>(null);
  const targetLinkRef = useRef<string>('');
  // /camera/color/image_raw パブリッシャー（ROS 接続後にセット）
  const imageTopicRef = useRef<ROSLIB.Topic | null>(null);

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
    return () => { topic.unsubscribe(); ros.close(); };
  }, []);

  // /camera/color/image_raw パブリッシャーの接続を維持する
  useEffect(() => {
    const hostname = window.location.hostname;
    const ros = new ROSLIB.Ros({ url: `ws://${hostname}:9090` });

    ros.on('connection', () => {
      imageTopicRef.current = new ROSLIB.Topic({
        ros,
        name: '/camera/color/image_raw',
        messageType: 'sensor_msgs/msg/Image',
      });
    });
    ros.on('close', () => { imageTopicRef.current = null; });
    ros.on('error', () => { imageTopicRef.current = null; });

    return () => { imageTopicRef.current = null; ros.close(); };
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

      // preserveDrawingBuffer: render 後に gl.readPixels() でピクセルを読み取るために必要
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.display = 'block';

      while (canvasContainer.firstChild) canvasContainer.removeChild(canvasContainer.firstChild);
      canvasContainer.appendChild(renderer.domElement);

      // --- 2. サイズ変更の監視 ---
      const doResize = (width: number, height: number) => {
        if (!renderer || !camera || !canvasContainerRef.current) return;
        const aspect = cameraAspectRef.current;
        let renderW: number, renderH: number;
        if (width / height >= aspect) {
          renderH = height; renderW = height * aspect;
        } else {
          renderW = width; renderH = width / aspect;
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
      let pubFrameCount = 0;

      const animate = () => {
        if (!isMounted) return;
        loopId = requestAnimationFrame(animate);

        if (renderer && scene && camera) {
          // カメラリンクの特定
          let targetObject: THREE.Object3D | null | undefined = null;
          if (targetLinkRef.current) {
            targetObject = scene.getObjectByName(targetLinkRef.current);
          } else {
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
            // ROS 光学フレーム（+Z 前方, +Y 下）→ Three.js カメラ（-Z 前方, +Y 上）
            camera.rotateX(Math.PI);
          }
          renderer.render(scene, camera);

          // --- 4. /camera/color/image_raw パブリッシュ (~10fps) ---
          if (++pubFrameCount % PUBLISH_EVERY_N_FRAMES === 0 && imageTopicRef.current) {
            const w = renderer.domElement.width;
            const h = renderer.domElement.height;
            if (w > 0 && h > 0) {
              // WebGL はピクセル原点が左下、ROS は左上 → Y 軸反転しながら RGBA→RGB 変換
              const gl = renderer.getContext();
              const rgba = new Uint8Array(w * h * 4);
              gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);

              const rgb = new Uint8Array(w * h * 3);
              for (let row = 0; row < h; row++) {
                const srcRow = h - 1 - row; // Y 反転
                for (let col = 0; col < w; col++) {
                  const s = (srcRow * w + col) * 4;
                  const d = (row   * w + col) * 3;
                  rgb[d]     = rgba[s];
                  rgb[d + 1] = rgba[s + 1];
                  rgb[d + 2] = rgba[s + 2];
                }
              }

              // base64 変換（大きな配列を一括スプレッドするとスタックオーバーフローするためチャンク処理）
              let binary = '';
              const CHUNK = 8192;
              for (let i = 0; i < rgb.length; i += CHUNK) {
                binary += String.fromCharCode(...rgb.subarray(i, i + CHUNK));
              }

              const now = Date.now();
              imageTopicRef.current.publish({
                header: {
                  stamp: { sec: Math.floor(now / 1000), nanosec: (now % 1000) * 1_000_000 },
                  frame_id: targetLinkRef.current,
                },
                height: h,
                width: w,
                encoding: 'rgb8',
                is_bigendian: 0,
                step: w * 3,
                data: btoa(binary),
              });
            }
          }
        }
      };

      animate();
    };

    if (scene) initRobotCamera();

    return () => {
      isMounted = false;
      applyResizeRef.current = null;
      if (loopId) cancelAnimationFrame(loopId);
      if (resizeObserver) resizeObserver.disconnect();
      if (renderer) {
        renderer.dispose();
        const canvas = renderer.domElement;
        if (canvas?.parentNode) canvas.parentNode.removeChild(canvas);
      }
    };
  }, [scene]);

  return (
    <div className="h-full w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden flex flex-col shadow-sm">
      <div className="bg-gray-100 dark:bg-gray-700 px-4 py-2 border-b border-gray-300 dark:border-gray-600 flex items-center gap-2 flex-shrink-0">
        <Video className="w-4 h-4 text-green-600 dark:text-green-400" />
        <h2 className="text-sm text-gray-700 dark:text-gray-300">ロボットカメラビュー</h2>
        <span className="ml-auto text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
          <span className="w-2 h-2 bg-green-500 dark:bg-green-400 rounded-full animate-pulse"></span>
          LIVE ({targetLinkDisplay}) {cameraResolution}
        </span>
      </div>

      <div className="flex-1 p-4 min-h-0 bg-gray-50 dark:bg-gray-900 relative overflow-hidden">
        <div
          ref={wrapperRef}
          className="w-full h-full border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg flex items-center justify-center overflow-hidden"
        >
          <div ref={canvasContainerRef} className="bg-black" />
        </div>
      </div>
    </div>
  );
}
