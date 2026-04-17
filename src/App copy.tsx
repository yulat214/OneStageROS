import { useState } from 'react';
import type * as THREE from 'three';
import { SimulatorView } from './components/SimulatorView';
import { RobotCameraView } from './components/RobotCameraView';
import { DebugLog } from './components/DebugLog';
import { CodeEditor } from './components/CodeEditor';
import { MonitorPlay, Code2 } from 'lucide-react';

type TabType = 'simulator' | 'editor';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('simulator');
  
  // SimulatorViewからシーンを受け取り、RobotCameraViewへ渡すためのState
  const [sharedScene, setSharedScene] = useState<THREE.Scene | null>(null);

  // エディターの入力内容を保持するState (ROS 2ノードのひな形)
  const [editorCode, setEditorCode] = useState<string>([
    ''
  ].join('\n'));

  return (
    <div className="h-screen flex flex-col bg-gray-50 text-gray-900 overflow-hidden">
      
      {/* 1. タブナビゲーション */}
      <nav className="bg-white border-b border-gray-200 flex-shrink-0 shadow-sm z-10">
        <div className="flex px-4 h-14 items-end gap-2">
          <button
            onClick={() => setActiveTab('simulator')}
            className={`
              flex items-center gap-2 px-6 py-3 text-base font-medium rounded-t-lg transition-all duration-200 border-t border-l border-r -mb-px
              ${activeTab === 'simulator'
                ? 'bg-white border-gray-200 text-blue-600 border-b-white' 
                : 'bg-gray-50 border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-100 border-b-gray-200'
              }
            `}
          >
            <MonitorPlay className="w-5 h-5" />
            シミュレータ
          </button>
          
          <button
            onClick={() => setActiveTab('editor')}
            className={`
              flex items-center gap-2 px-6 py-3 text-base font-medium rounded-t-lg transition-all duration-200 border-t border-l border-r -mb-px
              ${activeTab === 'editor'
                ? 'bg-white border-gray-200 text-blue-600 border-b-white'
                : 'bg-gray-50 border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-100 border-b-gray-200'
              }
            `}
          >
            <Code2 className="w-5 h-5" />
            エディター
          </button>
        </div>
      </nav>

      {/* 2. メインコンテンツエリア */}
      <main className="flex-1 flex flex-col p-4 min-h-0 overflow-hidden">
        
        {activeTab === 'simulator' ? (
          // === シミュレータモード ===
          <div className="flex-1 flex flex-col md:flex-row gap-4 min-h-0">
            {/* 左側：メインシミュレータビュー */}
            <div className="flex-1 md:max-w-[60%] flex flex-col min-h-0 min-w-0 bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <SimulatorView onSceneReady={setSharedScene} />
            </div>

            {/* 右側：カメラビュー & デバッグログ */}
            <aside className="flex flex-col md:flex-1 gap-4 min-h-0">
              {/* ロボットカメラビュー */}
              <div className="flex-[1.5] min-h-[250px] md:min-h-[320px] bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                <RobotCameraView scene={sharedScene} />
              </div>

              {/* デバッグログ */}
              <div className="flex-1 min-h-[200px] md:min-h-[250px] bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                <DebugLog />
              </div>
            </aside>
          </div>
        ) : (
          // === エディターモード ===
          <div className="flex-1 bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <CodeEditor 
              code={editorCode} 
              onChange={(value) => setEditorCode(value || '')} 
              language="python"
            />
          </div>
        )}
      </main>
    </div>
  );
}
