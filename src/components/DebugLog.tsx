import React, { useEffect, useState, useRef } from 'react';
import { Terminal, Trash2, ChevronRight, ChevronDown, Activity, Languages } from 'lucide-react'; // ★ Languagesアイコンを追加
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
  // ★追加: 翻訳用の状態を保持するプロパティ
  translatedMsg?: string;
  isTranslating?: boolean;
}

export function DebugLog() {
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set());
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isConnected, setIsConnected] = useState(false);
  const rosRef = useRef<ROSLIB.Ros | null>(null);

  useEffect(() => {
    const ros = new ROSLIB.Ros({ url: `ws://${window.location.hostname}:9090` });
    rosRef.current = ros;

    ros.on('connection', () => setIsConnected(true));
    ros.on('close', () => setIsConnected(false));

    const listener = new ROSLIB.Topic({
      ros: ros,
      name: '/rosout',
      messageType: 'rcl_interfaces/msg/Log'
    });

    listener.subscribe((message: any) => {
      const date = new Date();
      const timeStr = date.toLocaleTimeString('ja-JP', { hour12: false });
      const level = Number(message.level);
      const logId = Math.random().toString(36).substr(2, 9);

      const newLog: LogMessage = {
        id: logId,
        timestamp: timeStr,
        level: level,
        name: message.name || 'unknown',
        msg: message.msg || '(empty)'
      };

      setLogs(prev => {
        const nextLogs = [...prev, newLog];
        return nextLogs.slice(-199); 
      });

      if (level >= 30) {
        try {
          captureSnapshot(logId, ros);
        } catch (e: any) {
          console.error("スナップショットの取得処理でエラーが発生しました:", e);
        }
      }
    });

    return () => {
      listener.unsubscribe();
      ros.close();
    };
  }, []);

  const captureSnapshot = (logId: string, ros: ROSLIB.Ros) => {
    try {
      const nodesClient = new ROSLIB.Service({
        ros: ros,
        name: '/rosapi/nodes',
        serviceType: 'rosapi_msgs/srv/Nodes'
      });

      const topicsClient = new ROSLIB.Service({
        ros: ros,
        name: '/rosapi/topics',
        serviceType: 'rosapi_msgs/srv/Topics'
      });

      nodesClient.callService({}, (nodeResult: any) => {
        topicsClient.callService({}, (topicResult: any) => {
          setLogs(prevLogs => prevLogs.map(log => {
            if (log.id === logId) {
              return {
                ...log,
                snapshot: {
                  activeNodes: nodeResult.nodes,
                  activeTopics: topicResult.topics,
                  fetchTime: Date.now()
                }
              };
            }
            return log;
          }));
        }, (err) => console.warn("トピック取得失敗:", err));
      }, (err) => console.warn("ノード取得失敗:", err));
      
    } catch (e: any) {
      console.error("[captureSnapshot] 致命的なエラー:", e.message || e);
    }
  };

  // ★追加: ログのメッセージを翻訳する関数
  const handleTranslate = async (logId: string, text: string) => {
    // 翻訳中ステータスにする
    setLogs(prev => prev.map(l => l.id === logId ? { ...l, isTranslating: true } : l));

    try {
      // MyMemory APIを使用 (URLエンコードして英語から日本語へ)
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|ja`;
      const res = await fetch(url);
      const data = await res.json();
      
      const translated = data.responseData?.translatedText || "翻訳できませんでした";

      // 翻訳結果を保存
      setLogs(prev => prev.map(l => l.id === logId ? { ...l, translatedMsg: translated, isTranslating: false } : l));
    } catch (err) {
      setLogs(prev => prev.map(l => l.id === logId ? { ...l, translatedMsg: "エラー: 翻訳APIに接続できません", isTranslating: false } : l));
    }
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs.length]);

  const toggleExpand = (id: string) => {
    setExpandedLogIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getLogStyle = (level: number) => {
    // 50: FATAL
    if (level >= 50) return { 
      hex: '#9333ea', // purple-600
      label: 'FATAL', 
      bg: 'bg-purple-50 dark:bg-purple-900/20' 
    };
    
    // 40: ERROR
    if (level >= 40) return { 
      hex: '#c72525', // red-500
      label: 'ERROR', 
      bg: 'bg-red-50 dark:bg-red-900/10' 
    };
    
    // 30: WARN
    if (level >= 30) return { 
      hex: '#eab308', // yellow-500
      label: 'WARN', 
      bg: 'bg-yellow-50 dark:bg-yellow-900/10' 
    };
    
    // 20: INFO
    if (level >= 20) return { 
      hex: '#11bd50', // green-500
      label: 'INFO', 
      bg: 'transparent' 
    };
    
    return { 
      hex: '#595d64', // gray-500
      label: 'DEBUG', 
      bg: 'transparent' 
    };
  };

  return (
    <div className="h-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden flex flex-col shadow-sm">
      <div className="bg-gray-100 dark:bg-gray-700 px-4 py-2 border-b border-gray-300 dark:border-gray-600 flex items-center gap-2 flex-shrink-0">
        <Terminal className="w-4 h-4 text-purple-600 dark:text-purple-400" />
        <h2 className="text-sm text-gray-700 dark:text-gray-300">
          デバッグログ 
          {isConnected ? <span className="text-xs ml-2 text-green-500">● 接続中</span> : <span className="text-xs ml-2 text-red-500">● 未接続</span>}
        </h2>
        <button 
          onClick={() => { setLogs([]); setExpandedLogIds(new Set()); }}
          className="ml-auto p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
        </button>
      </div>
      
      <div ref={scrollRef} className="flex-1 overflow-auto p-2 min-h-0 bg-gray-50 dark:bg-gray-900 font-mono text-xs">
        {logs.length === 0 ? (
          <div className="text-gray-400 dark:text-gray-500 mt-4 text-center py-4 italic">ログ待機中...</div>
        ) : (
          <div className="space-y-1">
            {logs.map((log) => {
              const style = getLogStyle(log.level);
              const isExpanded = expandedLogIds.has(log.id);
              const hasSnapshot = !!log.snapshot;

              return (
                <div key={log.id} className={`rounded px-2 py-1 ${style.bg}`}>
                  {/* style={{ color: style.hex }} で、CSSクラスを通さず直接色を塗る */}
                  <div className="flex gap-2 items-start" style={{ color: style.hex }}>
                    <div className="w-4 pt-0.5 flex-shrink-0 flex justify-center">
                      {hasSnapshot && (
                        <button onClick={() => toggleExpand(log.id)} className="hover:bg-gray-200 dark:hover:bg-gray-700 rounded p-0.5">
                          {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        </button>
                      )}
                    </div>
                    
                    {/* タイムスタンプはあえて薄いままにするなら、個別にStyleを当てるかそのままにする */}
                    <span className="text-gray-400 dark:text-gray-600 flex-shrink-0">[{log.timestamp}]</span>
                    
                    <span className="font-bold flex-shrink-0 w-12">{style.label}</span>
                    <span className="flex-shrink-0 opacity-70 w-24 truncate">[{log.name}]</span>
                    <span className="break-words flex-1 text-[1.1em] font-medium">{log.msg}</span>
                  </div>

                  {isExpanded && hasSnapshot && (
                    <div className="ml-6 mt-2 mb-1 p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-sm text-gray-600 dark:text-gray-300">
                      
                      {/* ★追加: アコーディオンの一番上に「翻訳エリア」を配置 */}
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
                        {log.isTranslating ? (
                          <div className="text-gray-500 text-xs animate-pulse">Deep Learning Translation in progress...</div>
                        ) : log.translatedMsg ? (
                          <div className="text-gray-800 dark:text-gray-200 text-xs font-bold whitespace-pre-wrap">{log.translatedMsg}</div>
                        ) : (
                          <div className="text-gray-400 dark:text-gray-500 text-[10px]">エラー文を日本語に翻訳できます</div>
                        )}
                      </div>

                      <div className="flex items-center gap-1 mb-1 font-semibold text-[10px] uppercase text-gray-400">
                        <Activity className="w-3 h-3" />
                        System Snapshot at time of error
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-gray-500 mb-1">Active Nodes ({log.snapshot?.activeNodes?.length || 0}):</div>
                          <ul className="list-disc list-inside h-24 overflow-y-auto pl-1 bg-gray-50 dark:bg-gray-900 rounded border border-gray-100 dark:border-gray-700 p-1">
                            {log.snapshot?.activeNodes?.map((n, i) => (
                              <li key={i} className={n === log.name ? "text-yellow-600 dark:text-yellow-400 font-bold" : ""}>
                                {n}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <div className="text-gray-500 mb-1">Active Topics ({log.snapshot?.activeTopics?.length || 0}):</div>
                          <ul className="list-disc list-inside h-24 overflow-y-auto pl-1 bg-gray-50 dark:bg-gray-900 rounded border border-gray-100 dark:border-gray-700 p-1">
                            {log.snapshot?.activeTopics?.map((t, i) => (
                              <li key={i} className="text-blue-600 dark:text-blue-400">
                                {t}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}