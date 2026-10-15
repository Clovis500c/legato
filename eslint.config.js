import tseslint from 'typescript-eslint'

export default tseslint.config({ ignores: ['dist', 'target', 'src-tauri', 'node_modules'] }, ...tseslint.configs.recommended)
