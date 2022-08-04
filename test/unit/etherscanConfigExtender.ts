import { assert } from "chai";
import { HardhatConfig } from "hardhat/types/config";
import { oklinkConfigExtender } from "../../src/config";

describe("Config extension", () => {
  it("should enforce a default config if none provided", () => {
    const resolvedConfig = {} as HardhatConfig;
    oklinkConfigExtender(resolvedConfig, {});

    assert.deepStrictEqual(resolvedConfig.oklink, {
      apiKey: "",
      customChains: [],
      licenseType: "",
    });
  });

  it("copy across a string api key", () => {
    const resolvedConfig = {} as HardhatConfig;
    oklinkConfigExtender(resolvedConfig, {
      oklink: { apiKey: "example_token" },
    });

    assert.deepStrictEqual(resolvedConfig.oklink, {
      apiKey: "example_token",
      customChains: [],
      licenseType: "",
    });
  });

  it("copy across an OKLink api keys object", () => {
    const resolvedConfig = {} as HardhatConfig;
    oklinkConfigExtender(resolvedConfig, {
      oklink: { apiKey: { ropsten: "example_token" } },
    });

    assert.deepStrictEqual(resolvedConfig.oklink, {
      apiKey: { ropsten: "example_token" },
      customChains: [],
      licenseType: "",
    });
  });

  it("copy across a license type", () => {
    const resolvedConfig = {} as HardhatConfig;
    oklinkConfigExtender(resolvedConfig, {
      oklink: { apiKey: "example_token", licenseType: "UNLICENSED" },
    });

    assert.deepStrictEqual(resolvedConfig.oklink, {
      apiKey: "example_token",
      customChains: [],
      licenseType: "UNLICENSED",
    });
  });

  it("should accept custom chains", async function () {
    const resolvedConfig = {} as HardhatConfig;
    oklinkConfigExtender(resolvedConfig, {
      oklink: {
        apiKey: { ropsten: "example_token" },
        customChains: [
          {
            network: "My Chain",
            chainId: 12345,
            urls: {
              apiURL: "https://mychainscan.io/api",
              browserURL: "https://mychainscan.io",
            },
          },
        ],
        licenseType: "",
      },
    });

    assert.deepStrictEqual(resolvedConfig.oklink, {
      apiKey: { ropsten: "example_token" },
      customChains: [
        {
          network: "My Chain",
          chainId: 12345,
          urls: {
            apiURL: "https://mychainscan.io/api",
            browserURL: "https://mychainscan.io",
          },
        },
      ],
      licenseType: "",
    });
  });
});
