import {
  TASK_COMPILE,
  TASK_COMPILE_SOLIDITY_COMPILE_JOB,
  TASK_COMPILE_SOLIDITY_GET_COMPILATION_JOB_FOR_FILE,
  TASK_COMPILE_SOLIDITY_GET_DEPENDENCY_GRAPH,
} from "hardhat/builtin-tasks/task-names";
import { extendConfig, subtask, task, types } from "hardhat/config";
import { NomicLabsHardhatPluginError } from "hardhat/plugins";
import {
  ActionType,
  Artifacts,
  CompilationJob,
  CompilerInput,
  CompilerOutput,
  DependencyGraph,
  Network,
} from "hardhat/types";
import {
  isFullyQualifiedName,
  parseFullyQualifiedName,
} from "hardhat/utils/contract-names";
import path from "path";
import semver from "semver";

import { encodeArguments } from "./ABIEncoder";
import { oklinkConfigExtender, verifyAllowedChains } from "./config";
import {
  pluginName,
  TASK_VERIFY,
  TASK_VERIFY_GET_COMPILER_VERSIONS,
  TASK_VERIFY_GET_CONSTRUCTOR_ARGUMENTS,
  TASK_VERIFY_GET_CONTRACT_INFORMATION,
  TASK_VERIFY_GET_OKLINK_ENDPOINT,
  TASK_VERIFY_GET_LIBRARIES,
  TASK_VERIFY_GET_MINIMUM_BUILD,
  TASK_VERIFY_VERIFY,
  TASK_VERIFY_VERIFY_MINIMUM_BUILD,
} from "./constants";
import { verifyContract } from "./oklink/OklinkService";
import { toVerifyRequest } from "./oklink/OklinkVerifyContractRequest";
import { chainConfig } from "./ChainConfig";
import { getOklinkEndpoints, retrieveContractBytecode } from "./network/prober";
import { resolveOklinkApiKey } from "./resolveOklinkApiKey";
import {
  Bytecode,
  ContractInformation,
  extractMatchingContractInformation,
  lookupMatchingBytecode,
} from "./solc/bytecode";
import { getLibraryLinks, Libraries, LibraryNames } from "./solc/libraries";
import {
  METADATA_ABSENT_VERSION_RANGE,
  METADATA_PRESENT_SOLC_NOT_FOUND_VERSION_RANGE,
} from "./solc/metadata";
import { getLongVersion } from "./solc/version";
import "./type-extensions";
import { OklinkNetworkEntry, OklinkURLs } from "./types";
import { buildContractUrl, printSupportedNetworks } from "./util";

interface VerificationArgs {
  address?: string;
  // constructor args given as positional params
  constructorArgsParams: string[];
  // Filename of constructor arguments module
  constructorArgs?: string;
  // Fully qualified name of the contract
  contract?: string;
  // Filename of libraries module
  libraries?: string;

  // --list-networks flag
  listNetworks: boolean;
}

interface VerificationSubtaskArgs {
  address: string;
  constructorArguments: any[];
  // Fully qualified name of the contract
  contract?: string;
  libraries: Libraries;
}

interface Build {
  compilationJob: CompilationJob;
  input: CompilerInput;
  output: CompilerOutput;
  solcBuild: any;
}

interface MinimumBuildArgs {
  sourceName: string;
}

interface GetContractInformationArgs {
  contractFQN: string;
  deployedBytecode: Bytecode;
  matchingCompilerVersions: string[];
  libraries: Libraries;
}

interface VerifyMinimumBuildArgs {
  minimumBuild: Build;
  contractInformation: ContractInformation;
  oklinkAPIEndpoints: OklinkURLs;
  address: string;
  oklinkAPIKey: string;
  solcFullVersion: string;
  deployArgumentsEncoded: string;
  oklinkLicenseType?: string;
}

interface LibraryInformation {
  undetectableLibraries: LibraryNames;
}

type ExtendedContractInformation = ContractInformation & LibraryInformation;

extendConfig(oklinkConfigExtender);

const verify: ActionType<VerificationArgs> = async (
  {
    address,
    constructorArgsParams,
    constructorArgs: constructorArgsModule,
    contract,
    libraries: librariesModule,
    listNetworks,
  },
  { config, run }
) => {
  if (listNetworks) {
    await printSupportedNetworks(config.oklink.customChains);
    return;
  }

  if (address === undefined) {
    throw new NomicLabsHardhatPluginError(
      pluginName,
      "You didn’t provide any address. Please re-run the 'oklink-verify' task with the address of the contract you want to verify."
    );
  }

  verifyAllowedChains(config.oklink);

  const constructorArguments: any[] = await run(
    TASK_VERIFY_GET_CONSTRUCTOR_ARGUMENTS,
    {
      constructorArgsModule,
      constructorArgsParams,
    }
  );

  const libraries: Libraries = await run(TASK_VERIFY_GET_LIBRARIES, {
    librariesModule,
  });

  return run(TASK_VERIFY_VERIFY, {
    address,
    constructorArguments,
    contract,
    libraries,
  });
};

const verifySubtask: ActionType<VerificationSubtaskArgs> = async (
  { address, constructorArguments, contract: contractFQN, libraries },
  { config, network, run }
) => {
  const { oklink } = config;

  const { isAddress } = await import("@ethersproject/address");
  if (!isAddress(address)) {
    throw new NomicLabsHardhatPluginError(
      pluginName,
      `${address} is an invalid address.`
    );
  }

  // This can only happen if the subtask is invoked from within Hardhat by a user script or another task.
  if (!Array.isArray(constructorArguments)) {
    throw new NomicLabsHardhatPluginError(
      pluginName,
      `The constructorArguments parameter should be an array.
If your constructor has no arguments pass an empty array. E.g:

  await run("${TASK_VERIFY_VERIFY}", {
    <other args>,
    constructorArguments: []
  };`
    );
  }

  const compilerVersions: string[] = await run(
    TASK_VERIFY_GET_COMPILER_VERSIONS
  );

  const {
    network: verificationNetwork,
    urls: oklinkAPIEndpoints,
  }: OklinkNetworkEntry = await run(TASK_VERIFY_GET_OKLINK_ENDPOINT);

  const oklinkAPIKey = resolveOklinkApiKey(oklink.apiKey, verificationNetwork);

  const deployedBytecodeHex = await retrieveContractBytecode(
    address,
    network.provider,
    network.name
  );

  const deployedBytecode = new Bytecode(deployedBytecodeHex);
  const inferredSolcVersion = deployedBytecode.getInferredSolcVersion();

  const matchingCompilerVersions = compilerVersions.filter((version) => {
    return semver.satisfies(version, inferredSolcVersion);
  });
  if (
    matchingCompilerVersions.length === 0 &&
    // don't error if the bytecode appears to be OVM bytecode, because we can't infer a specific OVM solc version from the bytecode
    !deployedBytecode.isOvmInferred()
  ) {
    let configuredCompilersFragment;
    if (compilerVersions.length > 1) {
      configuredCompilersFragment = `your configured compiler versions are: ${compilerVersions.join(
        ", "
      )}`;
    } else {
      configuredCompilersFragment = `your configured compiler version is: ${compilerVersions[0]}`;
    }
    const message = `The contract you want to verify was compiled with solidity ${inferredSolcVersion}, but ${configuredCompilersFragment}.

Possible causes are:
  - You are not in the same commit that was used to deploy the contract.
  - Wrong compiler version selected in hardhat config.
  - The given address is wrong.
  - The selected network (${network.name}) is wrong.`;
    throw new NomicLabsHardhatPluginError(pluginName, message);
  }

  // Make sure that contract artifacts are up-to-date.
  await run(TASK_COMPILE);

  const contractInformation: ExtendedContractInformation = await run(
    TASK_VERIFY_GET_CONTRACT_INFORMATION,
    {
      contractFQN,
      deployedBytecode,
      matchingCompilerVersions,
      libraries,
    }
  );

  // Override solc version based on hardhat config if verifying for the OVM. This is used instead of fetching the
  // full version name from a solc bin JSON file (as is done for EVM solc in src/solc/version.ts) because it's
  // simpler and avoids a network request we don't need. This is ok because the solc version specified in the OVM
  // config always equals the full solc version
  if (deployedBytecode.isOvmInferred()) {
    // We cast to this custom type here instead of using `extendConfig` to avoid always mutating the HardhatConfig
    // type. We don't want that type to always contain the `ovm` field, because users only using hardhat-oklink-verify
    // without the Optimism plugin should not have that field in their type definitions
    const configCopy = { ...config } as unknown as {
      ovm?: { solcVersion?: string };
    };
    const ovmSolcVersion = configCopy.ovm?.solcVersion;
    if (ovmSolcVersion === undefined) {
      const message = `It looks like you are verifying an OVM contract, but do not have an OVM solcVersion specified in the hardhat config.`;
      throw new NomicLabsHardhatPluginError(pluginName, message);
    }
    contractInformation.solcVersion = `v${ovmSolcVersion}`; // OKLink requires the leading `v` before the version string
  }

  const deployArgumentsEncoded = await encodeArguments(
    contractInformation.contract.abi,
    contractInformation.sourceName,
    contractInformation.contractName,
    constructorArguments
  );

  // If OVM, the full version string was already read from the hardhat config. If solc, get the full version string
  const solcFullVersion = deployedBytecode.isOvmInferred()
    ? contractInformation.solcVersion
    : await getLongVersion(contractInformation.solcVersion);

  const minimumBuild: Build = await run(TASK_VERIFY_GET_MINIMUM_BUILD, {
    sourceName: contractInformation.sourceName,
  });

  const success: boolean = await run(TASK_VERIFY_VERIFY_MINIMUM_BUILD, {
    minimumBuild,
    contractInformation,
    oklinkAPIEndpoints,
    address,
    oklinkAPIKey,
    solcFullVersion,
    deployArgumentsEncoded,
    oklinkLicenseType: oklink.licenseType,
  });

  if (success) {
    return;
  }

  let errorMessage = `The contract verification failed.`;
  if (contractInformation.undetectableLibraries.length > 0) {
    const undetectableLibraryNames = contractInformation.undetectableLibraries
      .map(({ sourceName, libName }) => `${sourceName}:${libName}`)
      .map((x) => `  * ${x}`)
      .join("\n");
    errorMessage += `
This contract makes use of libraries whose addresses are undetectable by the plugin.
Keep in mind that this verification failure may be due to passing in the wrong
address for one of these libraries:
${undetectableLibraryNames}`;
  }
  throw new NomicLabsHardhatPluginError(pluginName, errorMessage);
};

subtask(TASK_VERIFY_GET_CONSTRUCTOR_ARGUMENTS)
  .addParam("constructorArgsParams", undefined, undefined, types.any)
  .addOptionalParam(
    "constructorArgsModule",
    undefined,
    undefined,
    types.inputFile
  )
  .setAction(
    async ({
      constructorArgsModule,
      constructorArgsParams,
    }: {
      constructorArgsModule?: string;
      constructorArgsParams: string[];
    }) => {
      if (typeof constructorArgsModule !== "string") {
        return constructorArgsParams;
      }

      const constructorArgsModulePath = path.resolve(
        process.cwd(),
        constructorArgsModule
      );

      try {
        const constructorArguments = (await import(constructorArgsModulePath))
          .default;

        if (!Array.isArray(constructorArguments)) {
          throw new NomicLabsHardhatPluginError(
            pluginName,
            `The module ${constructorArgsModulePath} doesn't export a list. The module should look like this:

  module.exports = [ arg1, arg2, ... ];`
          );
        }

        return constructorArguments;
      } catch (error: any) {
        throw new NomicLabsHardhatPluginError(
          pluginName,
          `Importing the module for the constructor arguments list failed.
Reason: ${error.message}`,
          error
        );
      }
    }
  );

subtask(TASK_VERIFY_GET_LIBRARIES)
  .addOptionalParam("librariesModule", undefined, undefined, types.inputFile)
  .setAction(
    async ({
      librariesModule,
    }: {
      librariesModule?: string;
    }): Promise<Libraries> => {
      if (typeof librariesModule !== "string") {
        return {};
      }

      const librariesModulePath = path.resolve(process.cwd(), librariesModule);

      try {
        const libraries = (await import(librariesModulePath)).default;

        if (typeof libraries !== "object" || Array.isArray(libraries)) {
          throw new NomicLabsHardhatPluginError(
            pluginName,
            `The module ${librariesModulePath} doesn't export a dictionary. The module should look like this:

  module.exports = { lib1: "0x...", lib2: "0x...", ... };`
          );
        }

        return libraries;
      } catch (error: any) {
        throw new NomicLabsHardhatPluginError(
          pluginName,
          `Importing the module for the libraries dictionary failed.
Reason: ${error.message}`,
          error
        );
      }
    }
  );

async function attemptVerification(
  oklinkAPIEndpoints: OklinkURLs,
  contractInformation: ContractInformation,
  contractAddress: string,
  oklinkAPIKey: string,
  compilerInput: CompilerInput,
  solcFullVersion: string,
  deployArgumentsEncoded: string,
  oklinkLicenseType?: string
) {
  /*
  console.log(
    `oklinkLicenseType: ${
      oklinkLicenseType === undefined ? "undefined" : oklinkLicenseType
    }`
  );
  */

  // Ensure the linking information is present in the compiler input;
  compilerInput.settings.libraries = contractInformation.libraryLinks;
  const request = toVerifyRequest({
    apiKey: oklinkAPIKey,
    sourceName: contractInformation.sourceName,
    sources: compilerInput.sources,
    contractAddress,
    compilerVersion: solcFullVersion,
    evmVersion:
      compilerInput.settings.evmVersion === undefined ||
      compilerInput.settings.evmVersion === null ||
      compilerInput.settings.evmVersion.trim() === ""
        ? "default"
        : compilerInput.settings.evmVersion,
    optimization: compilerInput.settings.optimizer.enabled,
    optimizationRuns: compilerInput.settings.optimizer.runs,
    licenseType:
      oklinkLicenseType === undefined ||
      oklinkLicenseType === null ||
      oklinkLicenseType.trim() === ""
        ? ""
        : oklinkLicenseType.trim(),
    constructorArguments: deployArgumentsEncoded,
    libraryList: compilerInput.settings.libraries,
  });
  const response = await verifyContract(oklinkAPIEndpoints.apiURL, request);

  console.log(
    `Successfully submitted source code for contract
${contractInformation.sourceName}:${contractInformation.contractName} at ${contractAddress}
for verification on the block explorer. Waiting for verification result...
`
  );

  if (response.isVerificationFailure() || response.isVerificationSuccess()) {
    return response;
  }

  // Reaching this point shouldn't be possible unless the API is behaving in a new way.
  throw new NomicLabsHardhatPluginError(
    pluginName,
    `The API responded with an unexpected message.
Contract verification may have succeeded and should be checked manually.
Message: ${response.errorType}`,
    undefined,
    true
  );
}

const getMinimumBuild: ActionType<MinimumBuildArgs> = async function (
  { sourceName },
  { run }
): Promise<Build> {
  const dependencyGraph: DependencyGraph = await run(
    TASK_COMPILE_SOLIDITY_GET_DEPENDENCY_GRAPH,
    { sourceNames: [sourceName] }
  );

  const resolvedFiles = dependencyGraph
    .getResolvedFiles()
    .filter((resolvedFile) => {
      return resolvedFile.sourceName === sourceName;
    });
  assertHardhatPluginInvariant(
    resolvedFiles.length === 1,
    `The plugin found an unexpected number of files for this contract.`
  );

  const compilationJob: CompilationJob = await run(
    TASK_COMPILE_SOLIDITY_GET_COMPILATION_JOB_FOR_FILE,
    {
      dependencyGraph,
      file: resolvedFiles[0],
    }
  );

  const build: Build = await run(TASK_COMPILE_SOLIDITY_COMPILE_JOB, {
    compilationJob,
    compilationJobs: [compilationJob],
    compilationJobIndex: 0,
    emitsArtifacts: false,
    quiet: true,
  });

  return build;
};

async function inferContract(
  artifacts: Artifacts,
  network: Network,
  matchingCompilerVersions: string[],
  deployedBytecode: Bytecode
) {
  const contractMatches = await lookupMatchingBytecode(
    artifacts,
    matchingCompilerVersions,
    deployedBytecode
  );
  if (contractMatches.length === 0) {
    const message = `The address provided as argument contains a contract, but its bytecode doesn't match any of your local contracts.

Possible causes are:
  - Contract code changed after the deployment was executed. This includes code for seemingly unrelated contracts.
  - A solidity file was added, moved, deleted or renamed after the deployment was executed. This includes files for seemingly unrelated contracts.
  - Solidity compiler settings were modified after the deployment was executed (like the optimizer, target EVM, etc.).
  - The given address is wrong.
  - The selected network (${network.name}) is wrong.`;
    throw new NomicLabsHardhatPluginError(pluginName, message);
  }
  if (contractMatches.length > 1) {
    const nameList = contractMatches
      .map((contract) => {
        return `${contract.sourceName}:${contract.contractName}`;
      })
      .map((fqName) => `  * ${fqName}`)
      .join("\n");
    const message = `More than one contract was found to match the deployed bytecode.
Please use the contract parameter with one of the following contracts:
${nameList}

For example:

  hardhat oklink-verify --contract contracts/Example.sol:ExampleContract <other args>

If you are running the verify subtask from within Hardhat instead:

  await run("${TASK_VERIFY_VERIFY}", {
    <other args>,
    contract: "contracts/Example.sol:ExampleContract"
  };`;
    throw new NomicLabsHardhatPluginError(pluginName, message, undefined, true);
  }
  return contractMatches[0];
}

subtask(TASK_VERIFY_GET_COMPILER_VERSIONS).setAction(
  async (_, { config }): Promise<string[]> => {
    const compilerVersions = config.solidity.compilers.map((c) => c.version);
    if (config.solidity.overrides !== undefined) {
      for (const { version } of Object.values(config.solidity.overrides)) {
        compilerVersions.push(version);
      }
    }

    // OKLink only supports solidity versions higher than or equal to v0.4.12.
    // See https://www.oklink.com/en/okc/verify-contract-preliminary
    const supportedSolcVersionRange = ">=0.4.12";
    if (
      compilerVersions.some((version) => {
        return !semver.satisfies(version, supportedSolcVersionRange);
      })
    ) {
      throw new NomicLabsHardhatPluginError(
        pluginName,
        `OKLink only supports compiler versions 0.4.12 and higher.
See https://www.oklink.com/en/okc/verify-contract-preliminary for more information.`
      );
    }

    return compilerVersions;
  }
);

subtask(TASK_VERIFY_GET_OKLINK_ENDPOINT).setAction(
  async (_, { config, network }) =>
    getOklinkEndpoints(
      network.provider,
      network.name,
      chainConfig,
      config.oklink.customChains
    )
);

subtask(TASK_VERIFY_GET_CONTRACT_INFORMATION)
  .addParam("deployedBytecode", undefined, undefined, types.any)
  .addParam("matchingCompilerVersions", undefined, undefined, types.any)
  .addParam("libraries", undefined, undefined, types.any)
  .addOptionalParam("contractFQN", undefined, undefined, types.string)
  .setAction(
    async (
      {
        contractFQN,
        deployedBytecode,
        matchingCompilerVersions,
        libraries,
      }: GetContractInformationArgs,
      { network, artifacts }
    ): Promise<ExtendedContractInformation> => {
      let contractInformation;
      if (contractFQN !== undefined) {
        // Check this particular contract
        if (!isFullyQualifiedName(contractFQN)) {
          throw new NomicLabsHardhatPluginError(
            pluginName,
            `A valid fully qualified name was expected. Fully qualified names look like this: "contracts/AContract.sol:TheContract"
Instead, this name was received: ${contractFQN}`
          );
        }

        if (!(await artifacts.artifactExists(contractFQN))) {
          throw new NomicLabsHardhatPluginError(
            pluginName,
            `The contract ${contractFQN} is not present in your project.`
          );
        }

        // Process BuildInfo here to check version and throw an error if unexpected version is found.
        const buildInfo = await artifacts.getBuildInfo(contractFQN);

        if (buildInfo === undefined) {
          throw new NomicLabsHardhatPluginError(
            pluginName,
            `The contract ${contractFQN} is present in your project, but we couldn't find its sources.
Please make sure that it has been compiled by Hardhat and that it is written in Solidity.`
          );
        }

        if (
          !matchingCompilerVersions.includes(buildInfo.solcVersion) &&
          !deployedBytecode.isOvmInferred()
        ) {
          const inferredSolcVersion = deployedBytecode.getInferredSolcVersion();
          let versionDetails;
          if (isVersionRange(inferredSolcVersion)) {
            versionDetails = `a solidity version in the range ${inferredSolcVersion}`;
          } else {
            versionDetails = `the solidity version ${inferredSolcVersion}`;
          }

          throw new NomicLabsHardhatPluginError(
            pluginName,
            `The contract ${contractFQN} is being compiled with ${buildInfo.solcVersion}.
However, the contract found in the address provided as argument has its bytecode marked with ${versionDetails}.

Possible causes are:
  - Solidity compiler version settings were modified after the deployment was executed.
  - The given address is wrong.
  - The selected network (${network.name}) is wrong.`
          );
        }

        const { sourceName, contractName } =
          parseFullyQualifiedName(contractFQN);
        contractInformation = await extractMatchingContractInformation(
          sourceName,
          contractName,
          buildInfo,
          deployedBytecode
        );

        if (contractInformation === null) {
          throw new NomicLabsHardhatPluginError(
            pluginName,
            `The address provided as argument contains a contract, but its bytecode doesn't match the contract ${contractFQN}.

Possible causes are:
  - Contract code changed after the deployment was executed. This includes code for seemingly unrelated contracts.
  - A solidity file was added, moved, deleted or renamed after the deployment was executed. This includes files for seemingly unrelated contracts.
  - Solidity compiler settings were modified after the deployment was executed (like the optimizer, target EVM, etc.).
  - The given address is wrong.
  - The selected network (${network.name}) is wrong.`
          );
        }
      } else {
        // Infer the contract
        contractInformation = await inferContract(
          artifacts,
          network,
          matchingCompilerVersions,
          deployedBytecode
        );
      }

      const { libraryLinks, undetectableLibraries } = await getLibraryLinks(
        contractInformation,
        libraries
      );
      return {
        ...contractInformation,
        libraryLinks,
        undetectableLibraries,
      };
    }
  );

subtask(TASK_VERIFY_VERIFY_MINIMUM_BUILD)
  .addParam("minimumBuild", undefined, undefined, types.any)
  .addParam("contractInformation", undefined, undefined, types.any)
  .addParam("oklinkAPIEndpoints", undefined, undefined, types.any)
  .addParam("address", undefined, undefined, types.string)
  .addParam("oklinkAPIKey", undefined, undefined, types.string)
  .addParam("solcFullVersion", undefined, undefined, types.string)
  .addParam("deployArgumentsEncoded", undefined, undefined, types.string)
  .addParam("oklinkLicenseType", undefined, undefined, types.string, true)
  .setAction(
    async ({
      minimumBuild,
      contractInformation,
      oklinkAPIEndpoints: oklinkAPIEndpoints,
      address,
      oklinkAPIKey: oklinkAPIKey,
      solcFullVersion,
      deployArgumentsEncoded,
      oklinkLicenseType,
    }: VerifyMinimumBuildArgs): Promise<boolean> => {
      const minimumBuildContractBytecode =
        minimumBuild.output.contracts[contractInformation.sourceName][
          contractInformation.contractName
        ].evm.deployedBytecode.object;

      const matchedBytecode =
        contractInformation.compilerOutput.contracts[
          contractInformation.sourceName
        ][contractInformation.contractName].evm.deployedBytecode.object;

      if (minimumBuildContractBytecode === matchedBytecode) {
        const minimumBuildVerificationStatus = await attemptVerification(
          oklinkAPIEndpoints,
          contractInformation,
          address,
          oklinkAPIKey,
          minimumBuild.input,
          solcFullVersion,
          deployArgumentsEncoded,
          oklinkLicenseType
        );

        if (minimumBuildVerificationStatus.isVerificationSuccess()) {
          const contractURL = buildContractUrl(
            oklinkAPIEndpoints.browserURL,
            address
          );
          console.log(
            `Successfully verified contract ${contractInformation.contractName} on OKLink.
${contractURL}`
          );
          return true;
        }

        console.log(
          `We tried verifying your contract ${contractInformation.contractName} without including any unrelated one, but it failed.`
        );
      } else {
        console.log(
          `Compiling your contract excluding unrelated contracts did not produce identical bytecode.`
        );
      }

      return false;
    }
  );

subtask(TASK_VERIFY_GET_MINIMUM_BUILD)
  .addParam("sourceName", undefined, undefined, types.string)
  .setAction(getMinimumBuild);

task(TASK_VERIFY, "Verifies contract on OKLink")
  .addOptionalPositionalParam(
    "address",
    "Address of the smart contract to verify"
  )
  .addOptionalParam(
    "constructorArgs",
    "File path to a javascript module that exports the list of arguments.",
    undefined,
    types.inputFile
  )
  .addOptionalParam(
    "contract",
    "Fully qualified name of the contract to verify. " +
      "Skips automatic detection of the contract. " +
      "Use if the deployed bytecode matches more than one contract in your project."
  )
  .addOptionalParam(
    "libraries",
    "File path to a javascript module that exports the dictionary of library addresses for your contract. " +
      "Use if there are undetectable library addresses in your contract. " +
      "Library addresses are undetectable if they are only used in the constructor for your contract.",
    undefined,
    types.inputFile
  )
  .addOptionalVariadicPositionalParam(
    "constructorArgsParams",
    "Contract constructor arguments. Ignored if the --constructor-args option is used.",
    []
  )
  .addFlag("listNetworks", "Print the list of supported networks")
  .setAction(verify);

subtask(TASK_VERIFY_VERIFY)
  .addParam("address", undefined, undefined, types.string)
  .addOptionalParam("constructorArguments", undefined, [], types.any)
  .addOptionalParam("contract", undefined, undefined, types.string)
  .addOptionalParam("libraries", undefined, {}, types.any)
  .setAction(verifySubtask);

function assertHardhatPluginInvariant(
  invariant: boolean,
  message: string
): asserts invariant {
  if (!invariant) {
    throw new NomicLabsHardhatPluginError(pluginName, message, undefined, true);
  }
}

function isVersionRange(version: string): boolean {
  return (
    version === METADATA_ABSENT_VERSION_RANGE ||
    version === METADATA_PRESENT_SOLC_NOT_FOUND_VERSION_RANGE
  );
}
