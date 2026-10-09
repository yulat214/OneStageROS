import { useEffect, useRef, useState } from 'react';
import { Video, Radio } from 'lucide-react';
import * as ROSLIB from 'roslib';
import type * as THREE from 'three';
import { ROSBRIDGE_URL, ROSBRIDGE_CAMERA_URL } from '../lib/backend';

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
// 画像の配信周期の選択肢 [Hz]。描画フレーム数で数えるとディスプレイのリフレッシュレートで
// 頻度が変わる（144Hz なら 24Hz）ため、時間で間隔を決める
const PUBLISH_RATE_OPTIONS = [1, 2, 5, 10];
const DEFAULT_PUBLISH_RATE_HZ = 5;
const PUBLISH_ENABLED_STORAGE_KEY = 'robotCameraPublishEnabled';
const PUBLISH_RATE_STORAGE_KEY = 'robotCameraPublishRateHz';
// カメラ画像（1 枚あたりカラー+深度で約 3MB の JSON）は専用の rosbridge に送る。
// 9090 の rosbridge（Python・1 スレッド）で処理させると、処理しきれない PC では画像の処理待ちが溜まり、
// 同じ rosbridge から届く /onestage/sim_pose・/joint_states が止まって画面描画が固まる。
// カメラ用の rosbridge につながらないときは、通常の rosbridge にフォールバックする
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

function loadPublishEnabled(): boolean {
  try {
    return localStorage.getItem(PUBLISH_ENABLED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function loadPublishRateHz(): number {
  try {
    const hz = Number(localStorage.getItem(PUBLISH_RATE_STORAGE_KEY));
    if (PUBLISH_RATE_OPTIONS.includes(hz)) return hz;
  } catch {}
  return DEFAULT_PUBLISH_RATE_HZ;
}

function savePublishSettings(enabled: boolean, rateHz: number) {
  try {
    localStorage.setItem(PUBLISH_ENABLED_STORAGE_KEY, String(enabled));
    localStorage.setItem(PUBLISH_RATE_STORAGE_KEY, String(rateHz));
  } catch {}
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
  // カメラ用 rosbridge の WebSocket（送信待ちの量を見るため）
  const cameraSocketRef = useRef<WebSocket | null>(null);
  const depthTopicRef = useRef<ROSLIB.Topic<unknown> | null>(null);
  const cameraInfoTopicRef = useRef<ROSLIB.Topic<unknown> | null>(null);
  // 配信の ON/OFF と周期（アニメーションループから参照するため ref にも持つ）
  const [publishEnabled, setPublishEnabled] = useState(loadPublishEnabled);
  const [publishRateHz, setPublishRateHz] = useState(loadPublishRateHz);
  const publishEnabledRef = useRef(publishEnabled);
  const publishIntervalMsRef = useRef(1000 / publishRateHz);
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
    const ros = new ROSLIB.Ros({ url: ROSBRIDGE_URL });
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

  // 配信の ON/OFF・周期を反映する。ON の間はトピックを advertise しておき、
  // 購読者がいなくても `ros2 topic list` や RViz の一覧に表示されるようにする
  useEffect(() => {
    publishEnabledRef.current = publishEnabled;
    publishIntervalMsRef.current = 1000 / publishRateHz;
    savePublishSettings(publishEnabled, publishRateHz);
    for (const topic of [imageTopicRef.current, depthTopicRef.current, cameraInfoTopicRef.current]) {
      if (!topic) continue;
      if (publishEnabled) topic.advertise();
      else topic.unadvertise();
    }
  }, [publishEnabled, publishRateHz]);

  useEffect(() => {
    let disposed = false;
    let ros: ROSLIB.Ros | null = null;
    const clearTopics = () => {
      imageTopicRef.current = null;
      depthTopicRef.current = null;
      cameraInfoTopicRef.current = null;
      cameraSocketRef.current = null;
    };

    const connect = (url: string) => {
      let connected = false;
      let handledDown = false;
      const r = new ROSLIB.Ros({
        url,
        // 送信待ちの量（bufferedAmount）を見て送り過ぎを防ぐため、WebSocket 本体を取っておく
        transportFactory: async (url: string) => {
          const transport = await ROSLIB.WebSocketTransportFactory(url);
          cameraSocketRef.current = (transport as any).socket ?? null;
          return transport;
        },
      });
      ros = r;
      r.on('connection', () => {
        connected = true;
        console.log(`[RobotCamera] publishing via ${url}`);
        imageTopicRef.current = new ROSLIB.Topic({ ros: r, name: '/camera/camera/color/image_raw', messageType: 'sensor_msgs/msg/Image' });
        depthTopicRef.current = new ROSLIB.Topic({ ros: r, name: '/camera/camera/depth/image_rect_raw', messageType: 'sensor_msgs/msg/Image' });
        cameraInfoTopicRef.current = new ROSLIB.Topic({ ros: r, name: '/camera/camera/color/camera_info', messageType: 'sensor_msgs/msg/CameraInfo' });
        if (publishEnabledRef.current) {
          imageTopicRef.current.advertise();
          depthTopicRef.current.advertise();
          cameraInfoTopicRef.current.advertise();
        }
      });
      const onDown = () => {
        clearTopics();
        if (handledDown) return; // error と close の両方が来る
        handledDown = true;
        if (!connected && url === ROSBRIDGE_CAMERA_URL && !disposed) {
          console.warn('[RobotCamera] カメラ用の rosbridge に接続できないため、通常の rosbridge を使います');
          r.close();
          connect(ROSBRIDGE_URL);
        }
      };
      r.on('close', onDown);
      r.on('error', onDown);
    };

    connect(ROSBRIDGE_CAMERA_URL);
    return () => { disposed = true; clearTopics(); ros?.close(); };
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
      let lastPublishMs = -Infinity;
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

        // 配信 OFF の間は、画像の読み出し・エンコードも行わない
        if (!publishEnabledRef.current) return;
        const nowMs = performance.now();
        const shouldPublish = nowMs - lastPublishMs >= publishIntervalMsRef.current;
        const w = renderer.domElement.width, h = renderer.domElement.height;
        if (!shouldPublish || w <= 0 || h <= 0 || colorBusy || depthBusy) return;
        // 前の画像をまだ送り終えていなければこのフレームは見送る。rosbridge の処理が追いつかない PC で
        // 処理待ちが溜まり続けるのを防ぐ（追いつかない分だけ実効の送信頻度が自動で下がる）
        if ((cameraSocketRef.current?.bufferedAmount ?? 0) > 0) return;
        lastPublishMs = nowMs;

        // タイムスタンプ・frame_id・内部パラメータは撮影（描画）した時点の値を使う
        const now = Date.now();
        const stamp = { sec: Math.floor(now / 1000), nanosec: (now % 1000) * 1_000_000 };
        const frameId = currentMode === 'robot' ? opticalLinkRef.current : 'free_camera';
        const gl = renderer.getContext() as WebGL2RenderingContext;

        // --- カラー画像 + camera_info ---
        if (imageTopicRef.current) {
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

          colorBusy = true;
          // renderer.render() 直後なので既定フレームバッファには今描いた画像が入っている
          readDefaultFramebufferAsync(gl, w, h)
            .then(rgba => encoder.encode({ kind: 'color', rgba, w, h }))
            .then(data => {
              // エンコード中に配信 OFF にされた場合は送らない（publish すると再び advertise される）
              if (!isMounted || !publishEnabledRef.current) return;
              imageTopicRef.current?.publish({
                header: { stamp, frame_id: frameId },
                height: h, width: w, encoding: 'rgb8', is_bigendian: 0, step: w * 3, data,
              });
              publishInfo();
            })
            .catch(err => { if (isMounted) console.warn('[RobotCamera] color publish failed', err); })
            .finally(() => { colorBusy = false; });
        }

        // --- 深度画像 ---
        if (depthTopicRef.current && depthMaterialRef.current) {
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
              if (!isMounted || !publishEnabledRef.current) return;
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
      <div className="bg-gray-100 dark:bg-gray-700 px-3 py-1.5 border-b border-gray-300 dark:border-gray-600 flex flex-col gap-1 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Video className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />
          <h2 className="text-base text-gray-700 dark:text-gray-300">
            カメラビュー
            {statusLive
              ? <span className="text-sm ml-2 text-green-500">● {statusText}</span>
              : <span className="text-sm ml-2 text-gray-400 dark:text-gray-500">● {statusText}</span>}
          </h2>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setPublishEnabled(v => !v)}
              title={publishEnabled ? 'クリックで配信を停止' : 'クリックで配信を開始（カラー・深度・camera_info）'}
              className={`flex items-center gap-1 px-3 py-1 rounded shadow-sm text-sm font-medium transition-colors ${
                publishEnabled
                  ? 'bg-green-500 hover:bg-green-600 text-white border border-green-600'
                  : 'bg-white dark:bg-gray-600 hover:bg-gray-50 dark:hover:bg-gray-500 text-gray-600 dark:text-gray-200 border border-gray-300 dark:border-gray-500'
              }`}
            >
              <Radio className="w-4 h-4" />
              {publishEnabled ? '配信中' : '配信停止中'}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="text-sm text-gray-500 dark:text-gray-400 flex-shrink-0">表示:</span>
          <select
            value={mode}
            onChange={e => handleModeChange(e.target.value as CameraMode)}
            className="text-sm px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
          >
            <option value="robot">ロボットカメラ</option>
            <option value="free">フリービュー</option>
          </select>
          <span className="text-sm text-gray-500 dark:text-gray-400 flex-shrink-0 ml-2">周期:</span>
          <select
            value={publishRateHz}
            onChange={e => setPublishRateHz(Number(e.target.value))}
            title="カメラ画像の配信周期"
            className="text-sm px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
          >
            {PUBLISH_RATE_OPTIONS.map(hz => <option key={hz} value={hz}>{hz} Hz</option>)}
          </select>
          {mode === 'free' && (
            <button
              onClick={handleSave}
              className={`ml-auto text-sm px-2 py-1 rounded flex-shrink-0 transition-colors ${
                saved
                  ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              {saved ? '保存済み' : '視点を保存'}
            </button>
          )}
        </div>
        {mode === 'free' && (
          <div className="text-xs text-gray-400 dark:text-gray-500">ドラッグ: 回転　Shift + ドラッグ: 移動　ホイール: ズーム</div>
        )}
      </div>
      <div className="flex-1 p-4 min-h-0 bg-gray-50 dark:bg-gray-900 overflow-hidden">
        <div ref={wrapperRef} className="w-full h-full border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg flex items-center justify-center overflow-hidden">
          <div ref={canvasContainerRef} className="bg-black" />
        </div>
      </div>
    </div>
  );
}
