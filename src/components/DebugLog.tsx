import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { Terminal, Trash2, ChevronRight, ChevronDown, Activity, Languages, Settings, X, BotMessageSquare } from 'lucide-react';
import * as ROSLIB from 'roslib';

interface SnapshotData {
  activeNodes?: string[];
  activeTopics?: string[];
  fetchTime: number;
}

interface LogMessage {
  id: string;
  timestamp: string;
  level: number;
  name: string;
  msg: string;
  snapshot?: SnapshotData;
  translatedMsg?: string;
  isTranslating?: boolean;
  aiAnalysis?: string;
  isAnalyzing?: boolean;
}

interface AiStatus {
  configured: boolean;
  baseUrl: string;
  model: string;
}

const ALL_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'] as const;
type LevelName = typeof ALL_LEVELS[number];

const LEVEL_COLORS: Record<LevelName, string> = {
  DEBUG: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  INFO:  'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  WARN:  'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  ERROR: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  FATAL: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
};

function getLogStyle(level: number) {
  if (level >= 50) return { hex: '#9333ea', label: 'FATAL' as LevelName, bg: 'bg-purple-50 dark:bg-purple-900/20' };
  if (level >= 40) return { hex: '#c72525', label: 'ERROR' as LevelName, bg: 'bg-red-50 dark:bg-red-900/10' };
  if (level >= 30) return { hex: '#eab308', label: 'WARN'  as LevelName, bg: 'bg-yellow-50 dark:bg-yellow-900/10' };
  if (level >= 20) return { hex: '#11bd50', label: 'INFO'  as LevelName, bg: 'transparent' };
  return              { hex: '#595d64', label: 'DEBUG' as LevelName, bg: 'transparent' };
}

export function DebugLog() {
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set());
  const [hiddenLevels, setHiddenLevels] = useState<Set<LevelName>>(new Set());
  const [nodeFilter, setNodeFilter] = useState<string>('all');
  const [contextState, setContextState] = useState<Map<string, { above: number; below: number }>>(new Map());
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [settingsForm, setSettingsForm] = useState({ baseUrl: '', apiKey: '', model: '' });
  const [settingsSaving, setSettingsSaving] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [isConnected, setIsConnected] = useState(false);
  const rosRef = useRef<ROSLIB.Ros | null>(null);
  const hostname = window.location.hostname;

  // AI設定の読み込み
  const fetchAiStatus = useCallback(async () => {
    try {
      const r = await fetch(`http://${hostname}:8000/api/ai/status`);
      const d: AiStatus = await r.json();
      setAiStatus(d);
      setSettingsForm(f => ({ ...f, baseUrl: d.baseUrl, model: d.model }));
    } catch {}
  }, [hostname]);

  useEffect(() => { fetchAiStatus(); }, [fetchAiStatus]);

  useEffect(() => {
    const ros = new ROSLIB.Ros({ url: `ws://${hostname}:9090` });
    rosRef.current = ros;
    ros.on('connection', () => setIsConnected(true));
    ros.on('close', () => setIsConnected(false));

    const listener = new ROSLIB.Topic({
      ros,
      name: '/rosout',
      messageType: 'rcl_interfaces/msg/Log',
    });

    listener.subscribe((message: any) => {
      const timeStr = new Date().toLocaleTimeString('ja-JP', { hour12: false });
      const level = Number(message.level);
      const id = Math.random().toString(36).substr(2, 9);
      const newLog: LogMessage = {
        id, timestamp: timeStr, level,
        name: message.name || 'unknown',
        msg: message.msg || '(empty)',
      };
      setLogs(prev => {
        const next = [...prev, newLog];
        return next.slice(-300);
      });
      if (level >= 30) captureSnapshot(id, ros);
    });

    return () => { listener.unsubscribe(); ros.close(); };
  }, []);

  const captureSnapshot = (logId: string, ros: ROSLIB.Ros) => {
    try {
      const nodesClient = new ROSLIB.Service({ ros, name: '/rosapi/nodes', serviceType: 'rosapi_msgs/srv/Nodes' });
      const topicsClient = new ROSLIB.Service({ ros, name: '/rosapi/topics', serviceType: 'rosapi_msgs/srv/Topics' });
      nodesClient.callService({}, (nodeResult: any) => {
        topicsClient.callService({}, (topicResult: any) => {
          setLogs(prev => prev.map(l => l.id !== logId ? l : {
            ...l,
            snapshot: { activeNodes: nodeResult.nodes, activeTopics: topicResult.topics, fetchTime: Date.now() },
          }));
        }, () => {});
      }, () => {});
    } catch {}
  };

  const handleTranslate = async (logId: string, text: string) => {
    setLogs(prev => prev.map(l => l.id === logId ? { ...l, isTranslating: true } : l));
    try {
      const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|ja`);
      const d = await r.json();
      const translated = d.responseData?.translatedText || '翻訳できませんでした';
      setLogs(prev => prev.map(l => l.id === logId ? { ...l, translatedMsg: translated, isTranslating: false } : l));
    } catch {
      setLogs(prev => prev.map(l => l.id === logId ? { ...l, translatedMsg: 'エラー: 翻訳APIに接続できません', isTranslating: false } : l));
    }
  };

  const handleAnalyze = async (targetId: string) => {
    setLogs(prev => prev.map(l => l.id === targetId ? { ...l, isAnalyzing: true, aiAnalysis: undefined } : l));
    // 対象ログの前後5件をコンテキストとして送る
    const idx = logs.findIndex(l => l.id === targetId);
    const context = logs.slice(Math.max(0, idx - 5), idx + 6).map(l => ({
      level: getLogStyle(l.level).label,
      name: l.name,
      msg: l.msg,
    }));
    try {
      const r = await fetch(`http://${hostname}:8000/api/analyze-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: context }),
      });
      const d = await r.json();
      const result = r.ok ? d.result : `エラー: ${d.error}`;
      setLogs(prev => prev.map(l => l.id === targetId ? { ...l, aiAnalysis: result, isAnalyzing: false } : l));
      // 展開する
      setExpandedLogIds(prev => new Set([...prev, targetId]));
    } catch (e: any) {
      setLogs(prev => prev.map(l => l.id === targetId ? { ...l, aiAnalysis: `接続エラー: ${e.message}`, isAnalyzing: false } : l));
    }
  };

  const saveAiSettings = async () => {
    setSettingsSaving(true);
    try {
      const r = await fetch(`http://${hostname}:8000/api/ai/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: settingsForm.baseUrl, apiKey: settingsForm.apiKey || undefined, model: settingsForm.model }),
      });
      if (r.ok) { await fetchAiStatus(); setAiSettingsOpen(false); setSettingsForm(f => ({ ...f, apiKey: '' })); }
    } finally { setSettingsSaving(false); }
  };

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs.length]);

  const nodeNames = useMemo(() => Array.from(new Set(logs.map(l => l.name))).sort(), [logs]);

  const filteredLogs = useMemo(() =>
    logs.filter(l =>
      !hiddenLevels.has(getLogStyle(l.level).label) &&
      (nodeFilter === 'all' || l.name === nodeFilter)
    ), [logs, hiddenLevels, nodeFilter]);

  const openContext  = (id: string) => setContextState(prev => new Map(prev).set(id, { above: 5, below: 5 }));
  const closeContext = (id: string) => setContextState(prev => { const n = new Map(prev); n.delete(id); return n; });
  const expandAbove  = (id: string) => setContextState(prev => { const n = new Map(prev); const c = n.get(id)!; n.set(id, { ...c, above: c.above + 5 }); return n; });
  const expandBelow  = (id: string) => setContextState(prev => { const n = new Map(prev); const c = n.get(id)!; n.set(id, { ...c, below: c.below + 5 }); return n; });

  return (
    <div className="h-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden flex flex-col shadow-sm">

      {/* ヘッダー */}
      <div className="bg-gray-100 dark:bg-gray-700 px-3 py-1.5 border-b border-gray-300 dark:border-gray-600 flex flex-col gap-1 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-purple-600 dark:text-purple-400 flex-shrink-0" />
          <h2 className="text-sm text-gray-700 dark:text-gray-300">
            デバッグログ
            {isConnected
              ? <span className="text-xs ml-2 text-green-500">● 接続中</span>
              : <span className="text-xs ml-2 text-red-500">● 未接続</span>}
          </h2>
          <div className="ml-auto flex items-center gap-1">
            {/* AI設定ボタン */}
            <button
              onClick={() => setAiSettingsOpen(true)}
              title="AI解析設定"
              className={`p-1 rounded transition-colors ${aiStatus?.configured ? 'text-green-500 hover:bg-gray-200 dark:hover:bg-gray-600' : 'text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
            >
              <BotMessageSquare className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => { setLogs([]); setExpandedLogIds(new Set()); }}
              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
            </button>
          </div>
        </div>

        {/* レベルフィルター */}
        <div className="flex gap-1 items-center flex-wrap">
          {ALL_LEVELS.map(level => (
            <button
              key={level}
              onClick={() => setHiddenLevels(prev => { const n = new Set(prev); n.has(level) ? n.delete(level) : n.add(level); return n; })}
              className={`text-[10px] px-2 py-0.5 rounded font-bold transition-opacity border border-transparent ${LEVEL_COLORS[level]} ${hiddenLevels.has(level) ? 'opacity-30' : 'opacity-100'}`}
            >
              {level}
            </button>
          ))}
          {hiddenLevels.size > 0 && (
            <button onClick={() => setHiddenLevels(new Set())} className="text-[10px] px-2 py-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
              全表示
            </button>
          )}
        </div>

        {/* ノードフィルター */}
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[11px] text-gray-500 dark:text-gray-400 flex-shrink-0">ノード:</span>
          <select
            value={nodeFilter}
            onChange={e => setNodeFilter(e.target.value)}
            className="flex-1 text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
          >
            <option value="all">すべて</option>
            {nodeNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          {nodeFilter !== 'all' && (
            <button
              onClick={() => setNodeFilter('all')}
              className="text-[10px] px-2 py-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 flex-shrink-0"
            >
              解除
            </button>
          )}
        </div>
      </div>

      {/* ログ一覧 */}
      <div ref={scrollRef} className="flex-1 overflow-auto p-2 min-h-0 bg-gray-50 dark:bg-gray-900 font-mono text-xs">
        {filteredLogs.length === 0 ? (
          <div className="text-gray-400 dark:text-gray-500 mt-4 text-center py-4 italic">ログ待機中...</div>
        ) : (
          <div className="space-y-1">
            {filteredLogs.map(log => {
              const style = getLogStyle(log.level);
              const isWarnOrAbove = log.level >= 30;
              const isExpanded = expandedLogIds.has(log.id);

              const ctx = contextState.get(log.id);
              const logIdx = ctx ? logs.findIndex(l => l.id === log.id) : -1;
              const ctxStart = ctx ? Math.max(0, logIdx - ctx.above) : 0;
              const ctxEnd   = ctx ? Math.min(logs.length - 1, logIdx + ctx.below) : 0;
              const ctxLogs  = ctx ? logs.slice(ctxStart, ctxEnd + 1) : [];

              return (
                <div key={log.id}>
                <div className={`rounded px-2 py-1 ${style.bg}`}>
                  <div className="flex gap-2 items-start" style={{ color: style.hex }}>
                    {/* 展開ボタン（スナップショットまたはAI解析がある場合） */}
                    <div className="w-4 pt-0.5 flex-shrink-0 flex justify-center">
                      {(log.snapshot || log.aiAnalysis) && (
                        <button onClick={() => setExpandedLogIds(prev => { const n = new Set(prev); n.has(log.id) ? n.delete(log.id) : n.add(log.id); return n; })} className="hover:bg-gray-200 dark:hover:bg-gray-700 rounded p-0.5">
                          {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        </button>
                      )}
                    </div>
                    <span className="text-gray-400 dark:text-gray-600 flex-shrink-0">[{log.timestamp}]</span>
                    <span className="font-bold flex-shrink-0 w-12">{style.label}</span>
                    <span className="flex-shrink-0 opacity-70 max-w-[8rem] truncate" title={log.name}>[{log.name}]</span>
                    <span className="break-words flex-1 text-[1.1em] font-medium">{log.msg}</span>

                    {/* WARN以上: 前後5件・AI解析ボタン */}
                    {isWarnOrAbove && (
                      <div className="flex gap-1 flex-shrink-0 ml-1">
                        <button
                          onClick={() => ctx ? closeContext(log.id) : openContext(log.id)}
                          className={`text-xs px-2 py-1 rounded whitespace-nowrap transition-colors ${ctx ? 'bg-blue-200 dark:bg-blue-800 text-blue-700 dark:text-blue-300' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'}`}
                        >
                          {ctx ? '閉じる' : '前後5件'}
                        </button>
                        <button
                          onClick={() => handleAnalyze(log.id)}
                          disabled={log.isAnalyzing}
                          className={`text-xs px-2 py-1 rounded whitespace-nowrap transition-colors ${
                            aiStatus?.configured
                              ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-800/60'
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
                          } ${log.isAnalyzing ? 'animate-pulse' : ''}`}
                          title={aiStatus?.configured ? 'AIで解析' : 'AI設定が必要です'}
                        >
                          {log.isAnalyzing ? '解析中…' : 'AI解析'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 展開エリア */}
                  {isExpanded && (
                    <div className="ml-6 mt-2 mb-1 space-y-2">
                      {/* AI解析結果 */}
                      {log.aiAnalysis && (
                        <div className="p-2 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700/50 rounded text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                          <div className="text-[10px] font-bold text-purple-600 dark:text-purple-400 mb-1 flex items-center gap-1">
                            <BotMessageSquare className="w-3 h-3" /> AI解析
                          </div>
                          {log.aiAnalysis}
                        </div>
                      )}

                      {/* スナップショット + 翻訳 */}
                      {log.snapshot && (
                        <div className="p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-sm text-gray-600 dark:text-gray-300">
                          {/* 翻訳エリア */}
                          <div className="mb-3 p-2 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-100 dark:border-blue-800/50">
                            <div className="flex items-center justify-between mb-1">
                              <div className="text-xs font-bold text-blue-700 dark:text-blue-400 flex items-center gap-1">
                                <Languages className="w-3.5 h-3.5" /> 日本語訳
                              </div>
                              {!log.translatedMsg && !log.isTranslating && (
                                <button
                                  onClick={() => handleTranslate(log.id, log.msg)}
                                  className="text-[10px] bg-blue-100 dark:bg-blue-800 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded hover:bg-blue-200 dark:hover:bg-blue-700 font-bold shadow-sm transition-colors"
                                >
                                  翻訳する
                                </button>
                              )}
                            </div>
                            {log.isTranslating
                              ? <div className="text-gray-500 text-xs animate-pulse">翻訳中...</div>
                              : log.translatedMsg
                                ? <div className="text-gray-800 dark:text-gray-200 text-xs font-bold whitespace-pre-wrap">{log.translatedMsg}</div>
                                : <div className="text-gray-400 dark:text-gray-500 text-[10px]">エラー文を日本語に翻訳できます</div>
                            }
                          </div>

                          {/* ノード・トピック一覧 */}
                          <div className="flex items-center gap-1 mb-1 font-semibold text-[10px] uppercase text-gray-400">
                            <Activity className="w-3 h-3" /> System Snapshot
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <div className="text-gray-500 mb-1">Active Nodes ({log.snapshot.activeNodes?.length || 0}):</div>
                              <ul className="list-disc list-inside h-24 overflow-y-auto pl-1 bg-gray-50 dark:bg-gray-900 rounded border border-gray-100 dark:border-gray-700 p-1">
                                {log.snapshot.activeNodes?.map((n, i) => (
                                  <li key={i} className={n === log.name ? 'text-yellow-600 dark:text-yellow-400 font-bold' : ''}>{n}</li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <div className="text-gray-500 mb-1">Active Topics ({log.snapshot.activeTopics?.length || 0}):</div>
                              <ul className="list-disc list-inside h-24 overflow-y-auto pl-1 bg-gray-50 dark:bg-gray-900 rounded border border-gray-100 dark:border-gray-700 p-1">
                                {log.snapshot.activeTopics?.map((t, i) => (
                                  <li key={i} className="text-blue-600 dark:text-blue-400">{t}</li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* インラインコンテキスト */}
                {ctx && (
                  <div className="ml-2 mt-0.5 mb-1 border-l-2 border-blue-300 dark:border-blue-600 pl-2 space-y-0.5">
                    {/* ↑ もっと見る */}
                    {ctxStart > 0 && (
                      <button
                        onClick={() => expandAbove(log.id)}
                        className="w-full text-[9px] py-0.5 text-blue-500 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded flex items-center justify-center gap-1"
                      >
                        ↑ さらに5件（上に{ctxStart}件あります）
                      </button>
                    )}

                    {ctxLogs.map(cl => {
                      const cs = getLogStyle(cl.level);
                      const isTarget = cl.id === log.id;
                      return (
                        <div
                          key={cl.id}
                          className={`rounded px-2 py-0.5 flex gap-2 items-start text-[10px] font-mono ${cs.bg} ${isTarget ? 'ring-1 ring-blue-400 dark:ring-blue-500' : 'opacity-75'}`}
                          style={{ color: cs.hex }}
                        >
                          <span className="text-gray-400 dark:text-gray-600 flex-shrink-0">[{cl.timestamp}]</span>
                          <span className="font-bold flex-shrink-0 w-10">{cs.label}</span>
                          <span className="opacity-70 flex-shrink-0 max-w-[7rem] truncate">[{cl.name}]</span>
                          <span className="break-words flex-1">{cl.msg}</span>
                        </div>
                      );
                    })}

                    {/* ↓ もっと見る */}
                    {ctxEnd < logs.length - 1 && (
                      <button
                        onClick={() => expandBelow(log.id)}
                        className="w-full text-[9px] py-0.5 text-blue-500 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded flex items-center justify-center gap-1"
                      >
                        ↓ さらに5件（下に{logs.length - 1 - ctxEnd}件あります）
                      </button>
                    )}
                  </div>
                )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* AI設定モーダル */}
      {aiSettingsOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setAiSettingsOpen(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-bold text-gray-700 dark:text-gray-200">AI解析 設定</span>
              </div>
              <button onClick={() => setAiSettingsOpen(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div className={`text-xs px-2 py-1 rounded ${aiStatus?.configured ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400'}`}>
                {aiStatus?.configured ? '✓ APIキー設定済み' : '⚠ APIキー未設定'}
              </div>
              <label className="block">
                <span className="text-xs text-gray-500 dark:text-gray-400">Base URL</span>
                <input
                  type="text"
                  value={settingsForm.baseUrl}
                  onChange={e => setSettingsForm(f => ({ ...f, baseUrl: e.target.value }))}
                  placeholder="https://api.groq.com/openai/v1"
                  className="mt-1 w-full text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500 dark:text-gray-400">Model</span>
                <input
                  type="text"
                  value={settingsForm.model}
                  onChange={e => setSettingsForm(f => ({ ...f, model: e.target.value }))}
                  placeholder="llama-3.3-70b-versatile"
                  className="mt-1 w-full text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  APIキー {aiStatus?.configured && <span className="text-green-500">（設定済み・変更する場合のみ入力）</span>}
                </span>
                <input
                  type="password"
                  value={settingsForm.apiKey}
                  onChange={e => setSettingsForm(f => ({ ...f, apiKey: e.target.value }))}
                  placeholder={aiStatus?.configured ? '変更しない場合は空欄' : 'sk-...'}
                  className="mt-1 w-full text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
                />
                <p className="text-[10px] text-gray-400 mt-1">キーはサーバー側にのみ保存されます（ブラウザには送信されません）</p>
              </label>
              <button
                onClick={saveAiSettings}
                disabled={settingsSaving || !settingsForm.baseUrl || !settingsForm.model}
                className="w-full py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-bold rounded transition-colors"
              >
                {settingsSaving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
