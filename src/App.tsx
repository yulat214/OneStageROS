import { useState, useEffect } from 'react';
import { SimulatorView } from './components/SimulatorView';
import { RobotCameraView } from './components/RobotCameraView';
import { DebugLog } from './components/DebugLog';
import { Info, Moon, Sun } from 'lucide-react';

export default function App() {
  const [darkMode, setDarkMode] = useState(false);

  // ダークモードの適用
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 overflow-hidden transition-colors">
      {/* ヘッダー - 説明セクション */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex-shrink-0 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 mt-0.5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
            <div>
              <h1 className="text-gray-900 dark:text-gray-100 mb-1">ロボットシミュレータ</h1>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                メインビューでロボットの動作を確認できます。右側のカメラビューでロボット視点を、デバッグログで詳細情報を確認できます。
              </p>
            </div>
          </div>
          
          {/* ダークモード切り替えボタン */}
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="flex-shrink-0 p-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            aria-label="ダークモード切り替え"
          >
            {darkMode ? (
              <Sun className="w-5 h-5 text-yellow-500" />
            ) : (
              <Moon className="w-5 h-5 text-gray-700" />
            )}
          </button>
        </div>
      </header>

      {/* メインコンテンツエリア */}
      <main className="flex-1 flex flex-col md:flex-row gap-4 p-4 min-h-0">
        {/* 左側：メインシミュレータビュー - より正方形寄りに */}
        <div className="flex-1 md:max-w-[60%] flex flex-col min-h-0 min-w-0">
          <SimulatorView />
        </div>

        {/* 右側：カメラビュー & デバッグログ */}
        <aside className="flex flex-col md:flex-1 gap-4 min-h-0">
          {/* ロボットカメラビュー - 比率を上げる */}
          <div className="flex-[1.5] min-h-[250px] md:min-h-[320px]">
            <RobotCameraView />
          </div>

          {/* デバッグログ */}
          <div className="flex-1 min-h-[200px] md:min-h-[250px]">
            <DebugLog />
          </div>
        </aside>
      </main>
    </div>
  );
}