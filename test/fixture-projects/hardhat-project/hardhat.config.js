require("@nomiclabs/hardhat-ethers");

require("../../../src/index");

module.exports = {
  oklink: {
    apiKey: process.env.OKLINK_API_KEY,
    licenseType: process.env.OKLINK_LICENSE_TYPE,
  },
  solidity: {
    compilers: [
      {
        version: "0.5.15",
      },
      {
        version: "0.7.5",
      },
    ],
  },
  networks: {
    testnet: {
      url: process.env.TESTNET_NETWORK_URL,
    },
  },
  paths: {
    artifacts: "artifacts-dir",
  },
};
