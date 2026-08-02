// src/features/simulator/hooks/useLidarSim.ts
import { useCallback } from 'react';
import * as THREE from 'three';

export function useLidarSim() {
  const raycaster = new THREE.Raycaster();

  const simulateLidar = useCallback((robot: THREE.Object3D, obstacles: THREE.Object3D[]) => {
    const numRays = 360; // 1度刻み
    const maxRange = 3.5; 
    const minRange = 0.12;
    const ranges: number[] = [];

    // ロボットの現在位置（Three.js world space は Y-up なので Y に高さを加算）
    const origin = new THREE.Vector3();
    robot.getWorldPosition(origin);
    origin.y += 0.15;

    for (let i = 0; i < numRays; i++) {
      const angle = (i * Math.PI) / 180;

      // ロボット body frame (+X=前方, +Y=左, Z=上) でのレイ方向を
      // robot.matrixWorld で world space に変換する（親の座標変換も含む）
      const direction = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
      direction.transformDirection(robot.matrixWorld).normalize();

      raycaster.set(origin, direction);
      raycaster.near = minRange;
      raycaster.far = maxRange;

      const intersects = raycaster.intersectObjects(obstacles, true);

      if (intersects.length > 0) {
        ranges.push(intersects[0].distance);
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