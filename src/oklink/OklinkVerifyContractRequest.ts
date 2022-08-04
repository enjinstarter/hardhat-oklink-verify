export interface OklinkRequest {
  apiKey: string;
}

export interface OklinkVerifyRequest extends OklinkRequest {
  sourceName: string;
  sources: { [sourceName: string]: { content: string } };
  contractAddress: string;
  compilerVersion: string;
  evmVersion: string;
  optimization?: boolean;
  optimizationRuns?: number;
  licenseType: string;
  contractAbi: string;
  libraryList?: {
    [libraryFileName: string]: {
      [libraryName: string]: string;
    };
  };
  compilerType: "Solidity(MultipartFiles)";
}

export function toVerifyRequest(params: {
  apiKey: string;
  sourceName: string;
  sources: { [sourceName: string]: { content: string } };
  contractAddress: string;
  compilerVersion: string;
  evmVersion: string;
  optimization?: boolean;
  optimizationRuns?: number;
  licenseType: string;
  constructorArguments: string;
  libraryList?: {
    [libraryFileName: string]: {
      [libraryName: string]: string;
    };
  };
}): OklinkVerifyRequest {
  return {
    apiKey: params.apiKey,
    sourceName: params.sourceName,
    sources: params.sources,
    contractAddress: params.contractAddress,
    compilerVersion: params.compilerVersion,
    evmVersion: params.evmVersion,
    optimization: params.optimization,
    optimizationRuns: params.optimizationRuns,
    licenseType: params.licenseType,
    contractAbi: params.constructorArguments,
    libraryList: params.libraryList,
    compilerType: "Solidity(MultipartFiles)",
  };
}
