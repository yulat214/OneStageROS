// リクエストが OneStageROS の画面から送られたものかを確認する。
// バックエンド（assets-server.js）と、rosbridge を中継する Vite（vite.config.ts）の両方から使う

// localhost か IP アドレスでのアクセスだけを許可する（DNS rebinding 対策。Vite の既定と同じ範囲）。
// 攻撃者のドメインを 127.0.0.1 に向けて OneStageROS を読み取る攻撃では、Host が攻撃者のドメインになる
function isAllowedHost(req) {
    let hostname;
    try {
        hostname = new URL(`http://${req.headers.host}`).hostname;
    } catch {
        return false;
    }
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
    return hostname.startsWith('[') && hostname.endsWith(']');
}

// 他の Web サイトや、同じ PC の別のポートで動いているページからのリクエストを拒否する。
// ブラウザ以外（curl など）はヘッダーを偽装できるため、ネットワークからの保護は待ち受けアドレスとログインで行う
function isSameOriginRequest(req) {
    // same-origin: 自分の画面から / none: アドレスバーに直接入力 / same-site, cross-site: 他のページから
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return false;
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
        return new URL(origin).host === req.headers.host;
    } catch {
        return false;
    }
}

function isTrustedRequest(req) {
    return isAllowedHost(req) && isSameOriginRequest(req);
}

module.exports = { isAllowedHost, isSameOriginRequest, isTrustedRequest };
