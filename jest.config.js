module.exports = {
  displayName: 'github-actions-jest',
  transform: {
    '^.+\\.[tj]s$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  maxWorkers: 2,
};
