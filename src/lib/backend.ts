// バックエンドと rosbridge には、画面を配信している Vite（3000）を経由して接続する（vite.config.ts の proxy）
export const ASSET_BASE_URL = '/ros2_data/';

export function wsUrl(path: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}

export const ROSBRIDGE_URL = wsUrl('/rosbridge');
// カメラ画像専用の rosbridge（画像の処理で通常の rosbridge が詰まらないよう分けている）
export const ROSBRIDGE_CAMERA_URL = wsUrl('/rosbridge-camera');
