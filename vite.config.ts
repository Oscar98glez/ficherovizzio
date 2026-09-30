import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  // Las librerías de PDF/Excel son grandes pero sólo se cargan al exportar un informe
  build: { chunkSizeWarningLimit: 1000 },
});
