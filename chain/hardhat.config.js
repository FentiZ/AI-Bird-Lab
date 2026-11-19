require('solidity-coverage');
const { subtask } = require('hardhat/config');
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require('hardhat/builtin-tasks/task-names');

// Reuse the solc JS compiler installed through npm instead of downloading it.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async ({ solcVersion }, _hre, runSuper) => {
  if (solcVersion === '0.8.24') {
    return {
      compilerPath: require.resolve('solc/soljson.js'),
      isSolcJs: true,
      version: solcVersion,
      longVersion: require('solc').version(),
    };
  }
  return runSuper();
});

module.exports = {
  solidity: { version: '0.8.24', settings: { optimizer: { enabled: false } } },
  networks: { hardhat: { chainId: 31337 } }
};
