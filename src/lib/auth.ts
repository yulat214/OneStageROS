// ログインの状態確認とログイン（ONESTAGE_AUTH=token のときだけ必要）

// ログインが無効（ONESTAGE_AUTH 未設定）の場合も true を返す
// npm run start 直後は Vite だけが先に起動していて、バックエンドへの中継が失敗（5xx）するので、
// 未ログイン扱いにせず、バックエンドが応答するまで待つ（30 秒で諦めてログイン画面を出す）
export async function isAuthenticated(): Promise<boolean> {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch('/api/auth/status');
      if (res.ok) {
        const { authenticated } = await res.json();
        return !!authenticated;
      }
      if (res.status < 500) return false;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

export async function login(token: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token.trim() }),
    });
    if (res.ok) return { ok: true };
    if (res.status === 429) return { ok: false, error: '試行回数が多すぎます。1分ほど待ってから再度お試しください。' };
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.error || `ログインに失敗しました（${res.status}）` };
  } catch {
    return { ok: false, error: 'サーバーに接続できません。OneStageROS が起動しているか確認してください。' };
  }
}

// 自動で開いたブラウザの URL（#token=...）からトークンを取り出し、アドレスバーと履歴から消す
export function takeTokenFromUrl(): string | null {
  const match = window.location.hash.match(/^#token=([^&]+)/);
  if (!match) return null;
  history.replaceState(null, '', window.location.pathname + window.location.search);
  return decodeURIComponent(match[1]);
}
