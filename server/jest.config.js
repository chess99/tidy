/**
 * input: Jest 配置
 * output: Jest 测试运行器配置
 * pos: 测试配置：定义测试环境与匹配规则（变更需同步更新本头注释与所属目录 README）
 */

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js', '**/*.test.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/**/README.md',
  ],
  coverageDirectory: 'coverage',
  verbose: true,
};
