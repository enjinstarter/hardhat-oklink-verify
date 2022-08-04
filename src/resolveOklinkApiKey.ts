import { NomicLabsHardhatPluginError } from "hardhat/plugins";
import { pluginName } from "./constants";
import { OklinkConfig } from "./types";

export const resolveOklinkApiKey = (
  apiKey: OklinkConfig["apiKey"],
  network: string
): string => {
  if (apiKey === undefined || apiKey === "") {
    throwMissingApiKeyError(network);
  }

  if (typeof apiKey === "string") {
    return apiKey;
  }

  const key = (apiKey as any)[network];

  if (key === undefined || key === "") {
    throwMissingApiKeyError(network);
  }

  return key;
};

function throwMissingApiKeyError(network: string): never {
  throw new NomicLabsHardhatPluginError(
    pluginName,
    `You are trying to verify a contract in '${network}', but no API token was found for this network. Please provide one in your hardhat config. For example:

{
  ...
  oklink: {
    apiKey: {
      ${network}: 'your API key'
    }
  }
}

See https://www.oklink.com/docs/en/`
  );
}
