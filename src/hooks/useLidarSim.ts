// src/features/simulator/hooks/useLidarSim.ts
import { useCallback, useRef } from 'react';
import * as THREE from 'three';

// LiDAR のレイはすべて「センサー位置を通り、ロボットの上方向を法線とする平面」の中を進む。
// そこでシミュレータが持つ正確な形状（特権情報）を使い、障害物の三角形をこの平面で切った
// 線分を作ってから 2D で交差判定する。three.js の Raycaster で 360 本 × 全メッシュを
// 判定するより数倍速く（sim_house で約 3.3ms → 約 0.9ms）、結果は一致する。
// 物体が動いてもよいよう、断面は毎回作り直す（作り直しは 0.2ms 未満）。

// base_link から見た LiDAR（base_scan）の高さ
export const LIDAR_HEIGHT = 0.15;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3();
const _ux = new THREE.Vector3();
const _uy = new THREE.Vector3();

// 断面の線分: [x1, y1, x2, y2, nx, ny, side] の繰り返し。
// 座標はセンサー位置を原点とするロボット平面内の 2D（+x=前方, +y=左）。
// (nx, ny) は三角形の法線を平面に射影したもの、side は Raycaster と同じ表裏判定に使う
const SEG_STRIDE = 7;

function sliceObstacles(obstacles: THREE.Object3D[], origin: THREE.Vector3, segs: number[]) {
  segs.length = 0;
  const hits: number[] = []; // 平面との交点（ワールド座標 x, y, z の並び）

  // 平面からの符号付き距離
  const dist = (v: THREE.Vector3) => _p.subVectors(v, origin).dot(_up);
  const edge = (p: THREE.Vector3, q: THREE.Vector3, dp: number, dq: number) => {
    if ((dp > 0) === (dq > 0)) return;
    const t = dp / (dp - dq);
    hits.push(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t, p.z + (q.z - p.z) * t);
  };
  const to2dX = (x: number, y: number, z: number) => (x - origin.x) * _ux.x + (y - origin.y) * _ux.y + (z - origin.z) * _ux.z;
  const to2dY = (x: number, y: number, z: number) => (x - origin.x) * _uy.x + (y - origin.y) * _uy.y + (z - origin.z) * _uy.z;

  for (const root of obstacles) {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const pos = mesh.geometry.attributes.position;
      if (!pos) return;
      const index = mesh.geometry.index;
      const count = index ? index.count : pos.count;
      const m = mesh.matrixWorld;
      // 鏡映スケールでは三角形の巻き順が反転するので法線も反転させる
      const flip = m.determinant() < 0 ? -1 : 1;
      const mat = mesh.material;
      const side = Array.isArray(mat) ? THREE.DoubleSide : mat.side;

      for (let i = 0; i + 2 < count; i += 3) {
        _a.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(m);
        _b.fromBufferAttribute(pos, index ? index.getX(i + 1) : i + 1).applyMatrix4(m);
        _c.fromBufferAttribute(pos, index ? index.getX(i + 2) : i + 2).applyMatrix4(m);
        const da = dist(_a), db = dist(_b), dc = dist(_c);
        hits.length = 0;
        edge(_a, _b, da, db);
        edge(_b, _c, db, dc);
        edge(_c, _a, dc, da);
        if (hits.length !== 6) continue;

        _n.crossVectors(_ab.subVectors(_b, _a), _ac.subVectors(_c, _a)).multiplyScalar(flip);
        segs.push(
          to2dX(hits[0], hits[1], hits[2]), to2dY(hits[0], hits[1], hits[2]),
          to2dX(hits[3], hits[4], hits[5]), to2dY(hits[3], hits[4], hits[5]),
          _n.dot(_ux), _n.dot(_uy), side,
        );
      }
    });
  }
}

// server モード用: frame（ロボットの親 = シミュレータのワールド座標系、Z-up）の
// 高さ height の水平面で障害物を切った線分を作る。座標は frame の x, y そのままなので、
// サーバーはロボット位置 (x, y, yaw) から同じ線分に対してレイを飛ばせる
export function sliceObstaclesInFrame(obstacles: THREE.Object3D[], frame: THREE.Object3D, height: number, segs: number[]) {
  const m = frame.matrixWorld;
  const origin = new THREE.Vector3(0, 0, height).applyMatrix4(m);
  _ux.set(1, 0, 0).transformDirection(m);
  _uy.set(0, 1, 0).transformDirection(m);
  _up.set(0, 0, 1).transformDirection(m);
  sliceObstacles(obstacles, origin, segs);
}

// 原点から (dx, dy) 方向のレイが最初に当たる距離（[minRange, maxRange] の外なら Infinity）
function castRay(segs: number[], dx: number, dy: number, minRange: number, maxRange: number) {
  let best = Infinity;
  for (let k = 0; k < segs.length; k += SEG_STRIDE) {
    const x1 = segs[k], y1 = segs[k + 1];
    const ex = segs[k + 2] - x1, ey = segs[k + 3] - y1;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue; // レイと線分が平行
    const t = (x1 * ey - y1 * ex) / den; // レイ上の距離
    if (t < minRange || t > maxRange || t >= best) continue;
    const u = (x1 * dy - y1 * dx) / den; // 線分上の位置
    if (u < 0 || u > 1) continue;
    // three.js の Raycaster と同じく、material.side に応じて裏面/表面を無視する
    const facing = dx * segs[k + 4] + dy * segs[k + 5]; // < 0 なら表面に当たる
    const side = segs[k + 6];
    if (side === THREE.FrontSide && facing >= 0) continue;
    if (side === THREE.BackSide && facing <= 0) continue;
    best = t;
  }
  return best;
}

export function useLidarSim() {
  // 断面の線分バッファ（毎回の確保を避けて使い回す）
  const segsRef = useRef<number[]>([]);

  const simulateLidar = useCallback((robot: THREE.Object3D, obstacles: THREE.Object3D[]) => {
    const numRays = 360; // 1度刻み
    const maxRange = 3.5;
    const minRange = 0.12;
    const ranges: number[] = [];

    // ロボットの現在位置（Three.js world space は Y-up なので Y に高さを加算）
    const origin = new THREE.Vector3();
    robot.getWorldPosition(origin);
    origin.y += LIDAR_HEIGHT;

    // ロボット body frame (+X=前方, +Y=左, Z=上) の各軸を world space に変換（親の座標変換も含む）
    _ux.set(1, 0, 0).transformDirection(robot.matrixWorld);
    _uy.set(0, 1, 0).transformDirection(robot.matrixWorld);
    _up.set(0, 0, 1).transformDirection(robot.matrixWorld);

    const segs = segsRef.current;
    sliceObstacles(obstacles, origin, segs);

    for (let i = 0; i < numRays; i++) {
      const angle = (i * Math.PI) / 180;
      const dist = castRay(segs, Math.cos(angle), Math.sin(angle), minRange, maxRange);

      if (dist !== Infinity) {
        ranges.push(dist);
      } else {
        // range_max より大きい値 = 無効レイ → slam_toolbox が壁セルを生成しない
        // Infinity は JSON で null になるため有限値で range_max を超える値を使う
        //
        // range_max ちょうどの値を試したが、slam_toolbox 側の max_laser_range（デフォルト20.0、
        // このセンサーの range_max=3.5 よりずっと大きい）が閾値として使われるため、
        // 「無反射」ではなく「3.5m先の物体」として解釈され壁が誤生成された。
        // 恒久対応は slam_toolbox の mapper params で max_laser_range をこのセンサーの
        // range_max 以下に設定すること（要 ROS 側設定変更、このリポジトリ外）。
        ranges.push(maxRange + 0.001);
      }
    }

    return {
      angle_min: 0.0,
      angle_max: 2.0 * Math.PI,
      angle_increment: (Math.PI * 2.0) / numRays,
      time_increment: 0.0,
      scan_time: 0.1,
      range_min: minRange,
      range_max: maxRange,
      ranges: ranges,
      intensities: []
    };
  }, []);

  return { simulateLidar };
}
