import { ChainConfig } from "./types";

// See https://github.com/ethereum/EIPs/blob/master/EIPS/eip-155.md#list-of-chain-ids
export const chainConfig: ChainConfig = {
  okc: {
    chainId: 66,
    urls: {
      apiURL:
        "https://www.oklink.com/api/explorer/v1/okc/contract/multipartVerify",
      browserURL: "https://www.oklink.com/en/okc",
    },
  },
  okcTestnet: {
    chainId: 65,
    urls: {
      apiURL:
        "https://www.oklink.com/api/explorer/v1/okc_test/contract/multipartVerify",
      browserURL: "https://www.oklink.com/en/okc-test",
    },
  },
  // We are not adding new networks to the core of hardhat-oklink-verify anymore.
  // Please read this to learn how to manually add support for custom networks:
  // https://github.com/enjinstarter/hardhat-oklink-verify#adding-support-for-other-networks
};
