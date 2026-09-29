module.exports = {
  displayName: 'outbox',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/libs/outbox',
  // Integration tests start real Postgres/RabbitMQ containers.
  testTimeout: 180_000,
};
