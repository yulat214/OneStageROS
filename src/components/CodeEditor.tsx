import React, { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { Save, FileCode } from 'lucide-react';

interface CodeEditorProps {
  filePath: string | null;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({ filePath }) => {
  const [code, setCode] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const API_BASE = `http://${window.location.hostname}:8000/api`;

  useEffect(() => {
    if (!filePath) {
      setCode('/* 左のファイルツリーからファイルを選択してください */');
      return;
    }

    const loadFile = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`${API_BASE}/file?path=${encodeURIComponent(filePath)}`);
        if (!res.ok) throw new Error('File not found');
        const data = await res.json();
        setCode(data.content);
      } catch (e) {
        setCode('// エラー: ファイルを読み込めませんでした');
      } finally {
        setIsLoading(false);
      }
    };

    loadFile();
  }, [filePath]);

  const handleSave = async () => {
    if (!filePath) return;
    setIsSaving(true);
    try {
      const res = await fetch(`${API_BASE}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content: code }),
      });
      if (res.ok) alert('保存しました！');
    } catch (e) {
      alert('保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  // ファイル拡張子から言語を判定
  const getLanguage = (path: string) => {
    if (path.endsWith('.py')) return 'python';
    if (path.endsWith('.js') || path.endsWith('.jsx')) return 'javascript';
    if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript';
    if (path.endsWith('.cpp') || path.endsWith('.hpp')) return 'cpp';
    if (path.endsWith('.xml') || path.endsWith('.urdf')) return 'xml';
    if (path.endsWith('.json')) return 'json';
    return 'plaintext';
  };

  return (
    <div className="w-full h-full flex flex-col bg-white">
      {/* エディター上部のヘッダーバー */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <FileCode className="w-4 h-4" />
          {filePath ? `~/${filePath}` : '未選択'}
          {isLoading && <span className="text-xs text-gray-400 ml-2">読み込み中...</span>}
        </div>
        
        <button
          onClick={handleSave}
          disabled={!filePath || isSaving || isLoading}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded transition-colors ${
            !filePath ? 'bg-gray-100 text-gray-400 cursor-not-allowed' :
            isSaving ? 'bg-blue-300 text-white cursor-wait' :
            'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          <Save className="w-4 h-4" />
          {isSaving ? '保存中...' : '保存'}
        </button>
      </div>

      {/* エディター本体 */}
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          language={filePath ? getLanguage(filePath) : 'plaintext'}
          theme="light"
          value={code}
          onChange={(val) => setCode(val || '')}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            automaticLayout: true,
            readOnly: !filePath, // ファイル未選択時は編集不可にする
          }}
        />
      </div>
    </div>
  );
};