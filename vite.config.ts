  import { defineConfig, loadEnv } from 'vite';
  import react from '@vitejs/plugin-react-swc';
  import tailwindcss from '@tailwindcss/vite';
  import path from 'path';

  // バックエンド（127.0.0.1:8000）への中継。同一オリジン判定のため、ブラウザが送った Host ヘッダーをそのまま渡す
  const backend = (ws = false) => ({ target: 'http://127.0.0.1:8000', changeOrigin: false, ws });

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
          '/rosbridge': backend(true),
          '/rosbridge-camera': backend(true),
        },
      },
    };
  });
