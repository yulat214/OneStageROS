import { useState, useLayoutEffect } from 'react';
import type * as THREE from 'three';
import { SimulatorView } from './components/SimulatorView';
import { RobotCameraView } from './components/RobotCameraView';
import { DebugLog } from './components/DebugLog';
import { CodeEditor } from './components/CodeEditor';
import { FileExplorer } from './components/FileExplorer';
import { BuildPanel } from './components/BuildPanel';
import { TerminalPanel } from './components/TerminalPanel';
import { MonitorPlay, Code2, Terminal, Moon, Sun } from 'lucide-react';

type TabType = 'simulator' | 'editor';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('simulator');
  const [sharedScene, setSharedScene] = useState<THREE.Scene | null>(null);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(() => localStorage.getItem('theme') === 'dark');

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  // ターミナル
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalMounted, setTerminalMounted] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(280);

  const openTerminal = () => {
    setTerminalMounted(true);
    setTerminalOpen(true);
  };
  const closeTerminal = () => setTerminalOpen(false);

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

          {/* 右端ボタン群（ダークモード + ターミナル） */}
          <div className="ml-auto self-end mb-1.5 flex-shrink-0 flex items-center gap-2">
            <button
              onClick={() => setIsDark(prev => !prev)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border transition-colors bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-700"
              title={isDark ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              onClick={terminalOpen ? closeTerminal : openTerminal}
              className={`flex items-center gap-2 px-4 py-2 text-base font-medium rounded-lg border transition-colors ${
                terminalOpen
                  ? 'bg-gray-800 text-white border-gray-800'
                  : 'bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200 hover:text-gray-900 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-700'
              }`}
            >
              <Terminal className="w-5 h-5" />
              ターミナル
            </button>
          </div>
        </div>
      </nav>

      {/* 2. メインコンテンツエリア */}
      <main className="flex-1 flex flex-col p-4 min-h-0">

        {activeTab === 'simulator' ? (
          // === シミュレータモード ===
          <div className="flex-1 flex flex-col md:flex-row gap-4 min-h-0">
            <div className="flex-1 md:max-w-[60%] flex flex-col min-h-0 min-w-0 bg-white rounded-lg border border-gray-200 shadow-sm">
              <SimulatorView onSceneReady={setSharedScene} />
            </div>
            <aside className="flex flex-col md:flex-1 gap-4 min-h-0">
              <div className="flex-1 min-h-[250px] bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                <RobotCameraView scene={sharedScene} />
              </div>
              <div className="flex-1 min-h-[250px] bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                <DebugLog />
              </div>
            </aside>
          </div>
        ) : (
          <div className="flex-1 flex flex-row gap-4 min-h-0">
            <div className="w-[250px] flex-shrink-0 bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden flex flex-col">
              <FileExplorer
                selectedPath={activeFilePath || undefined}
                onFileSelect={(path) => setActiveFilePath(path)}
              />
            </div>
            <div className="flex-1 bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden flex flex-col min-h-0">
              <div className="flex-1 min-h-0 overflow-hidden">
                <CodeEditor filePath={activeFilePath} />
              </div>
              <BuildPanel />
            </div>
          </div>
        )}
      </main>

      {/* 3. ターミナルパネル（両タブ共通・画面下部固定） */}
      {terminalMounted && (
        <TerminalPanel
          isOpen={terminalOpen}
          height={terminalHeight}
          onClose={closeTerminal}
          onHeightChange={setTerminalHeight}
        />
      )}
    </div>
  );
}
