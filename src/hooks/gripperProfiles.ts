// src/hooks/gripperProfiles.ts
// ロボットごとのグリッパー仕様（アタッチ先リンク・駆動ジョイント・閉方向）。
// 新ロボット対応時は、実機/シムでジョイント値を実測してから1エントリ追加する
// （閉方向はロボットごとに異なりうるため、共通ルールとして推測しない）。

export type GripperProfile = {
  id: string;
  // 掴んだオブジェクトを追従させる際にキネマティックattach先とするリンク名
  attachLinkName: string;
  // 開閉状態を判定する駆動ジョイント名（mimicで連動する側は見なくてよい）
  drivingJointName: string;
  // このロボットが積まれているかを判定するための必須リンク名（誤検出防止のため複数指定）
  requiredLinkNames: string[];
  isClosed: (jointValue: number) => boolean;
  // attachLinkとオブジェクト間の距離がこれ未満なら把持対象候補にする[m]（暫定値、実機に合わせて調整）
  graspRadius: number;
  // attachLinkの原点は「指の間」の実際の位置とズレていることが多いため、
  // attachLinkのローカル座標系での補正オフセット[x,y,z]（URDFから算出）。既定[0,0,0]
  attachLinkLocalOffset?: [number, number, number];
};

export const GRIPPER_PROFILES: GripperProfile[] = [
  {
    // 片側駆動（jaw_linkのみ可動、gripper_linkは固定パーム）
    id: 'so101',
    attachLinkName: 'gripper_link',
    drivingJointName: 'gripper',
    requiredLinkNames: ['gripper_link', 'jaw_link'],
    // 実測(2026-08-28, display.launch.py + RViz目視): 下限(-0.174533)=閉
    isClosed: (v) => v <= -0.15,
    graspRadius: 0.08,
    // gripper_link原点 → jaw_link関節ピボットまでのオフセット（so101_follower.urdf.xacro の
    // joint "gripper" origin xyz を流用。指先はさらに少し先だが、メッシュ形状が不明なため
    // ピボット位置を近似値として採用）
    attachLinkLocalOffset: [0.0202, 0.0188, -0.0234],
  },
  {
    // 両側駆動（gripper_left/right_linkが対称に可動、mimicで連動）
    id: 'turtlebot3_lime',
    attachLinkName: 'end_effector_link',
    drivingJointName: 'gripper_left_joint',
    requiredLinkNames: ['gripper_left_link', 'gripper_right_link', 'end_effector_link'],
    // 実測(2026-08-28, GripperCommandアクション): 下限(-0.010)=閉
    isClosed: (v) => v <= -0.005,
    graspRadius: 0.1,
    // end_effector_link(link7からz+0.115) は実際の指(link7からz+0.0707)よりZ方向に
    // 0.0443m 手前にあるため、その分をローカルZ方向に補正する
    attachLinkLocalOffset: [0, 0, -0.0443],
  },
];

// URDFロード後、robot.links のキー集合から一致するプロファイルを1つ返す（無ければnull）
export function detectGripperProfile(robot: { links?: Record<string, unknown> } | undefined | null): GripperProfile | null {
  if (!robot?.links) return null;
  return GRIPPER_PROFILES.find((profile) =>
    profile.requiredLinkNames.every((name) => name in robot.links!)
  ) ?? null;
}
