import { Video } from 'lucide-react';

export function RobotCameraView() {
  return (
    <div className="h-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden flex flex-col shadow-sm">
      {/* ヘッダー */}
      <div className="bg-gray-100 dark:bg-gray-700 px-4 py-2 border-b border-gray-300 dark:border-gray-600 flex items-center gap-2 flex-shrink-0">
        <Video className="w-4 h-4 text-green-600 dark:text-green-400" />
        <h2 className="text-sm text-gray-700 dark:text-gray-300">ロボットカメラビュー</h2>
        <span className="ml-auto text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
          <span className="w-2 h-2 bg-green-500 dark:bg-green-400 rounded-full animate-pulse"></span>
          LIVE
        </span>
      </div>
      
      {/* コンテンツエリア - 4:3 または 848:480 の比率を維持 */}
      <div className="flex-1 flex items-center justify-center p-3 min-h-0 bg-gray-50 dark:bg-gray-900 overflow-hidden">
        <div className="w-full h-full max-h-full flex items-center justify-center">
          <div className="w-full h-full max-h-full aspect-[4/3] bg-gray-100 dark:bg-gray-800 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded flex items-center justify-center">
            <div className="text-center px-4">
              <div className="w-12 h-12 bg-green-50 dark:bg-green-900/30 border-2 border-green-500 dark:border-green-500 rounded-lg mx-auto mb-3 flex items-center justify-center">
                <Video className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              <p className="text-gray-600 dark:text-gray-400 text-sm">ロボット視点カメラ</p>
              <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">カメラ映像をここに表示</p>
              <p className="text-gray-400 dark:text-gray-500 text-xs">(640×480 / 848×480)</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}