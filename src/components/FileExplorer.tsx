import React, { useState, useEffect, useRef } from 'react';
import { Folder, FileCode, FileText, File, ArrowLeft, RefreshCw, FilePlus } from 'lucide-react';

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
  const [isCreating, setIsCreating] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const newFileInputRef = useRef<HTMLInputElement>(null);

  const API_BASE = `http://${window.location.hostname}:8000/api`;

  const fetchDirectory = async (pathToFetch: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/ls?path=${encodeURIComponent(pathToFetch)}`);
      if (!res.ok) throw new Error('Failed to fetch directory');
      const data = await res.json();
      const sorted = data.sort((a: FileItem, b: FileItem) => {
        if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
        return a.isDirectory ? -1 : 1;
      });
      setItems(sorted);
      setCurrentPath(pathToFetch);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDirectory('');
  }, []);

  useEffect(() => {
    if (isCreating) {
      newFileInputRef.current?.focus();
    }
  }, [isCreating]);

  const handleGoUp = () => {
    if (!currentPath) return;
    const parts = currentPath.split('/');
    parts.pop();
    fetchDirectory(parts.join('/'));
  };

  const handleStartCreate = () => {
    setNewFileName('');
    setCreateError(null);
    setIsCreating(true);
  };

  const handleCancelCreate = () => {
    setIsCreating(false);
    setNewFileName('');
    setCreateError(null);
  };

  const handleConfirmCreate = async () => {
    const name = newFileName.trim();
    if (!name) return;

    const filePath = currentPath ? `${currentPath}/${name}` : name;

    try {
      const res = await fetch(`${API_BASE}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content: '' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setCreateError(err.error || '作成に失敗しました');
        return;
      }
      setIsCreating(false);
      setNewFileName('');
      setCreateError(null);
      await fetchDirectory(currentPath);
      onFileSelect(filePath);
    } catch {
      setCreateError('作成に失敗しました');
    }
  };

  const handleCreateKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleConfirmCreate();
    if (e.key === 'Escape') handleCancelCreate();
  };

  const getFileIcon = (name: string) => {
    if (name.endsWith('.py') || name.endsWith('.cpp') || name.endsWith('.js')) return <FileCode className="w-4 h-4 text-blue-500" />;
    if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.yaml') || name.endsWith('.xml')) return <FileText className="w-4 h-4 text-gray-400" />;
    return <File className="w-4 h-4 text-gray-400" />;
  };

  return (
    <div className="w-full h-full flex flex-col bg-gray-50 border-r border-gray-200 text-sm">
      {/* ツールバー */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-100">
        <span className="font-semibold text-gray-700 truncate flex-1 text-sm" title={`~/${currentPath}`}>
          ~/{currentPath || ' (ルート)'}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleStartCreate}
            className="p-1 hover:bg-gray-200 rounded text-gray-500 hover:text-gray-700"
            title="新規ファイル作成"
          >
            <FilePlus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => fetchDirectory(currentPath)}
            className="p-1 hover:bg-gray-200 rounded text-gray-500"
            title="更新"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ファイルリスト */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* 戻るボタン */}
        {currentPath && (
          <button
            onClick={handleGoUp}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-gray-600 hover:bg-gray-200 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>.. (上の階層へ)</span>
          </button>
        )}

        {/* 新規ファイル作成インライン入力 */}
        {isCreating && (
          <div className="px-3 py-1.5">
            <input
              ref={newFileInputRef}
              value={newFileName}
              onChange={e => { setNewFileName(e.target.value); setCreateError(null); }}
              onKeyDown={handleCreateKeyDown}
              onBlur={handleCancelCreate}
              className="w-full border border-blue-400 rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="ファイル名.py（Enter で作成）"
            />
            {createError && (
              <p className="text-sm text-red-500 mt-1">{createError}</p>
            )}
          </div>
        )}

        {loading ? (
          <div className="px-4 py-2 text-gray-400 text-sm">読み込み中...</div>
        ) : items.length === 0 ? (
          <div className="px-4 py-2 text-gray-400 text-sm">空のフォルダです</div>
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
