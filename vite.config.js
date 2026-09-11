import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { watch: { ignored: ['**/tmp/**', '**/public/wasm/**', '**/public/models/**'] } },
  optimizeDeps: { include: ['three', 'lucide', '@mediapipe/tasks-vision'] },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/three/')) return 'three';
          if (id.includes('/lucide/')) return 'icons';
        },
      },
    },
  },
});
