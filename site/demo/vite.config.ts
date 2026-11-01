import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

// No network, whatever a button tries.
const CSP = "default-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'none'; connect-src 'self'"

// ui/index.html as it is, started by boot.ts: ui/ knows nothing of the demo.
const entry: Plugin = {
  name: 'demo-entry',
  transformIndexHtml: {
    order: 'pre',
    handler: (html) => html.replace('./src/main.tsx', '../site/demo/boot.ts').replace('<title>', `<meta http-equiv="Content-Security-Policy" content="${CSP}" />\n    <title>`),
  },
}

export default defineConfig({
  root: resolve(import.meta.dirname, '../../ui'),
  base: './',
  plugins: [entry, react(), tailwindcss()],
  build: { outDir: resolve(import.meta.dirname, '../public/demo'), emptyOutDir: true, target: 'es2023' },
})
