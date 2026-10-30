import tseslint from 'typescript-eslint'

export default tseslint.config({ ignores: ['dist', 'target', 'src-tauri', 'node_modules', 'site/.next', 'site/out', 'site/next-env.d.ts', 'ui/src/shared/generated'] }, ...tseslint.configs.recommended)
