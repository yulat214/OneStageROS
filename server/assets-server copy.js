const express = require('express');
const cors = require('cors');
const serveIndex = require('serve-index');
const path = require('path');


console.log('---------------------------------------------------');
try {
    require('./sync-minimal'); // ここを変更
} catch (e) {
    console.error('Asset sync failed:', e);
}
console.log('---------------------------------------------------');

const app = express();
const PORT = 8000;
const targetDirectory = path.join(__dirname, '../ros2_data');

app.use(cors());

// ヘッダー設定（変更なし）
const staticOptions = {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.urdf') || filePath.endsWith('.xml')) res.setHeader('Content-Type', 'text/xml');
        else if (filePath.endsWith('.stl')) res.setHeader('Content-Type', 'model/stl');
        else if (filePath.endsWith('.dae')) res.setHeader('Content-Type', 'model/vnd.collada+xml');
    }
};

app.use('/', 
    express.static(targetDirectory, staticOptions),
    serveIndex(targetDirectory, {'icons': true})
);

app.listen(PORT, () => {
    console.log(`Minimal Asset Server running on port ${PORT}`);
    console.log(`Serving: ${targetDirectory}`);
});
