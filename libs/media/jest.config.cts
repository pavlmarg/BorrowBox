module.exports = {
  displayName: 'media',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/libs/media',
  // Integration tests start a real S3 (SeaweedFS) container.
  testTimeout: 180_000,
};
