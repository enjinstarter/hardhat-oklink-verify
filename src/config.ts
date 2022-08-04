import type LodashT from "lodash";

import { NomicLabsHardhatPluginError } from "hardhat/plugins";
import { ConfigExtender } from "hardhat/types";
import { chainConfig } from "./ChainConfig";
import { OklinkConfig } from "./types";
import { pluginName } from "./constants";

export const verifyAllowedChains = (oklinkConfig: OklinkConfig) => {
  if (
    oklinkConfig.apiKey === null ||
    oklinkConfig.apiKey === undefined ||
    typeof oklinkConfig.apiKey !== "object"
  ) {
    return;
  }

  // check if any of the configured api keys is for an unsupported network
  const builtinChains = Object.keys(chainConfig);
  const customChains = oklinkConfig.customChains.map((x) => x.network);
  const allowedChains = [...builtinChains, ...customChains];

  const actual = Object.keys(oklinkConfig.apiKey);

  const invalidNetwork = actual.find((chain) => !allowedChains.includes(chain));

  if (invalidNetwork !== undefined) {
    throw new NomicLabsHardhatPluginError(
      pluginName,
      `You set an OKLink API token for the network "${invalidNetwork}" but the plugin doesn't support it, or it's spelled incorrectly.

To see the list of supported networks, run this command:

  npx hardhat oklink-verify --list-networks

Learn more at https://hardhat.org/verify-multiple-networks`
    );
  }
};

export const oklinkConfigExtender: ConfigExtender = (
  resolvedConfig,
  config
) => {
  const defaultConfig = {
    apiKey: "",
    customChains: [],
    licenseType: "",
  };

  if (config.oklink !== undefined) {
    const { cloneDeep } = require("lodash") as typeof LodashT;
    const customConfig = cloneDeep(config.oklink);

    resolvedConfig.oklink = { ...defaultConfig, ...customConfig };
  } else {
    resolvedConfig.oklink = defaultConfig;
  }
};
