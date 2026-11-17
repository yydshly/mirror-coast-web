import { defineConfig } from 'vite';

export default defineConfig({
  // Relative assets work on GitHub Pages /mirror-coast-web/ and a custom domain.
  base: './',
  build: {
    rollupOptions: { output: { manualChunks: (id) => id.includes('/node_modules/three/') ? 'three' : id.includes('/node_modules/@dimforge/') ? 'physics' : undefined } },
  },
});

