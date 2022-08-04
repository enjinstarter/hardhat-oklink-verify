import { assert } from "chai";

import { useEnvironment } from "../helpers";

describe("hardhat-oklink-verify configuration extension", function () {
  useEnvironment("hardhat-project-defined-config", "hardhat");

  it("the oklink field should be present", function () {
    assert.isDefined(this.env.config.oklink);
  });

  it("the oklink token should have value from hardhat.env.config.js", function () {
    const { oklink } = this.env.config;

    assert.equal(oklink.apiKey, "testtoken");
  });
});

describe("hardhat-oklink-verify configuration defaults in an empty project", function () {
  useEnvironment("hardhat-project-undefined-config", "hardhat");

  it("the oklink field should be present", function () {
    assert.isDefined(this.env.config.oklink);
  });

  it("the apiKey subfield should be the empty string", function () {
    assert.equal(this.env.config.oklink.apiKey, "");
  });
});

describe("hardhat-oklink-verify configuration with multiple api keys", function () {
  useEnvironment("hardhat-project-multiple-apikeys-config", "hardhat");

  it("the oklink field should be present", function () {
    assert.isDefined(this.env.config.oklink);
  });

  it("the apiKey subfield should be the apiKeys object", function () {
    assert.deepEqual(this.env.config.oklink.apiKey, {
      mainnet: "mainnet-testtoken",
      ropsten: "ropsten-testtoken",
    });
  });
});
