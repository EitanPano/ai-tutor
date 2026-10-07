import { defineConfig, globalIgnores } from 'eslint/config'
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier/flat'
import globals from 'globals'

export default defineConfig([
  globalIgnores(['dist/**']),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js', '.dependency-cruiser.cjs'] },
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  prettier
])
