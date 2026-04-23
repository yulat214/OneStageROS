import React, { useState, useEffect } from 'react';
import { Folder, FileCode, FileText, File, ArrowLeft, RefreshCw } from 'lucide-react';

interface FileItem {
  name: string;
  isDirectory: boolean;
  path: string;
}

interface FileExplorerProps {
  onFileSelect: (path: string) => void;
  selectedPath?: string;
}

export const FileExplorer: React.FC<FileExplorerProps> = ({ onFileSelect, selectedPath }) => {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);

  const API_BASE = `http://${window.location.hostname}:8000/api`;

  // ディレクトリの中身を取得する
  const fetchDirectory = async (pathToFetch: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/ls?path=${encodeURIComponent(pathToFetch)}`);
      if (!res.ok) throw new Error('Failed to fetch directory');
      const data = await res.json();
      
      // フォルダを上に、ファイルを下にソート
      const sorted = data.sort((a: FileItem, b: FileItem) => {
        if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
        return a.isDirectory ? -1 : 1;
      });
      
      setItems(sorted);
      setCurrentPath(pathToFetch);
    } catch (e) {
      console.error(e);
      alert('ディレクトリの読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  // 初回マウント時にルートディレクトリを読み込む
  useEffect(() => {
    fetchDirectory('');
  }, []);

  // 上の階層へ戻る処理
  const handleGoUp = () => {
    if (!currentPath) return;
    const parts = currentPath.split('/');
    parts.pop(); // 現在のディレクトリを削除
    fetchDirectory(parts.join('/'));
  };

  // アイコンの出し分け
  const getFileIcon = (name: string) => {
    if (name.endsWith('.py') || name.endsWith('.cpp') || name.endsWith('.js')) return <FileCode className="w-4 h-4 text-blue-500" />;
    if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.yaml') || name.endsWith('.xml')) return <FileText className="w-4 h-4 text-gray-400" />;
    return <File className="w-4 h-4 text-gray-400" />;
  };

  return (
    <div className="w-full h-full flex flex-col bg-gray-50 border-r border-gray-200 text-sm">
      {/* ツールバー */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-100">
        <span className="font-semibold text-gray-700 truncate flex-1" title={`~/${currentPath}`}>
          ~/{currentPath || ' (ルート)'}
        </span>
        <button onClick={() => fetchDirectory(currentPath)} className="p-1 hover:bg-gray-200 rounded text-gray-500" title="更新">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ファイルリスト */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* 戻るボタン (ルート以外の時のみ表示) */}
        {currentPath && (
          <button 
            onClick={handleGoUp}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-gray-600 hover:bg-gray-200 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>.. (上の階層へ)</span>
          </button>
        )}

        {loading ? (
          <div className="px-4 py-2 text-gray-400 text-xs">読み込み中...</div>
        ) : items.length === 0 ? (
          <div className="px-4 py-2 text-gray-400 text-xs">空のフォルダです</div>
        ) : (
          items.map((item) => (
            <button
              key={item.path}
              onClick={() => item.isDirectory ? fetchDirectory(item.path) : onFileSelect(item.path)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 transition-colors text-left ${
                selectedPath === item.path && !item.isDirectory 
                  ? 'bg-blue-100 text-blue-700' 
                  : 'text-gray-700 hover:bg-gray-200'
              }`}
            >
              {item.isDirectory ? (
                <Folder className="w-4 h-4 text-yellow-500 fill-yellow-100" />
              ) : getFileIcon(item.name)}
              <span className="truncate">{item.name}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
};