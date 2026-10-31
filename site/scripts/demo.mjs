// The website's demo (site/demo): the app's interface over invented data, built into public/demo with each site build.
// From the repo's root, where ui/'s packages are: the site needs them installed too (pages.yml).
import { execSync } from 'node:child_process'

execSync('pnpm exec vite build --config site/demo/vite.config.ts --logLevel warn', { cwd: '..', stdio: 'inherit' })
