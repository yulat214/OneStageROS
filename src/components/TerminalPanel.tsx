import React, { useEffect, useRef } from 'react';
import { Terminal as TerminalIcon, X } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface Props {
  isOpen: boolean;
  height: number;
  onClose: () => void;
  onHeightChange: (h: number) => void;
}

export const TerminalPanel: React.FC<Props> = ({ isOpen, height, onClose, onHeightChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const initializedRef = useRef(false);
  const drag = useRef({ active: false, startY: 0, startH: 0 });

  // ドラッグによるリサイズ
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!drag.current.active) return;
      const delta = drag.current.startY - e.clientY;
      onHeightChange(Math.max(120, Math.min(window.innerHeight * 0.7, drag.current.startH + delta)));
    };
    const onUp = () => { drag.current.active = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [onHeightChange]);

  // 初回オープン時に xterm 初期化、以降は fit のみ
  useEffect(() => {
    if (!isOpen) return;

    if (!initializedRef.current) {
      initializedRef.current = true;
      // display:flex が DOM に反映されてから open() を呼ぶ
      requestAnimationFrame(() => {
        if (!containerRef.current) return;

        const term = new Terminal({
          theme: {
            background: '#ffffff',
            foreground: '#1e1e1e',
            cursor: '#374151',
            cursorAccent: '#ffffff',
            selectionBackground: '#add6ff',
            black: '#000000',   red: '#cd3131',   green: '#008000',   yellow: '#795e26',
            blue: '#0451a5',    magenta: '#bc05bc', cyan: '#0598bc',  white: '#555555',
            brightBlack: '#686868', brightRed: '#cd3131', brightGreen: '#14ce14', brightYellow: '#b5ba00',
            brightBlue: '#0451a5', brightMagenta: '#bc05bc', brightCyan: '#0598bc', brightWhite: '#a5a5a5',
          },
          fontSize: 13,
          fontFamily: 'Consolas, "Courier New", monospace',
          cursorBlink: true,
          scrollback: 5000,
        });
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(containerRef.current);
        fitAddon.fit();
        termRef.current = term;
        fitRef.current = fitAddon;

        const ws = new WebSocket(`ws://${window.location.hostname}:8000/terminal`);
        wsRef.current = ws;

        ws.onopen = () => term.writeln('\x1b[32m接続しました\x1b[0m');
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'output') term.write(msg.data);
          } catch {}
        };
        ws.onclose = () => term.writeln('\r\n\x1b[31m接続が切断されました\x1b[0m');
        ws.onerror = () => term.writeln('\r\n\x1b[31m接続エラー（サーバーが起動しているか確認してください）\x1b[0m');

        term.onData(data => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }));
        });
        term.onResize(({ cols, rows }) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        });
      });
    } else {
      requestAnimationFrame(() => fitRef.current?.fit());
    }
  }, [isOpen]);

  // 高さ変更時にターミナルを再フィット
  useEffect(() => {
    if (isOpen) requestAnimationFrame(() => fitRef.current?.fit());
  }, [height, isOpen]);

  // アンマウント時にクリーンアップ
  useEffect(() => () => {
    termRef.current?.dispose();
    wsRef.current?.close();
  }, []);

  return (
    <div
      style={{ height: isOpen ? height : 0 }}
      className="flex-shrink-0 overflow-hidden bg-white flex flex-col border-t border-gray-200"
    >
      {/* resize handle */}
      <div
        className="h-3 flex-shrink-0 cursor-row-resize bg-gray-100 hover:bg-blue-50 transition-colors flex items-center justify-center group border-t border-gray-200"
        onMouseDown={e => {
          drag.current = { active: true, startY: e.clientY, startH: height };
          e.preventDefault();
        }}
      >
        <div className="w-10 h-0.5 rounded-full bg-gray-300 group-hover:bg-blue-400 transition-colors" />
      </div>
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 flex-shrink-0 border-b border-gray-200">
        <div className="flex items-center gap-2 text-gray-600 text-xs font-medium">
          <TerminalIcon className="w-3.5 h-3.5" />
          ターミナル
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 rounded p-0.5 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
      {/* xterm コンテナ（常に DOM に存在させてセッションを維持） */}
      <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden px-1" />
    </div>
  );
};
