import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } },
    watch: { ignored: ['**/tmp/**', '**/.wrangler/**', '**/public/wasm/**', '**/public/models/**'] },
  },
  resolve: {
    alias: {
      // @tensorflow-models/pose-detection statically imports the BlazePose
      // runtime's `Pose` class from @mediapipe/pose, a classic-script build
      // with no ESM exports. This app only uses MoveNet, so the import is
      // dead code — redirect it to a tiny stub (src/vendor/mediapipe-pose-stub.js)
      // that satisfies the bundler without pulling in the real package.
      '@mediapipe/pose': fileURLToPath(
        new URL('./src/vendor/mediapipe-pose-stub.js', import.meta.url),
      ),
    },
  },
  optimizeDeps: {
    include: [
      'three',
      'three/addons/controls/OrbitControls.js',
      'lucide',
      '@mediapipe/tasks-vision',
      'qrcode',
      '@tensorflow/tfjs-core',
      '@tensorflow/tfjs-backend-cpu',
      '@tensorflow/tfjs-converter',
      '@tensorflow-models/pose-detection',
    ],
  },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        share: 'share.html',
        sky: 'sky.html',
        create: 'create.html',
        entrance: 'entrance.html',
        vr: 'vr.html',
        monitor: 'monitor.html',
      },
      output: {
        manualChunks(id) {
          if (id.includes('/three/')) return 'three';
          if (id.includes('/lucide/')) return 'icons';
        },
      },
    },
  },
});
