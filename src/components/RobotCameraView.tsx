import { useEffect, useRef, useState } from 'react';
import { Video } from 'lucide-react';
import * as ROSLIB from 'roslib';
import type * as THREE from 'three';

// publish する画像の既定解像度（RealSense のカラー/深度の既定値）。
// cm1 等の利用側はピクセル位置を 640x480 前提で決め打ちしているため、
// パネルの表示サイズではなくこの解像度で描画する（表示は CSS で拡大縮小）。
const DEFAULT_IMAGE_WIDTH = 640;
const DEFAULT_IMAGE_HEIGHT = 480;
const DEFAULT_ASPECT = DEFAULT_IMAGE_WIDTH / DEFAULT_IMAGE_HEIGHT;

// カメラ光学系は RealSense D435（= Webots の Turtlebot3Lime.proto の設定）に合わせる。
// カラーと深度で水平画角が異なり、利用側（cm1 の adjust() の 0.75 等）はその差を前提に
// カラー画素→深度画素の対応を取っているため、両者を同じ画角で描くと深度を取り違える。
const COLOR_HFOV_RAD = 1.211259;  // cameracolor
const DEPTH_HFOV_RAD = 1.487021;  // cameradepth (RangeFinder)
const DEPTH_MIN_RANGE = 0.05;     // RangeFinder near/minRange [m]
const DEPTH_MAX_RANGE = 5.0;      // RangeFinder maxRange [m]（超えた画素は inf = 未検出）
// 水平画角と縦横比から three.js の PerspectiveCamera.fov（垂直画角・度）を求める
const vfovDeg = (hfovRad: number, aspect: number) =>
  2 * Math.atan(Math.tan(hfovRad / 2) / aspect) * 180 / Math.PI;
const PUBLISH_EVERY_N_FRAMES = 6;
const STORAGE_KEY = 'robotCameraFreeView';

type CameraMode = 'robot' | 'free';

// --- 画像エンコード（sensor_msgs/Image の data 用 base64 を作る） ---
// ピクセルごとのループと base64 化は 1 枚あたり 100ms 以上かかり、メインスレッドで行うと
// シミュレータの TF/scan 送信が途切れるため Worker で実行する。
// Worker とフォールバック（メインスレッド）で同じ実装を使うよう、ソース文字列で1か所に定義する。
const ENCODER_FUNCS_SRC = `
function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return btoa(bin);
}
// readPixels の RGBA（下の行が先頭）→ 上下反転した rgb8
function encodeColor(rgba, w, h) {
  const rgb = new Uint8Array(w * h * 3);
  for (let row = 0; row < h; row++) {
    const src = h - 1 - row;
    for (let col = 0; col < w; col++) {
      const s = (src * w + col) * 4, d = (row * w + col) * 3;
      rgb[d] = rgba[s]; rgb[d + 1] = rgba[s + 1]; rgb[d + 2] = rgba[s + 2];
    }
  }
  return bytesToBase64(rgb);
}
// three.js RGBADepthPacking: invClipZ = dot(rgba/255, UnpackFactors4) → 上下反転した 32FC1（メートル、maxRange 超は inf）
function encodeDepth(rgba, w, h, near, far, maxRange) {
  const UnpackDownscale = 255 / 256;
  const uf0 = UnpackDownscale / 1;
  const uf1 = UnpackDownscale / 256;
  const uf2 = UnpackDownscale / 65536;
  const uf3 = 1 / 16777216;
  const depthData = new Float32Array(w * h);
  for (let row = 0; row < h; row++) {
    const src = h - 1 - row;
    for (let col = 0; col < w; col++) {
      const s = (src * w + col) * 4, d = row * w + col;
      const invClipZ = (rgba[s] / 255) * uf0 + (rgba[s + 1] / 255) * uf1 + (rgba[s + 2] / 255) * uf2 + (rgba[s + 3] / 255) * uf3;
      const viewZ = (near * far) / ((far - near) * invClipZ - far);
      const z = -viewZ;
      depthData[d] = z > maxRange ? Infinity : z;
    }
  }
  return bytesToBase64(new Uint8Array(depthData.buffer));
}
`;

type EncodeJob =
  | { kind: 'color'; rgba: Uint8Array; w: number; h: number }
  | { kind: 'depth'; rgba: Uint8Array; w: number; h: number; near: number; far: number; maxRange: number };

interface ImageEncoder {
  encode(job: EncodeJob): Promise<string>;
  dispose(): void;
}

function runEncodeJob(funcs: any, job: EncodeJob): string {
  return job.kind === 'color'
    ? funcs.encodeColor(job.rgba, job.w, job.h)
    : funcs.encodeDepth(job.rgba, job.w, job.h, job.near, job.far, job.maxRange);
}

function createImageEncoder(): ImageEncoder {
  try {
    const src = `${ENCODER_FUNCS_SRC}
onmessage = (e) => {
  const { id, job } = e.data;
  try {
    job.rgba = new Uint8Array(job.buf);
    const data = job.kind === 'color' ? encodeColor(job.rgba, job.w, job.h) : encodeDepth(job.rgba, job.w, job.h, job.near, job.far, job.maxRange);
    postMessage({ id, data });
  } catch (err) {
    postMessage({ id, error: String(err) });
  }
};`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const worker = new Worker(url);
    const pending = new Map<number, { resolve: (s: string) => void; reject: (e: Error) => void }>();
    let nextId = 0;
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data.data);
    };
    return {
      encode(job) {
        const id = nextId++;
        const { rgba, ...rest } = job;
        // ArrayBuffer は transfer で渡す（コピーなし。以後メインスレッド側では使えない）
        const buf = rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength);
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          worker.postMessage({ id, job: { ...rest, buf } }, [buf]);
        });
      },
      dispose() {
        worker.terminate();
        URL.revokeObjectURL(url);
        pending.forEach(p => p.reject(new Error('encoder disposed')));
        pending.clear();
      },
    };
  } catch {
    // Worker が使えない環境ではメインスレッドで同じ処理を行う（従来と同等の負荷）
    const funcs = new Function(`${ENCODER_FUNCS_SRC}; return { encodeColor, encodeDepth };`)();
    return {
      encode: async (job) => runEncodeJob(funcs, job),
      dispose() {},
    };
  }
}

// 既定フレームバッファ（画面に描いたもの）を PBO 経由で非同期に読み出す。
// 同期 readPixels は GPU の描画完了を待ってメインスレッドを止めるため使わない。
// 画面の画像をそのまま読むので、色空間（sRGB 変換）・アンチエイリアスは従来の readPixels と同一。
function readDefaultFramebufferAsync(gl: WebGL2RenderingContext, w: number, h: number): Promise<Uint8Array> {
  const pbo = gl.createBuffer();
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
  gl.bufferData(gl.PIXEL_PACK_BUFFER, w * h * 4, gl.STREAM_READ);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  return new Promise((resolve, reject) => {
    const cleanup = () => { if (sync) gl.deleteSync(sync); gl.deleteBuffer(pbo); };
    const poll = () => {
      if (!sync || gl.isContextLost()) { cleanup(); reject(new Error('WebGL context lost')); return; }
      const status = gl.clientWaitSync(sync, 0, 0);
      if (status === gl.WAIT_FAILED) { cleanup(); reject(new Error('clientWaitSync failed')); return; }
      if (status === gl.TIMEOUT_EXPIRED) { setTimeout(poll, 4); return; }
      const out = new Uint8Array(w * h * 4);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      cleanup();
      resolve(out);
    };
    setTimeout(poll, 0);
  });
}

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
  const imageSizeRef = useRef({ w: DEFAULT_IMAGE_WIDTH, h: DEFAULT_IMAGE_HEIGHT });
  const applyResizeRef = useRef<(() => void) | null>(null);
  const opticalLinkRef = useRef<string>('');
  const imageTopicRef = useRef<ROSLIB.Topic<unknown> | null>(null);
  const depthTopicRef = useRef<ROSLIB.Topic<unknown> | null>(null);
  const cameraInfoTopicRef = useRef<ROSLIB.Topic<unknown> | null>(null);
  // 各トピックに ROS 側の購読者がいるか（rosapi で定期確認。確認前・失敗時は true = 従来どおり publish）
  const colorWantedRef = useRef(true);
  const colorInfoWantedRef = useRef(true);
  const depthWantedRef = useRef(true);
  const depthMaterialRef = useRef<THREE.MeshDepthMaterial | null>(null);
  const depthTargetRef = useRef<THREE.WebGLRenderTarget | null>(null);
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
        imageSizeRef.current = { w, h };
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
    // 画像の publish は readPixels（GPU 同期）＋ピクセル変換＋base64 化でメインスレッドを
    // 1回 100ms 以上止め、シミュレータの TF/scan 送信を途切れさせる。
    // 購読者がいないときは生成自体を省く。購読者数が取れない場合は従来どおり publish する。
    let pollId: ReturnType<typeof setInterval> | null = null;
    const subscribersSrv = new ROSLIB.Service({ ros, name: '/rosapi/subscribers', serviceType: 'rosapi_msgs/srv/Subscribers' });
    const pollSubscribers = () => {
      const check = (topic: string, ref: typeof colorWantedRef) =>
        subscribersSrv.callService({ topic }, (res: any) => { ref.current = (res?.subscribers?.length ?? 1) > 0; }, () => { ref.current = true; });
      check('/camera/camera/color/image_raw', colorWantedRef);
      check('/camera/camera/color/camera_info', colorInfoWantedRef);
      check('/camera/camera/depth/image_rect_raw', depthWantedRef);
    };
    const stopPolling = () => { if (pollId !== null) { clearInterval(pollId); pollId = null; } };
    ros.on('connection', () => {
      imageTopicRef.current = new ROSLIB.Topic({ ros, name: '/camera/camera/color/image_raw', messageType: 'sensor_msgs/msg/Image' });
      depthTopicRef.current = new ROSLIB.Topic({ ros, name: '/camera/camera/depth/image_rect_raw', messageType: 'sensor_msgs/msg/Image' });
      cameraInfoTopicRef.current = new ROSLIB.Topic({ ros, name: '/camera/camera/color/camera_info', messageType: 'sensor_msgs/msg/CameraInfo' });
      stopPolling();
      pollSubscribers();
      pollId = setInterval(pollSubscribers, 2000);
    });
    ros.on('close', () => { stopPolling(); imageTopicRef.current = null; depthTopicRef.current = null; cameraInfoTopicRef.current = null; });
    ros.on('error', () => { stopPolling(); imageTopicRef.current = null; depthTopicRef.current = null; cameraInfoTopicRef.current = null; });
    return () => { stopPolling(); imageTopicRef.current = null; depthTopicRef.current = null; cameraInfoTopicRef.current = null; ros.close(); };
  }, []);

  useEffect(() => {
    let isMounted = true;
    let renderer: THREE.WebGLRenderer | null = null;
    let camera: THREE.PerspectiveCamera | null = null;
    let loopId: number;
    let resizeObserver: ResizeObserver | null = null;
    const encoder = createImageEncoder();

    const init = async () => {
      if (!wrapperRef.current || !canvasContainerRef.current) return;
      const THREE = await import('three');
      if (!isMounted) return;

      camera = new THREE.PerspectiveCamera(vfovDeg(COLOR_HFOV_RAD, cameraAspectRef.current), cameraAspectRef.current, 0.01, 100);
      // 深度用は画角・near が異なる別カメラ（姿勢は撮影ごとにカラー用からコピー）
      const depthCamera = new THREE.PerspectiveCamera(vfovDeg(DEPTH_HFOV_RAD, cameraAspectRef.current), cameraAspectRef.current, DEPTH_MIN_RANGE, 100);

      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      // 描画バッファ = publish 解像度そのものにするため pixelRatio は 1 固定
      renderer.setPixelRatio(1);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.display = 'block';

      const container = canvasContainerRef.current;
      while (container.firstChild) container.removeChild(container.firstChild);
      container.appendChild(renderer.domElement);

      const init2 = loadOrbit();
      const TARGET = new THREE.Vector3(init2.tx, init2.ty, init2.tz);
      targetVecRef.current = TARGET;

      depthMaterialRef.current = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });

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
        // 描画バッファは表示サイズに関係なく publish 解像度（canvas は CSS 100% で表示サイズに合わせる）
        renderer.setSize(imageSizeRef.current.w, imageSizeRef.current.h, false);
        camera.aspect = aspect;
        camera.fov = vfovDeg(COLOR_HFOV_RAD, aspect);
        camera.updateProjectionMatrix();
        depthCamera.aspect = aspect;
        depthCamera.fov = vfovDeg(DEPTH_HFOV_RAD, aspect);
        depthCamera.updateProjectionMatrix();
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
      // カラーと深度は同じフレームで撮る（従来どおりの対応関係を保つ）ため、
      // どちらかが読み出し〜エンコード中なら両方とも次の撮影を見送る
      let colorBusy = false;
      let depthBusy = false;

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

        const shouldPublish = ++pubCount % PUBLISH_EVERY_N_FRAMES === 0;
        const w = renderer.domElement.width, h = renderer.domElement.height;
        if (!shouldPublish || w <= 0 || h <= 0 || colorBusy || depthBusy) return;

        // タイムスタンプ・frame_id・内部パラメータは撮影（描画）した時点の値を使う
        const now = Date.now();
        const stamp = { sec: Math.floor(now / 1000), nanosec: (now % 1000) * 1_000_000 };
        const frameId = currentMode === 'robot' ? opticalLinkRef.current : 'free_camera';
        const gl = renderer.getContext() as WebGL2RenderingContext;

        // --- カラー画像 + camera_info ---
        if (imageTopicRef.current && (colorWantedRef.current || colorInfoWantedRef.current)) {
          const vFovRad = camera.fov * Math.PI / 180;
          const fy = h / (2 * Math.tan(vFovRad / 2));
          const fx = fy;
          const cx = w / 2;
          const cy = h / 2;
          const publishInfo = () => cameraInfoTopicRef.current?.publish({
            header: { stamp, frame_id: frameId },
            width: w, height: h,
            distortion_model: 'plumb_bob',
            d: [0, 0, 0, 0, 0],
            k: [fx, 0, cx, 0, fy, cy, 0, 0, 1],
            r: [1, 0, 0, 0, 1, 0, 0, 0, 1],
            p: [fx, 0, cx, 0, 0, fy, cy, 0, 0, 0, 1, 0],
          });

          if (colorWantedRef.current) {
            colorBusy = true;
            // renderer.render() 直後なので既定フレームバッファには今描いた画像が入っている
            readDefaultFramebufferAsync(gl, w, h)
              .then(rgba => encoder.encode({ kind: 'color', rgba, w, h }))
              .then(data => {
                if (!isMounted) return;
                imageTopicRef.current?.publish({
                  header: { stamp, frame_id: frameId },
                  height: h, width: w, encoding: 'rgb8', is_bigendian: 0, step: w * 3, data,
                });
                publishInfo();
              })
              .catch(err => { if (isMounted) console.warn('[RobotCamera] color publish failed', err); })
              .finally(() => { colorBusy = false; });
          } else {
            // camera_info だけ購読されている場合は画像の読み出し自体を省く
            publishInfo();
          }
        }

        // --- 深度画像 ---
        if (depthTopicRef.current && depthMaterialRef.current && depthWantedRef.current) {
          if (!depthTargetRef.current || depthTargetRef.current.width !== w || depthTargetRef.current.height !== h) {
            depthTargetRef.current?.dispose();
            depthTargetRef.current = new THREE.WebGLRenderTarget(w, h);
          }
          const target = depthTargetRef.current;
          const prevOverride = scene.overrideMaterial;
          scene.overrideMaterial = depthMaterialRef.current;
          renderer.setRenderTarget(target);
          depthCamera.position.copy(camera.position);
          depthCamera.quaternion.copy(camera.quaternion);
          depthCamera.updateMatrixWorld();
          renderer.render(scene, depthCamera);
          renderer.setRenderTarget(null);
          scene.overrideMaterial = prevOverride;

          const near = depthCamera.near, far = depthCamera.far;
          depthBusy = true;
          // 読み出し完了まで target は作り直されない（depthBusy 中はこのブロックに入らない）
          renderer.readRenderTargetPixelsAsync(target, 0, 0, w, h, new Uint8Array(w * h * 4))
            .then(rgba => encoder.encode({ kind: 'depth', rgba: rgba as Uint8Array, w, h, near, far, maxRange: DEPTH_MAX_RANGE }))
            .then(data => {
              if (!isMounted) return;
              depthTopicRef.current?.publish({
                header: { stamp, frame_id: frameId },
                height: h, width: w, encoding: '32FC1', is_bigendian: 0, step: w * 4, data,
              });
            })
            .catch(err => { if (isMounted) console.warn('[RobotCamera] depth publish failed', err); })
            .finally(() => { depthBusy = false; });
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
      encoder.dispose();
      depthTargetRef.current?.dispose();
      depthTargetRef.current = null;
      depthMaterialRef.current?.dispose();
      depthMaterialRef.current = null;
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
        <h2 className="text-base text-gray-700 dark:text-gray-300">カメラビュー</h2>
        <select
          value={mode}
          onChange={e => handleModeChange(e.target.value as CameraMode)}
          className="ml-1 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-500 rounded px-1 py-0.5 text-gray-700 dark:text-gray-300"
        >
          <option value="robot">ロボットカメラ</option>
          <option value="free">フリービュー</option>
        </select>
        {mode === 'free' && (
          <>
            <span className="text-sm text-gray-400 dark:text-gray-500">ドラッグ:回転 Shift:移動 ホイール:ズーム</span>
            <button
              onClick={handleSave}
              className={`ml-auto text-sm px-2 py-0.5 rounded border transition-colors ${
                saved
                  ? 'bg-green-100 dark:bg-green-900 border-green-400 text-green-700 dark:text-green-300'
                  : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-500 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
              }`}
            >
              {saved ? '保存済み' : '視点を保存'}
            </button>
          </>
        )}
        <span className={`${mode === 'free' ? '' : 'ml-auto'} text-sm flex items-center gap-1 ${statusLive ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-500'}`}>
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
