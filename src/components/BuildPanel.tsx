import React, { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Hammer, ChevronDown, ChevronUp, X, Settings, Play } from 'lucide-react';

type LogEntry = { type: 'stdout' | 'stderr' | 'error' | 'system'; text: string };
type BuildStatus = 'idle' | 'building' | 'success' | 'failed';

export interface BuildPanelHandle {
  onFileSaved: () => void;
}

export const BuildPanel = forwardRef<BuildPanelHandle>((_, ref) => {
  const [status, setStatus] = useState<BuildStatus>('idle');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [workspace, setWorkspace] = useState(() => localStorage.getItem('build_workspace') ?? '');
  const [useSymlink, setUseSymlink] = useState(true);
  const [packageFilter, setPackageFilter] = useState('');
  const [autoBuildOnSave, setAutoBuildOnSave] = useState(false);
  const [runAfterBuild, setRunAfterBuild] = useState(false);
  const [runCommand, setRunCommand] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const runEsRef = useRef<EventSource | null>(null);
  const API_BASE = `http://${window.location.hostname}:8000/api`;

  useEffect(() => {
    if (isExpanded) logEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [logs, isExpanded]);

  useEffect(() => () => {
    esRef.current?.close();
    runEsRef.current?.close();
  }, []);

  const startRunCommand = useCallback((cmd: string) => {
    runEsRef.current?.close();
    setIsRunning(true);
    setLogs(prev => [...prev, { type: 'system', text: `\n▶ 実行: ${cmd}` }]);

    const es = new EventSource(`${API_BASE}/run?cmd=${encodeURIComponent(cmd)}`);
    runEsRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'exit') {
          const ok = data.code === 0;
          setLogs(prev => [...prev, {
            type: 'system',
            text: ok ? '✓ 実行終了' : `✗ 実行終了 (exit ${data.code})`,
          }]);
          setIsRunning(false);
          es.close();
          runEsRef.current = null;
        } else {
          setLogs(prev => [...prev, { type: data.type as LogEntry['type'], text: data.text }]);
        }
      } catch {}
    };

    es.onerror = () => {
      setLogs(prev => [...prev, { type: 'error', text: '実行プロセスとの接続が切断されました' }]);
      setIsRunning(false);
      es.close();
      runEsRef.current = null;
    };
  }, [API_BASE]);

  const handleBuild = useCallback(() => {
    if (status === 'building') return;

    setLogs([]);
    setStatus('building');
    setIsExpanded(true);
    esRef.current?.close();

    const params = new URLSearchParams({ workspace });
    if (useSymlink) params.set('symlink', 'true');
    if (packageFilter.trim()) params.set('packages', packageFilter.trim());

    const es = new EventSource(`${API_BASE}/build?${params}`);
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'exit') {
          const succeeded = data.code === 0;
          setStatus(succeeded ? 'success' : 'failed');
          setLogs(prev => [
            ...prev,
            { type: 'system', text: succeeded ? '✓ ビルド成功' : `✗ ビルド失敗 (exit ${data.code})` },
          ]);
          es.close();
          esRef.current = null;
          if (succeeded && runAfterBuild && runCommand.trim()) {
            const sourcePrefix = workspace.trim()
              ? `source ${workspace.trim()}/install/setup.bash && `
              : '';
            startRunCommand(sourcePrefix + runCommand.trim());
          }
        } else {
          setLogs(prev => [...prev, { type: data.type as LogEntry['type'], text: data.text }]);
        }
      } catch {}
    };

    es.onerror = () => {
      setStatus('failed');
      setLogs(prev => [...prev, { type: 'error', text: 'サーバーとの接続が切断されました' }]);
      es.close();
      esRef.current = null;
    };
  }, [status, workspace, useSymlink, packageFilter, runAfterBuild, runCommand, startRunCommand]);

  useImperativeHandle(ref, () => ({
    onFileSaved: () => {
      if (autoBuildOnSave && status !== 'building') handleBuild();
    },
  }), [autoBuildOnSave, status, handleBuild]);

  const handleCancel = useCallback(async () => {
    esRef.current?.close();
    esRef.current = null;
    runEsRef.current?.close();
    runEsRef.current = null;
    try { await fetch(`${API_BASE}/build/cancel`, { method: 'POST' }); } catch {}
    try { await fetch(`${API_BASE}/run/cancel`, { method: 'POST' }); } catch {}
    setStatus('idle');
    setIsRunning(false);
    setLogs(prev => [...prev, { type: 'system', text: 'キャンセルしました' }]);
  }, [API_BASE]);

  const statusBadge = () => {
    const cfg = {
      building: { cls: 'bg-blue-100 text-blue-700', label: 'ビルド中...' },
      success:  { cls: 'bg-green-100 text-green-700', label: '成功' },
      failed:   { cls: 'bg-red-100 text-red-700', label: '失敗' },
    }[status];
    if (!cfg) return null;
    return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.cls}`}>{cfg.label}</span>;
  };

  const entryClass = (type: LogEntry['type'], text: string) => {
    if (type === 'stderr') return 'text-yellow-300';
    if (type === 'error') return 'text-red-400';
    if (type === 'system') return text.startsWith('✓') ? 'text-green-400 font-bold' : text.startsWith('✗') ? 'text-red-400 font-bold' : 'text-blue-300';
    return 'text-gray-200';
  };

  const isBusy = status === 'building' || isRunning;

  return (
    <div className="border-t border-gray-200 flex-shrink-0 flex flex-col">
      {/* ヘッダー */}
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-50">
        {/* 左: 展開トグル + タイトル + バッジ */}
        <button
          onClick={() => setIsExpanded(e => !e)}
          className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900 shrink-0"
        >
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          <Hammer className="w-4 h-4" />
          <span>ビルド</span>
        </button>
        {statusBadge()}
        {isRunning && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">実行中...</span>
        )}

        {/* 中央: ワークスペース（常時表示） */}
        <input
          value={workspace}
          onChange={e => { setWorkspace(e.target.value); localStorage.setItem('build_workspace', e.target.value); }}
          onClick={e => e.stopPropagation()}
          className="flex-1 min-w-0 border border-gray-300 rounded px-2 py-1 text-xs font-mono"
          placeholder="ビルドするワークスペースを入力してください（例：~/ros2_ws）"
        />

        {/* 右: オプション + ビルドボタン */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={e => { e.stopPropagation(); setShowOptions(o => !o); }}
            className={`p-1 rounded hover:text-gray-800 ${showOptions ? 'text-gray-700' : 'text-gray-400'}`}
            title="詳細オプション"
          >
            <Settings className="w-4 h-4" />
          </button>

          {isBusy ? (
            <button
              onClick={handleCancel}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-red-500 text-white rounded hover:bg-red-600"
            >
              <X className="w-3 h-3" />
              中断
            </button>
          ) : (
            <button
              onClick={handleBuild}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-green-600 text-white rounded hover:bg-green-700"
            >
              <Hammer className="w-3 h-3" />
              実行
            </button>
          )}
        </div>
      </div>

      {/* 詳細オプション */}
      {showOptions && (
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex flex-col gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-gray-600 w-36 flex-shrink-0">パッケージ名（任意）</span>
            <input
              value={packageFilter}
              onChange={e => setPackageFilter(e.target.value)}
              className="flex-1 border border-gray-300 rounded px-2 py-1 font-mono"
              placeholder="my_package  ← 空白で全ビルド"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="build-symlink"
              checked={useSymlink}
              onChange={e => setUseSymlink(e.target.checked)}
            />
            <label htmlFor="build-symlink" className="text-gray-600 cursor-pointer">
              --symlink-install（Python ファイルの変更をリビルドなしで高速反映）
            </label>
          </div>

          <div className="border-t border-gray-200 pt-2 mt-1 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="auto-build-on-save"
                checked={autoBuildOnSave}
                onChange={e => setAutoBuildOnSave(e.target.checked)}
              />
              <label htmlFor="auto-build-on-save" className="text-gray-600 cursor-pointer">
                ファイル保存時に自動ビルド
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="run-after-build"
                checked={runAfterBuild}
                onChange={e => setRunAfterBuild(e.target.checked)}
              />
              <label htmlFor="run-after-build" className="text-gray-600 cursor-pointer">
                ビルド成功後に実行
              </label>
            </div>
            {runAfterBuild && (
              <div className="flex items-center gap-2 ml-5">
                <Play className="w-3 h-3 text-gray-400 flex-shrink-0" />
                <input
                  value={runCommand}
                  onChange={e => setRunCommand(e.target.value)}
                  className="flex-1 border border-gray-300 rounded px-2 py-1 font-mono"
                  placeholder="ros2 launch my_pkg my_launch.py"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ログエリア */}
      {isExpanded && (
        <div className="h-52 overflow-y-auto bg-[#1e1e1e] font-mono text-xs p-2 leading-relaxed">
          {logs.length === 0 && status === 'building' && (
            <span className="text-gray-500 animate-pulse">ビルド開始中...</span>
          )}
          {logs.length === 0 && status === 'idle' && (
            <span className="text-gray-500">「実行」ボタンで colcon build を開始します</span>
          )}
          {logs.map((entry, i) => (
            <pre key={i} className={`whitespace-pre-wrap break-all ${entryClass(entry.type, entry.text)}`}>
              {entry.text}
            </pre>
          ))}
          <div ref={logEndRef} />
        </div>
      )}
    </div>
  );
});

BuildPanel.displayName = 'BuildPanel';
