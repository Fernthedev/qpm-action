import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import jest from 'eslint-plugin-jest'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  { languageOptions: { globals: globals.node } },
  {
    files: ['src/**/*.ts', '__tests__/**/*.ts'],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.test.json',
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/no-floating-promises': ['error', { checkThenables: true }],
      '@typescript-eslint/no-misused-promises': 'error'
    }
  },
  {
    ...jest.configs['flat/recommended'],
    files: ['__tests__/**/*.test.ts'],
    rules: {
      ...jest.configs['flat/recommended'].rules,
      'jest/no-disabled-tests': 'error',
      'jest/expect-expect': 'error'
    }
  }
)
