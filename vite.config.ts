import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths so the build works from any folder (or GitHub Pages).
  base: './',
  build: {
    // Rapier ships its physics engine as inlined WebAssembly; the bundle is big by design.
    chunkSizeWarningLimit: 6000,
  },
});
