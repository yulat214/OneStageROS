import { Terminal, Trash2 } from 'lucide-react';

export function DebugLog() {
  return (
    <div className="h-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden flex flex-col shadow-sm">
      {/* ヘッダー */}
      <div className="bg-gray-100 dark:bg-gray-700 px-4 py-2 border-b border-gray-300 dark:border-gray-600 flex items-center gap-2 flex-shrink-0">
        <Terminal className="w-4 h-4 text-purple-600 dark:text-purple-400" />
        <h2 className="text-sm text-gray-700 dark:text-gray-300">デバッグログ</h2>
        <button 
          className="ml-auto p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
          title="ログをクリア"
        >
          <Trash2 className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
        </button>
      </div>
      
      {/* コンテンツエリア */}
      <div className="flex-1 overflow-auto p-3 min-h-0 bg-gray-50 dark:bg-gray-900">
        <div className="space-y-1 font-mono text-xs">
          <div className="text-gray-600 dark:text-gray-400 flex gap-2">
            <span className="text-gray-400 dark:text-gray-500">[00:00:00]</span>
            <span>シミュレータ起動</span>
          </div>
          <div className="text-green-600 dark:text-green-400 flex gap-2">
            <span className="text-gray-400 dark:text-gray-500">[00:00:01]</span>
            <span>ロボット初期化完了</span>
          </div>
          <div className="text-blue-600 dark:text-blue-400 flex gap-2">
            <span className="text-gray-400 dark:text-gray-500">[00:00:02]</span>
            <span>カメラ接続確認</span>
          </div>
          <div className="text-gray-600 dark:text-gray-400 flex gap-2">
            <span className="text-gray-400 dark:text-gray-500">[00:00:03]</span>
            <span>待機中...</span>
          </div>
          <div className="text-gray-400 dark:text-gray-500 mt-4 text-center py-4">
            ログメッセージがここに表示されます
          </div>
        </div>
      </div>
    </div>
  );
}