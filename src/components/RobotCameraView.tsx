import { useEffect, useRef, useState } from 'react';
import { Video } from 'lucide-react';
import * as ROSLIB from 'roslib';
import type * as THREE from 'three';

const DEFAULT_ASPECT = 640 / 480;
const PUBLISH_EVERY_N_FRAMES = 6;
const STORAGE_KEY = 'robotCameraFreeView';

type CameraMode = 'robot' | 'free';

interface OrbitState {
  theta: number; phi: number; radius: number;
  tx: number; ty: number; tz: number;
}

function loadOrbit(): OrbitState {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) return JSON.parse(s);
  } catch {}
  return { theta: Math.PI / 4, phi: Math.PI / 3, radius: 0.9, tx: 0, ty: 0.2, tz: 0 };
}

function saveOrbit(orbit: { theta: number; phi: number; radius: number }, target: THREE.Vector3) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    theta: orbit.theta, phi: orbit.phi, radius: orbit.radius,
    tx: target.x, ty: target.y, tz: target.z,
  }));
}

interface RobotCameraViewProps {
  scene: THREE.Scene | null;
}

export function RobotCameraView({ scene }: RobotCameraViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const cameraAspectRef = useRef(DEFAULT_ASPECT);
  const applyResizeRef = useRef<(() => void) | null>(null);
  const opticalLinkRef = useRef<string>('');
  const imageTopicRef = useRef<ROSLIB.Topic<unknown> | null>(null);
  const modeRef = useRef<CameraMode>('robot');

  const initial = loadOrbit();
  const freeOrbitRef = useRef({ theta: initial.theta, phi: initial.phi, radius: initial.radius });
  // TARGET は animate ループ内の THREE.Vector3 を ref で外部から参照
  const targetVecRef = useRef<THREE.Vector3 | null>(null);
  const dragRef = useRef<{ active: boolean; isPan: boolean; lastX: number; lastY: number }>(
    { active: false, isPan: false, lastX: 0, lastY: 0 }
  );

  const [cameraResolution, setCameraResolution] = useState<string>('640×480');
  const [isLive, setIsLive] = useState(false);
  const [mode, setMode] = useState<CameraMode>('robot');
  const [saved, setSaved] = useState(false);

  const handleModeChange = (m: CameraMode) => {
    setMode(m);
    modeRef.current = m;
    if (m === 'free') setIsLive(true);
  };

  const handleSave = () => {
    if (targetVecRef.current) {
      saveOrbit(freeOrbitRef.current, targetVecRef.current);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  };

  useEffect(() => {
    const hostname = window.location.hostname;
    const ros = new ROSLIB.Ros({ url: `ws://${hostname}:9090` });
    const topic = new ROSLIB.Topic({ ros, name: '/camera/color/camera_info', messageType: 'sensor_msgs/msg/CameraInfo' });
    topic.subscribe((msg: any) => {
      const w: number = msg.width, h: number = msg.height;
      if (w > 0 && h > 0) {
        cameraAspectRef.current = w / h;
        setCameraResolution(`${w}×${h}`);
        applyResizeRef.current?.();
        topic.unsubscribe();
        ros.close();
      }
    });
    return () => { topic.unsubscribe(); ros.close(); };
  }, []);

  useEffect(() => {
    const hostname = window.location.hostname;
    const ros = new ROSLIB.Ros({ url: `ws://${hostname}:9090` });
    ros.on('connection', () => {
      imageTopicRef.current = new ROSLIB.Topic({ ros, name: '/camera/color/image_raw', messageType: 'sensor_msgs/msg/Image' });
    });
    ros.on('close', () => { imageTopicRef.current = null; });
    ros.on('error', () => { imageTopicRef.current = null; });
    return () => { imageTopicRef.current = null; ros.close(); };
  }, []);

  useEffect(() => {
    let isMounted = true;
    let renderer: THREE.WebGLRenderer | null = null;
    let camera: THREE.PerspectiveCamera | null = null;
    let loopId: number;
    let resizeObserver: ResizeObserver | null = null;

    const init = async () => {
      if (!wrapperRef.current || !canvasContainerRef.current) return;
      const THREE = await import('three');
      if (!isMounted) return;

      camera = new THREE.PerspectiveCamera(60, cameraAspectRef.current, 0.01, 100);

      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.display = 'block';

      const container = canvasContainerRef.current;
      while (container.firstChild) container.removeChild(container.firstChild);
      container.appendChild(renderer.domElement);

      const init2 = loadOrbit();
      const TARGET = new THREE.Vector3(init2.tx, init2.ty, init2.tz);
      targetVecRef.current = TARGET;

      // --- マウス操作 ---
      const canvas = renderer.domElement;
      canvas.addEventListener('mousedown', (e) => {
        if (modeRef.current !== 'free') return;
        dragRef.current = { active: true, isPan: e.shiftKey, lastX: e.clientX, lastY: e.clientY };
      });
      canvas.addEventListener('mousemove', (e) => {
        if (!dragRef.current.active || modeRef.current !== 'free') return;
        const dx = e.clientX - dragRef.current.lastX;
        const dy = e.clientY - dragRef.current.lastY;
        if (dragRef.current.isPan) {
          const { theta, phi, radius } = freeOrbitRef.current;
          const scale = radius * 0.001;
          const rightX =  Math.cos(theta);
          const rightZ = -Math.sin(theta);
          const upX = -Math.cos(phi) * Math.sin(theta);
          const upY =  Math.sin(phi);
          const upZ = -Math.cos(phi) * Math.cos(theta);
          TARGET.x -= (rightX * dx - upX * dy) * scale;
          TARGET.y -= upY * dy * scale;
          TARGET.z -= (rightZ * dx - upZ * dy) * scale;
        } else {
          freeOrbitRef.current.theta -= dx * 0.01;
          freeOrbitRef.current.phi = Math.max(0.05, Math.min(Math.PI - 0.05,
            freeOrbitRef.current.phi + dy * 0.01));
        }
        dragRef.current.lastX = e.clientX;
        dragRef.current.lastY = e.clientY;
      });
      canvas.addEventListener('mouseup', () => { dragRef.current.active = false; });
      canvas.addEventListener('mouseleave', () => { dragRef.current.active = false; });
      canvas.addEventListener('wheel', (e) => {
        if (modeRef.current !== 'free') return;
        e.preventDefault();
        freeOrbitRef.current.radius = Math.max(0.2, Math.min(4.0,
          freeOrbitRef.current.radius + e.deltaY * 0.001));
      }, { passive: false });

      // --- リサイズ ---
      const doResize = (w: number, h: number) => {
        if (!renderer || !camera || !canvasContainerRef.current) return;
        const aspect = cameraAspectRef.current;
        let rW: number, rH: number;
        if (w / h >= aspect) { rH = h; rW = h * aspect; }
        else { rW = w; rH = w / aspect; }
        canvasContainerRef.current.style.width  = `${rW}px`;
        canvasContainerRef.current.style.height = `${rH}px`;
        renderer.setSize(rW, rH, false);
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
        for (const e of entries) {
          const { width, height } = e.contentRect;
          if (width > 0 && height > 0) doResize(width, height);
        }
      });
      resizeObserver.observe(wrapperRef.current);

      // --- アニメーションループ ---
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      let pubCount = 0;
      let scanCount = 0;

      const animate = () => {
        if (!isMounted) return;
        loopId = requestAnimationFrame(animate);
        if (!renderer || !scene || !camera) return;

        const currentMode = modeRef.current;

        if (currentMode === 'robot') {
          if (++scanCount % 120 === 1 && !opticalLinkRef.current) {
            scene.traverse((obj: any) => {
              if (!opticalLinkRef.current && obj.name?.toLowerCase().includes('optical')) {
                opticalLinkRef.current = obj.name;
                setIsLive(true);
              }
            });
          }
          const optObj = opticalLinkRef.current ? scene.getObjectByName(opticalLinkRef.current) : null;
          if (optObj) {
            optObj.getWorldPosition(pos);
            camera.position.copy(pos);
            optObj.getWorldQuaternion(quat);
            camera.quaternion.copy(quat);
            camera.rotateX(Math.PI);
          }
        } else {
          const { theta, phi, radius } = freeOrbitRef.current;
          camera.position.set(
            TARGET.x + radius * Math.sin(phi) * Math.sin(theta),
            TARGET.y + radius * Math.cos(phi),
            TARGET.z + radius * Math.sin(phi) * Math.cos(theta),
          );
          camera.up.set(0, 1, 0);
          camera.lookAt(TARGET);
        }

        renderer.render(scene, camera);

        if (++pubCount % PUBLISH_EVERY_N_FRAMES === 0 && imageTopicRef.current) {
          const w = renderer.domElement.width, h = renderer.domElement.height;
          if (w > 0 && h > 0) {
            const gl = renderer.getContext();
            const rgba = new Uint8Array(w * h * 4);
            gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
            const rgb = new Uint8Array(w * h * 3);
            for (let row = 0; row < h; row++) {
              const src = h - 1 - row;
              for (let col = 0; col < w; col++) {
                const s = (src * w + col) * 4, d = (row * w + col) * 3;
                rgb[d] = rgba[s]; rgb[d + 1] = rgba[s + 1]; rgb[d + 2] = rgba[s + 2];
              }
            }
            let bin = '';
            for (let i = 0; i < rgb.length; i += 8192) bin += String.fromCharCode(...rgb.subarray(i, i + 8192));
            const now = Date.now();
            const frameId = currentMode === 'robot' ? opticalLinkRef.current : 'free_camera';
            imageTopicRef.current.publish({
              header: { stamp: { sec: Math.floor(now / 1000), nanosec: (now % 1000) * 1_000_000 }, frame_id: frameId },
              height: h, width: w, encoding: 'rgb8', is_bigendian: 0, step: w * 3, data: btoa(bin),
            });
          }
        }
      };

      animate();
    };

    if (scene) init();

    return () => {
      isMounted = false;
      applyResizeRef.current = null;
      targetVecRef.current = null;
      if (loopId) cancelAnimationFrame(loopId);
      if (resizeObserver) resizeObserver.disconnect();
      if (renderer) {
        renderer.dispose();
        renderer.domElement.parentNode?.removeChild(renderer.domElement);
      }
    };
  }, [scene]);

  const statusLive = mode === 'free' ? true : isLive;
  const statusText = statusLive ? `LIVE ${cameraResolution}` : '検出中...';

  return (
    <div className="h-full w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden flex flex-col shadow-sm">
      <div className="bg-gray-100 dark:bg-gray-700 px-3 py-1.5 border-b border-gray-300 dark:border-gray-600 flex items-center gap-2 flex-shrink-0 flex-wrap">
        <Video className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />
        <h2 className="text-sm text-gray-700 dark:text-gray-300">カメラビュー</h2>
        <select
          value={mode}
          onChange={e => handleModeChange(e.target.value as CameraMode)}
          className="ml-1 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-500 rounded px-1 py-0.5 text-gray-700 dark:text-gray-300"
        >
          <option value="robot">ロボットカメラ</option>
          <option value="free">フリービュー</option>
        </select>
        {mode === 'free' && (
          <>
            <span className="text-xs text-gray-400 dark:text-gray-500">ドラッグ:回転 Shift:移動 ホイール:ズーム</span>
            <button
              onClick={handleSave}
              className={`ml-auto text-xs px-2 py-0.5 rounded border transition-colors ${
                saved
                  ? 'bg-green-100 dark:bg-green-900 border-green-400 text-green-700 dark:text-green-300'
                  : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-500 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
              }`}
            >
              {saved ? '保存済み ✓' : '視点を保存'}
            </button>
          </>
        )}
        <span className={`${mode === 'free' ? '' : 'ml-auto'} text-xs flex items-center gap-1 ${statusLive ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-500'}`}>
          <span className={`w-2 h-2 rounded-full ${statusLive ? 'bg-green-500 animate-pulse' : 'bg-gray-400 dark:bg-gray-500'}`} />
          {statusText}
        </span>
      </div>
      <div className="flex-1 p-4 min-h-0 bg-gray-50 dark:bg-gray-900 overflow-hidden">
        <div ref={wrapperRef} className="w-full h-full border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg flex items-center justify-center overflow-hidden">
          <div ref={canvasContainerRef} className="bg-black" />
        </div>
      </div>
    </div>
  );
}
