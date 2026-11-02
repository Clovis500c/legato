import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

// No network, whatever a button tries.
const CSP = "default-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'none'; connect-src 'self'"

// ui/index.html as it is, started by boot.ts: ui/ knows nothing of the demo. Served (`demo` in .claude/launch.json, the
// phone layout's checks at 375 × 812): boot.ts is outside ui/, so by its file path.
const entry: Plugin = {
  name: 'demo-entry',
  transformIndexHtml: {
    order: 'pre',
    handler: (html, ctx) =>
      html
        .replace('./src/main.tsx', ctx.server ? `/@fs/${resolve(import.meta.dirname, 'boot.ts').replace(/\\/g, '/')}` : '../site/demo/boot.ts')
        .replace('<title>', `<meta http-equiv="Content-Security-Policy" content="${CSP}" />\n    <title>`),
  },
}

export default defineConfig({
  root: resolve(import.meta.dirname, '../../ui'),
  base: './',
  plugins: [entry, react(), tailwindcss()],
  build: { outDir: resolve(import.meta.dirname, '../public/demo'), emptyOutDir: true, target: 'es2023' },
})
