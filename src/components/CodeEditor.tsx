import React, { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { Save, FileCode, Check, AlertCircle } from 'lucide-react';

interface CodeEditorProps {
  filePath: string | null;
  onSaveSuccess?: () => void;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({ filePath, onSaveSuccess }) => {
  const [code, setCode] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [saveResult, setSaveResult] = useState<'saved' | 'error' | null>(null);

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
      } catch {
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
    setSaveResult(null);
    try {
      const res = await fetch(`${API_BASE}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content: code }),
      });
      if (res.ok) {
        setSaveResult('saved');
        setTimeout(() => setSaveResult(null), 2000);
        onSaveSuccess?.();
      } else {
        setSaveResult('error');
        setTimeout(() => setSaveResult(null), 3000);
      }
    } catch {
      setSaveResult('error');
      setTimeout(() => setSaveResult(null), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  const getLanguage = (path: string) => {
    if (path.endsWith('.py')) return 'python';
    if (path.endsWith('.js') || path.endsWith('.jsx')) return 'javascript';
    if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript';
    if (path.endsWith('.cpp') || path.endsWith('.cc') || path.endsWith('.hpp') || path.endsWith('.h') || path.endsWith('.c')) return 'cpp';
    if (path.endsWith('.xml') || path.endsWith('.urdf') || path.endsWith('.xacro') || path.endsWith('.launch') || path.endsWith('.sdf') || path.endsWith('.world') || path.endsWith('.model')) return 'xml';
    if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'yaml';
    if (path.endsWith('.sh') || path.endsWith('.bash')) return 'shell';
    if (path.endsWith('.json')) return 'json';
    if (path.endsWith('.cmake') || path.includes('CMakeLists')) return 'cmake';
    if (path.endsWith('.md')) return 'markdown';
    return 'plaintext';
  };

  const saveButtonClass = () => {
    if (!filePath) return 'bg-gray-100 text-gray-400 cursor-not-allowed';
    if (isSaving) return 'bg-blue-300 text-white cursor-wait';
    if (saveResult === 'saved') return 'bg-green-500 text-white';
    if (saveResult === 'error') return 'bg-red-500 text-white';
    return 'bg-blue-600 text-white hover:bg-blue-700';
  };

  const saveButtonIcon = () => {
    if (saveResult === 'saved') return <Check className="w-4 h-4" />;
    if (saveResult === 'error') return <AlertCircle className="w-4 h-4" />;
    return <Save className="w-4 h-4" />;
  };

  const saveButtonLabel = () => {
    if (isSaving) return '保存中...';
    if (saveResult === 'saved') return '保存済み';
    if (saveResult === 'error') return '保存失敗';
    return '保存';
  };

  return (
    <div className="w-full h-full flex flex-col bg-white">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-2 text-base text-gray-600">
          <FileCode className="w-4 h-4" />
          {filePath ? `~/${filePath}` : '未選択'}
          {isLoading && <span className="text-sm text-gray-400 ml-2">読み込み中...</span>}
        </div>

        <button
          onClick={handleSave}
          disabled={!filePath || isSaving || isLoading}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold rounded transition-colors ${saveButtonClass()}`}
        >
          {saveButtonIcon()}
          {saveButtonLabel()}
        </button>
      </div>

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
            readOnly: !filePath,
          }}
        />
      </div>
    </div>
  );
};
