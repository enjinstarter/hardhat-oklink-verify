import "hardhat/types/config";

import { OklinkConfig, OklinkUserConfig } from "./types";

declare module "hardhat/types/config" {
  interface HardhatUserConfig {
    oklink?: OklinkUserConfig;
  }

  interface HardhatConfig {
    oklink: OklinkConfig;
  }
}
