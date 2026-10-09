  import { defineConfig, loadEnv } from 'vite';
  import react from '@vitejs/plugin-react-swc';
  import tailwindcss from '@tailwindcss/vite';
  import path from 'path';
  import { createRequire } from 'module';

  const { isTrustedRequest } = createRequire(import.meta.url)('./server/auth.js');

  // バックエンド（127.0.0.1:8000）への中継。同一オリジン判定のため、ブラウザが送った Host ヘッダーをそのまま渡す
  const backend = (ws = false) => ({ target: 'http://127.0.0.1:8000', changeOrigin: false, ws });
  // rosbridge（127.0.0.1）へは、バックエンドを通さず直接中継する。
  // バックエンドのシミュレーションや同期処理と、ROS の通信が互いに待たされないようにするため
  // バックエンドを通らないため、アクセス元の確認（server/auth.js）は中継の前に Vite で行う（false を返すと 404）
  const rosbridge = (port: number) => ({
    target: `ws://127.0.0.1:${port}`,
    ws: true,
    changeOrigin: false,
    rewrite: () => '/',
    bypass: (req: import('http').IncomingMessage) => (isTrustedRequest(req) ? undefined : false),
  });

  export default defineConfig(({ mode }) => {
    // サーバーと同じく、リポジトリ直下の .env を server/.env より優先し、コマンドラインの環境変数を最優先にする
    const env = {
      ...loadEnv(mode, path.join(__dirname, 'server'), ''),
      ...loadEnv(mode, __dirname, ''),
      ...process.env,
    };
    // true のときだけ、この PC 以外（同じネットワークの PC、Docker のホスト機）からのアクセスを受け付ける
    const expose = /^(1|true|yes|on)$/i.test((env.ONESTAGE_EXPOSE ?? '').trim());

    return {
      plugins: [tailwindcss(), react()],
      resolve: {
        extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
        alias: {
          '@': path.resolve(__dirname, './src'),
        },
      },
      build: {
        target: 'esnext',
        outDir: 'build',
        chunkSizeWarningLimit: 1600,
      },
      server: {
        host: expose ? '0.0.0.0' : '127.0.0.1',
        port: 3000,
        strictPort: true,
        open: !expose,
        proxy: {
          '/api': backend(),
          '/workspace': backend(),
          '/ros2_data': backend(),
          '/terminal': backend(true),
          // 先頭が ^ のキーは正規表現（/rosbridge が /rosbridge-camera に前方一致しないよう完全一致にする）
          '^/rosbridge$': rosbridge(9090),
          '^/rosbridge-camera$': rosbridge(9091),
        },
      },
    };
  });
