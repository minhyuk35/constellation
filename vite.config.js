import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  server: { watch: { ignored: ['**/tmp/**', '**/public/wasm/**', '**/public/models/**'] } },
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
