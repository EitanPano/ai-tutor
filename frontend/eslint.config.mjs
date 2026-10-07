import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import prettier from 'eslint-config-prettier/flat'

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    '.next-e2e/**',
    'next-env.d.ts',
    'src/types/api.ts',
    'playwright-report/**',
    'test-results/**'
  ]),
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@anthropic-ai/sdk', '@anthropic-ai/sdk/*'],
              message:
                'The Anthropic SDK is server-side only: call it from backend/, never from frontend/ (AC12).'
            }
          ]
        }
      ]
    }
  },
  prettier
])
