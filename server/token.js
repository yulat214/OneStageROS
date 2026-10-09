// ログイン用のトークンを表示する（npm run token）。--reset で再発行する
const { TOKEN_PATH, loadOrCreateToken, resetToken } = require('./auth');

const reset = process.argv.includes('--reset');
const token = reset ? resetToken() : loadOrCreateToken();

if (reset) {
    console.log('トークンを再発行しました。ログイン中のブラウザは再ログインが必要です。');
    console.log('起動中の OneStageROS は再起動してください。');
}
console.log(`トークン: ${token}`);
console.log(`保存場所: ${TOKEN_PATH}`);
