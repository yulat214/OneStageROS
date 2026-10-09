// リクエストが OneStageROS の画面から送られたものか、ログイン済みかを確認する。
// バックエンド（assets-server.js）と、rosbridge を中継する Vite（vite.config.ts）の両方から使う
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TOKEN_PATH = path.join(os.homedir(), '.config', 'onestage-ros', 'token');
const COOKIE_NAME = 'onestage_session';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

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

// --- ログイン（ONESTAGE_AUTH=token のときだけ使う） ---

function isAuthEnabled(env = process.env) {
    return /^token$/i.test((env.ONESTAGE_AUTH || '').trim());
}

function generateToken() {
    return crypto.randomBytes(24).toString('base64url');
}

function writeToken(token, flag) {
    fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true, mode: 0o700 });
    fs.writeFileSync(TOKEN_PATH, token + '\n', { mode: 0o600, flag });
}

// サーバーと Vite が同時に起動しても同じトークンになるよう、排他作成（wx）する
function loadOrCreateToken() {
    try {
        const token = fs.readFileSync(TOKEN_PATH, 'utf-8').trim();
        if (token) return token;
    } catch (e) {
        if (e.code !== 'ENOENT') throw e;
    }
    try {
        writeToken(generateToken(), 'wx');
    } catch (e) {
        if (e.code !== 'EEXIST') throw e;
    }
    return fs.readFileSync(TOKEN_PATH, 'utf-8').trim();
}

function resetToken() {
    const token = generateToken();
    writeToken(token, 'w');
    return token;
}

// Cookie にはトークンそのものではなく、トークンから導出した値を入れる
function sessionValue(token) {
    return crypto.createHmac('sha256', token).update('onestage-session').digest('base64url');
}

function safeEqual(a, b) {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function parseCookies(header) {
    const cookies = {};
    for (const part of (header || '').split(';')) {
        const idx = part.indexOf('=');
        if (idx < 0) continue;
        try {
            cookies[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
        } catch {}
    }
    return cookies;
}

function sessionCookie(token) {
    return `${COOKIE_NAME}=${sessionValue(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}`;
}

function hasValidSession(req, token) {
    const value = parseCookies(req.headers.cookie)[COOKIE_NAME];
    return !!value && safeEqual(value, sessionValue(token));
}

module.exports = {
    isAllowedHost,
    isSameOriginRequest,
    isTrustedRequest,
    TOKEN_PATH,
    isAuthEnabled,
    loadOrCreateToken,
    resetToken,
    safeEqual,
    sessionCookie,
    hasValidSession,
};
