const { defineConfig } = require('eslint/config')
const tsParser = require('@typescript-eslint/parser')
const tsPlugin = require('@typescript-eslint/eslint-plugin')
const prettier = require('eslint-plugin-prettier')
const prettierConfig = require('eslint-config-prettier')
const reactHooks = require('eslint-plugin-react-hooks')

module.exports = defineConfig([
  {
    ignores: ['node_modules/', 'lib/', 'nitrogen/', 'example/'],
  },
  {
    files: ['**/*.{js,ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
      prettier,
    },
    rules: {
      ...prettierConfig.rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'prettier/prettier': [
        'warn',
        {
          quoteProps: 'consistent',
          singleQuote: true,
          tabWidth: 2,
          trailingComma: 'es5',
          useTabs: false,
          semi: false,
        },
      ],
    },
  },
])
