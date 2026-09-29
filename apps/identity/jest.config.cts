module.exports = {
  displayName: 'identity',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  // jose, openid-client and oauth4webapi are ESM-only; Jest runs CommonJS,
  // so let ts-jest transpile them.
  transformIgnorePatterns: [
    '/node_modules/(?!(jose|openid-client|oauth4webapi)/)',
  ],
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/identity',
  // Integration tests start real Postgres/RabbitMQ containers.
  testTimeout: 180_000,
};
