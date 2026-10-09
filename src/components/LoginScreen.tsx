import { useState, type FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { login } from '../lib/auth';

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await login(token);
    setSubmitting(false);
    if (result.ok) onSuccess();
    else setError(result.error);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <form onSubmit={submit} className="w-full max-w-md bg-white rounded-lg border border-gray-200 shadow-sm p-6 space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-gray-700" />
          <h1 className="text-lg font-semibold text-gray-900">OneStageROS にログイン</h1>
        </div>
        <p className="text-sm text-gray-600">
          OneStageROS を起動している環境のターミナルで次のコマンドを実行し、表示されたトークンを入力してください。
        </p>
        <pre className="text-sm bg-gray-900 text-gray-100 rounded px-3 py-2">cd ~/OneStageROS && npm run token</pre>
        <input
          type="password"
          autoFocus
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="トークン"
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={!token.trim() || submitting}
          className="w-full bg-blue-600 text-white rounded px-3 py-2 text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300"
        >
          {submitting ? '確認中…' : 'ログイン'}
        </button>
        <p className="text-xs text-gray-500">ログインは、このブラウザで30日間有効です。</p>
      </form>
    </div>
  );
}
