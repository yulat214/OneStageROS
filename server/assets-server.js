const express = require('express');
const cors = require('cors');
const serveIndex = require('serve-index');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = 8000;

const WORKSPACE_ROOT = os.homedir();

const ASSETS_DIR = path.join(__dirname, '../ros2_data');

app.use(cors());
app.use(express.json({ limit: '50mb' }));

console.log('---------------------------------------------------');
try {
    require('./sync-minimal');
} catch (e) {
    console.error('Asset sync failed:', e);
}
console.log('---------------------------------------------------');


function getSafeAbsolutePath(relPath) {
    if (!relPath) return WORKSPACE_ROOT;
    // 先頭のスラッシュを削除してから結合する
    const safeRelPath = relPath.replace(/^\/+/, ''); 
    return path.resolve(WORKSPACE_ROOT, safeRelPath);
}

// --- エディター用API ---

app.get('/api/ls', (req, res) => {
    try {
        const absPath = getSafeAbsolutePath(req.query.path);
        
        // ▼▼▼ この1行を追加 ▼▼▼
        console.log(`[Debug] Frontend asked for: "${req.query.path}", Looking in: "${absPath}"`);

        if (!absPath.startsWith(WORKSPACE_ROOT)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        if (!fs.existsSync(absPath)) {
            return res.status(404).json({ error: 'Directory not found' });
        }
        const items = fs.readdirSync(absPath, { withFileTypes: true });
        const result = items.map(item => ({
            name: item.name,
            isDirectory: item.isDirectory(),
            // 隠しファイル（.gitなど）を見せないようにする場合はここでフィルタリングも可能
            path: req.query.path ? path.join(req.query.path, item.name) : item.name
        }));
        res.json(result);
    } catch (e) {
        console.error('[API ls Error]', e);
        res.status(500).json({ error: e.message });
    }
});

// 2. ファイルを読み込む (cat)
app.get('/api/file', (req, res) => {
    try {
        const absPath = getSafeAbsolutePath(req.query.path);

        if (!absPath.startsWith(WORKSPACE_ROOT)) return res.status(403).send('Forbidden');
        if (!fs.existsSync(absPath)) return res.status(404).send('Not Found');

        const content = fs.readFileSync(absPath, 'utf-8');
        res.json({ content });
    } catch (e) {
        console.error('[API file Error]', e);
        res.status(500).json({ error: e.message });
    }
});

// 3. ファイルを保存する (save)
app.post('/api/file', (req, res) => {
    try {
        const absPath = getSafeAbsolutePath(req.body.path);

        if (!absPath.startsWith(WORKSPACE_ROOT)) return res.status(403).send('Forbidden');

        const dir = path.dirname(absPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        fs.writeFileSync(absPath, req.body.content, 'utf-8');
        res.json({ success: true });
    } catch (e) {
        console.error('[API save Error]', e);
        res.status(500).json({ error: e.message });
    }
});

// --- 静的ファイル配信 ---
const staticOptions = {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.urdf')) res.setHeader('Content-Type', 'text/xml');
    }
};
app.use('/', express.static(ASSETS_DIR, staticOptions), serveIndex(ASSETS_DIR, {'icons': true}));

app.listen(PORT, () => {
    console.log(`Server: http://localhost:${PORT}`);
    console.log(`Editor Root Directory: ${WORKSPACE_ROOT}`);
});
