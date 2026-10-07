import nx from '@nx/eslint-plugin';

// Which projects may import which (tags in each project.json):
// - scope:shared (contracts) runs in Node and the browser, so it imports nothing else.
// - scope:node (services, gateway, server libs) must never end up in the PWA,
//   and the PWA (scope:web) must never pull in server code.
const scopeConstraints = [
  { sourceTag: 'scope:shared', onlyDependOnLibsWithTags: ['scope:shared'] },
  {
    sourceTag: 'scope:node',
    onlyDependOnLibsWithTags: ['scope:node', 'scope:shared'],
  },
  {
    sourceTag: 'scope:web',
    onlyDependOnLibsWithTags: ['scope:web', 'scope:shared'],
  },
];

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: scopeConstraints,
        },
      ],
      // Test helpers (Testcontainers etc.) must never ship in runtime code.
      // A direct-import ban rather than Nx's notDependOnLibsWithTags, which is
      // transitive and would flag every app using a lib whose *specs* use them.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@borrowbox/testing',
              message: 'Test helpers are for *.spec.ts / *.test.ts files only.',
            },
          ],
        },
      ],
      // SQL injection guard: values go in as $1, $2, … parameters, never
      // into the SQL text. Optional filters use fixed SQL such as
      // `($3::text IS NULL OR category = $3)`.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='query'] > TemplateLiteral.arguments:first-child[expressions.length>0]",
          message:
            'No ${…} in SQL text: pass values as $1, $2, … parameters instead.',
        },
      ],
    },
  },
  {
    // Tests may use @borrowbox/testing; they aren't part of any build output.
    files: ['**/*.spec.ts', '**/*.test.ts'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: false,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: scopeConstraints,
        },
      ],
      'no-restricted-imports': 'off',
      // Tests build SQL for setup and assertions, never from user input.
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
];
