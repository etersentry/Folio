export default [
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        window:'readonly', document:'readonly', navigator:'readonly', console:'readonly',
        setTimeout:'readonly', clearTimeout:'readonly', requestAnimationFrame:'readonly',
        Blob:'readonly', File:'readonly', FileReader:'readonly', URL:'readonly', Image:'readonly',
        fetch:'readonly', Response:'readonly', indexedDB:'readonly', IDBRequest:'readonly',
        localStorage:'readonly', structuredClone:'readonly', ResizeObserver:'readonly',
        createImageBitmap:'readonly', CompressionStream:'readonly', TextEncoder:'readonly',
        Intl:'readonly', Node:'readonly', HTMLElement:'readonly', HTMLInputElement:'readonly',
        HTMLAnchorElement:'readonly', Event:'readonly', CSS:'readonly', DragEvent:'readonly', CSS:'readonly', btoa:'readonly',
      },
    },
    linterOptions: { reportUnusedDisableDirectives: true },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'no-dupe-keys': 'error',
      'no-dupe-class-members': 'error',
      'no-const-assign': 'error',
      'no-redeclare': 'error',
      'no-unreachable': 'error',
      'no-self-assign': 'error',
      'no-cond-assign': 'error',
      'no-constant-condition': 'warn',
    },
  },
];
