export type ChainConfig = Record<string, OklinkChainConfig>;

export interface CustomChain {
  network: string;
  chainId: number;
  urls: OklinkURLs;
}

export interface OklinkUserConfig {
  apiKey?: string | Record<string, string>;
  customChains?: CustomChain[];
  licenseType?: string;
}

export interface OklinkConfig {
  apiKey?: string | Record<string, string>;
  customChains: CustomChain[];
  licenseType?: string;
}

export interface OklinkURLs {
  apiURL: string;
  browserURL: string;
}

interface OklinkChainConfig {
  chainId: number;
  urls: OklinkURLs;
}

export interface OklinkNetworkEntry {
  network: string;
  urls: OklinkURLs;
}
