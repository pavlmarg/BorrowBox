module.exports = {
  displayName: 'catalog',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  // jose (used by @borrowbox/auth) is ESM-only; Jest runs CommonJS, so let
  // ts-jest transpile it.
  transformIgnorePatterns: ['/node_modules/(?!jose/)'],
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/catalog',
  // Integration tests start real Postgres/RabbitMQ containers.
  testTimeout: 180_000,
  // Each suite boots its own Postgres + RabbitMQ; running them one at a time
  // keeps `nx affected` (3 projects in parallel) from starting a dozen
  // containers at once, which made health checks time out under load.
  maxWorkers: 1,
};
