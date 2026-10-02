import eslint from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import react from 'eslint-plugin-react'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      // Local agent worktrees and tooling (git-ignored).
      '.claude/**',
      '.agents/**',
      '**/lib/**',
      '**/nitrogen/**',
      '**/.expo/**',
      '**/android/**',
      '**/ios/**',
      '**/coverage/**',
      // The Docusaurus site has its own toolchain.
      'docs/**',
      'example/babel.config.js',
      'example/metro.config.js',
      'example/index.js',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.config.js', '**/*.config.mjs', '**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'react/react-in-jsx-scope': 'off',
    },
  },
  {
    // Known React Compiler violations: refs read/written during render and a
    // synchronous setState in an effect. They are refactored by #12 / #13
    // (useClusterer) and the #5 branch (useFadePresence); drop this override
    // with those fixes instead of adding files to it.
    files: [
      'package/src/hooks/useClusterer.ts',
      'package/src/compat/useFadePresence.ts',
    ],
    rules: {
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  }
)
