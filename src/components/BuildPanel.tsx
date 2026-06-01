import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Hammer, ChevronDown, ChevronUp, X, Settings } from 'lucide-react';

type LogEntry = { type: 'stdout' | 'stderr' | 'error' | 'system'; text: string };
type BuildStatus = 'idle' | 'building' | 'success' | 'failed';

export const BuildPanel: React.FC = () => {
  const [status, setStatus] = useState<BuildStatus>('idle');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [workspace, setWorkspace] = useState('~/ros2_ws');
  const [useSymlink, setUseSymlink] = useState(true);
  const [packageFilter, setPackageFilter] = useState('');
  const logEndRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const API_BASE = `http://${window.location.hostname}:8000/api`;

  useEffect(() => {
    if (isExpanded) logEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [logs, isExpanded]);

  useEffect(() => () => { esRef.current?.close(); }, []);

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
  }, [status, workspace, useSymlink, packageFilter]);

  const handleCancel = useCallback(async () => {
    esRef.current?.close();
    esRef.current = null;
    try { await fetch(`${API_BASE}/build/cancel`, { method: 'POST' }); } catch {}
    setStatus('idle');
    setLogs(prev => [...prev, { type: 'system', text: 'キャンセルしました' }]);
  }, []);

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

  return (
    <div className="border-t border-gray-200 flex-shrink-0 flex flex-col">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-50">
        <button
          onClick={() => setIsExpanded(e => !e)}
          className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900 flex-1 text-left"
        >
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          <Hammer className="w-4 h-4" />
          <span>ビルド</span>
          {statusBadge()}
        </button>

        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={e => { e.stopPropagation(); setShowOptions(o => !o); }}
            className={`p-1 rounded hover:text-gray-800 ${showOptions ? 'text-gray-700' : 'text-gray-400'}`}
            title="オプション"
          >
            <Settings className="w-4 h-4" />
          </button>

          {status === 'building' ? (
            <button
              onClick={e => { e.stopPropagation(); handleCancel(); }}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-red-500 text-white rounded hover:bg-red-600"
            >
              <X className="w-3 h-3" />
              中断
            </button>
          ) : (
            <button
              onClick={e => { e.stopPropagation(); handleBuild(); }}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-green-600 text-white rounded hover:bg-green-700"
            >
              <Hammer className="w-3 h-3" />
              実行
            </button>
          )}
        </div>
      </div>

      {/* オプション */}
      {showOptions && (
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex flex-col gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-gray-600 w-36 flex-shrink-0">ワークスペース</span>
            <input
              value={workspace}
              onChange={e => setWorkspace(e.target.value)}
              className="flex-1 border border-gray-300 rounded px-2 py-1 font-mono"
              placeholder="~/ros2_ws"
            />
          </div>
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
};
