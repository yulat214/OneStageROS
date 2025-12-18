export function SimulatorView() {
  return (
    <div className="h-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden flex flex-col shadow-sm">
      {/* ヘッダー */}
      <div className="bg-gray-100 dark:bg-gray-700 px-4 py-2 border-b border-gray-300 dark:border-gray-600 flex-shrink-0">
        <h2 className="text-sm text-gray-700 dark:text-gray-300">メインシミュレータビュー</h2>
      </div>
      
      {/* コンテンツエリア */}
      <div className="flex-1 flex items-center justify-center p-8 min-h-0 bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="w-16 h-16 bg-blue-50 dark:bg-blue-900/30 border-2 border-blue-400 dark:border-blue-500 rounded-lg mx-auto mb-4 flex items-center justify-center">
            <svg className="w-8 h-8 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
            </svg>
          </div>
          <p className="text-gray-600 dark:text-gray-400 text-sm">シミュレータの描画エリア</p>
          <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">3Dビューやシミュレーション画面をここに実装</p>
        </div>
      </div>
    </div>
  );
}