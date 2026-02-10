import React, { useEffect, useState, useRef } from 'react';
import { Terminal, Trash2, ArrowDown } from 'lucide-react';
import * as ROSLIB from 'roslib';

// ログデータの型定義
interface LogMessage {
  id: string;
  timestamp: string;
  level: number;
  name: string;
  msg: string;
}

export function DebugLog() {
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isConnected, setIsConnected] = useState(false);

  // ▼ ROS接続とログ受信処理
  useEffect(() => {
    const ros = new ROSLIB.Ros({ url: 'ws://localhost:9090' });

    ros.on('connection', () => setIsConnected(true));
    ros.on('close', () => setIsConnected(false));

    // /rosout トピックの購読設定
    const listener = new ROSLIB.Topic({
      ros: ros,
      name: '/rosout',
      messageType: 'rcl_interfaces/msg/Log' // ROS 2の標準ログ型
    });

    listener.subscribe((message: any) => {
      // タイムスタンプの整形 (HH:mm:ss)
      const date = new Date();
      const timeStr = date.toLocaleTimeString('ja-JP', { hour12: false });

      const newLog: LogMessage = {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: timeStr,
        level: message.level, // 10=Debug, 20=Info, 30=Warn, 40=Error
        name: message.name,
        msg: message.msg
      };

      // ログを追加（最新200件に制限）
      setLogs(prev => [...prev.slice(-199), newLog]);
    });

    return () => {
      listener.unsubscribe();
      ros.close();
    };
  }, []);

  // ▼ ログが増えたら自動スクロール
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  // ▼ ログレベルに応じた色とラベルを返すヘルパー関数
  const getLogStyle = (level: number) => {
    // ROS 2のログレベル定数: Debug=10, Info=20, Warn=30, Error=40, Fatal=50
    if (level >= 40) return { color: 'text-red-600 dark:text-red-400', label: 'ERROR' };
    if (level >= 30) return { color: 'text-yellow-600 dark:text-yellow-400', label: 'WARN' };
    if (level >= 20) return { color: 'text-green-600 dark:text-green-400', label: 'INFO' };
    return { color: 'text-gray-500 dark:text-gray-400', label: 'DEBUG' };
  };

  return (
    <div className="h-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden flex flex-col shadow-sm">
      {/* ヘッダー */}
      <div className="bg-gray-100 dark:bg-gray-700 px-4 py-2 border-b border-gray-300 dark:border-gray-600 flex items-center gap-2 flex-shrink-0">
        <Terminal className="w-4 h-4 text-purple-600 dark:text-purple-400" />
        <h2 className="text-sm text-gray-700 dark:text-gray-300">
          デバッグログ 
          {isConnected ? <span className="text-xs ml-2 text-green-500">● 接続中</span> : <span className="text-xs ml-2 text-red-500">● 未接続</span>}
        </h2>
        
        <button 
          onClick={() => setLogs([])}
          className="ml-auto p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
          title="ログをクリア"
        >
          <Trash2 className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
        </button>
      </div>
      
      {/* コンテンツエリア */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-auto p-3 min-h-0 bg-gray-50 dark:bg-gray-900 font-mono text-xs"
      >
        {logs.length === 0 ? (
          <div className="text-gray-400 dark:text-gray-500 mt-4 text-center py-4 italic">
            ログ待機中...
          </div>
        ) : (
          <div className="space-y-1">
            {logs.map((log) => {
              const style = getLogStyle(log.level);
              return (
                <div key={log.id} className={`${style.color} flex gap-2 break-all`}>
                  <span className="text-gray-400 dark:text-gray-600 flex-shrink-0">
                    [{log.timestamp}]
                  </span>
                  <span className="font-bold flex-shrink-0 w-12">
                    {style.label}
                  </span>
                  <span className="flex-shrink-0 text-gray-500 dark:text-gray-500 w-24 truncate">
                    [{log.name}]
                  </span>
                  <span className="text-gray-800 dark:text-gray-300">
                    {log.msg}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
