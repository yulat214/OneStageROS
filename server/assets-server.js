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

// --- アセット同期の実行 ---
console.log('---------------------------------------------------');
try {
    require('./sync-minimal');
} catch (e) {
    console.error('Asset sync failed:', e);
}
console.log('---------------------------------------------------');

app.get('/api/ls', (req, res) => {
    try {
        const relPath = req.query.path || "";
        const absPath = path.resolve(WORKSPACE_ROOT, relPath);

        if (!absPath.startsWith(WORKSPACE_ROOT)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const items = fs.readdirSync(absPath, { withFileTypes: true });
        const result = items.map(item => ({
            name: item.name,
            isDirectory: item.isDirectory(),
            path: path.join(relPath, item.name)
        }));
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/file', (req, res) => {
    try {
        const relPath = req.query.path;
        const absPath = path.resolve(WORKSPACE_ROOT, relPath);

        if (!absPath.startsWith(WORKSPACE_ROOT)) return res.status(403).send('Forbidden');
        if (!fs.existsSync(absPath)) return res.status(404).send('Not Found');

        const content = fs.readFileSync(absPath, 'utf-8');
        res.json({ content });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/file', (req, res) => {
    try {
        const { path: relPath, content } = req.body;
        const absPath = path.resolve(WORKSPACE_ROOT, relPath);

        if (!absPath.startsWith(WORKSPACE_ROOT)) return res.status(403).send('Forbidden');

        const dir = path.dirname(absPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        fs.writeFileSync(absPath, content, 'utf-8');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const staticOptions = {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.urdf')) res.setHeader('Content-Type', 'text/xml');
    }
};
app.use('/', express.static(ASSETS_DIR, staticOptions), serveIndex(ASSETS_DIR, {'icons': true}));

app.listen(PORT, () => {
    console.log(`Server: http://localhost:${PORT}`);
    console.log(`Root: ${WORKSPACE_ROOT}`);
});