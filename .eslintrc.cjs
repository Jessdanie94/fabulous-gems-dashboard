/** @type {import("@types/eslint").Linter.BaseConfig} */
module.exports = {
  root: true,
  extends: [
    "@remix-run/eslint-config",
    "@remix-run/eslint-config/node",
    "@remix-run/eslint-config/jest-testing-library",
    "prettier",
  ],
  settings: {
    jest: {
      version: 29,
    },
   },
  globals: {
    shopify: "readonly",
  },
};
/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  extends: [
    'eslint:recommended',
  ],
  rules: {
    // Finance safety rules per your blueprint
    'no-console': 'off', // CLI needs console for audit logs
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-implied-eval': 'error',
    'no-secrets/no-secrets': 'off', // if you have plugin, keep off here and use in workflow

    // Code quality
    'prefer-const': 'error',
    'no-var': 'error',
    'object-shorthand': 'error',
    'eqeqeq': ['error', 'always'],

    // Decimal / currency safety - no floating point tricks
    'no-restricted-syntax': [
      'error',
      {
        selector: "BinaryExpression[operator='/']",
        message: 'Use decimal.js for amount division, not native /',
      }
    ]
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'exports/',
    '*.csv',
    '*.pdf',
  ],
  overrides: [
    {
      files: ['src/**/*.js'],
      rules: {
        // Enforce read-only - prevent accidental mutations in reconciliation
        'no-restricted-imports': ['error', {
          patterns: [{
            group: ['*shopify*'],
            message: 'Use only whitelisted read-only wrapper in src/ingestion.js'
          }]
        }]
      }
    }
  ]
};