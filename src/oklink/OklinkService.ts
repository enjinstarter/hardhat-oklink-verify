import { Blob } from "buffer";
import path from "path";

import { NomicLabsHardhatPluginError } from "hardhat/plugins";
import { Dispatcher, FormData } from "undici";

import { pluginName } from "../constants";

import { OklinkVerifyRequest } from "./OklinkVerifyContractRequest";

export async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function verifyContract(
  url: string,
  req: OklinkVerifyRequest
): Promise<OklinkResponse> {
  const { request } = await import("undici");
  const method: Dispatcher.HttpMethod = "POST";

  let licenseType = "UNLICENSED";
  if (req.sources[req.sourceName] !== undefined) {
    const matches = req.sources[req.sourceName].content.match(
      /^\/\/\s+SPDX-License-Identifier:\s+([A-Za-z0-9.-]+)$/im
    );

    /*
    if (matches !== null) {
      console.log(`matches.length: ${matches.length}`);

      for (let i = 0; i < matches.length; i++) {
        console.log(`matches[${i}]: ${matches[i]}`);
      }
    }
    */

    if (matches !== null && matches.length > 1) {
      licenseType = matches[1];

      /*
      console.log(
        `matches.length=${matches.length}, licenseType=${licenseType}`
      );
      */
    }
  }

  // console.log(`req.licenseType=${req.licenseType}, licenseType=${licenseType}`);

  const body = new FormData();
  for (const [sourceName, _source] of Object.entries(req.sources)) {
    /*
    console.log(
      `files: sourceName=${sourceName}, basename=${path.posix.basename(
        sourceName
      )}, content=${req.sources[sourceName].content}`
    );
    */

    const contentImportAddCurrentDirectory = req.sources[sourceName].content
      .replace(/^import\s+"\//gm, 'import "./')
      .replace(/^import\s+"(?!\.\/)/gm, 'import "./');

    /*
    console.log(
      `files: contentImportAddCurrentDirectory=${contentImportAddCurrentDirectory}`
    );
    */

    body.append(
      "files",
      new Blob([contentImportAddCurrentDirectory]),
      path.posix.basename(sourceName)
    );
  }

  /*
  console.log(`url: ${url}`);
  console.log(`apkKey: ${req.apiKey}`);
  console.log(`sourceName: ${req.sourceName}`);
  console.log(`contractAddress: ${req.contractAddress}`);
  console.log(`compilerVersion: ${req.compilerVersion}`);
  console.log(`evmVersion: ${req.evmVersion}`);
  console.log(
    `optimization: ${
      req.optimization === undefined ? "N.A." : req.optimization.toString()
    }`
  );
  console.log(
    `optimizationRuns: ${
      req.optimizationRuns === undefined
        ? "N.A."
        : req.optimizationRuns.toString()
    }`
  );
  console.log(
    `licenseType: ${
      req.licenseType === null || req.licenseType.trim() === ""
        ? licenseType
        : req.licenseType
    }`
  );
  console.log(`contractAbi: ${req.contractAbi}`);
  console.log(`compilerType: ${req.compilerType}`);
  */

  body.set("contractAddress", req.contractAddress);
  body.set("compilerVersion", req.compilerVersion);
  body.set("evmVersion", req.evmVersion);
  if (req.optimization !== undefined) {
    body.set("optimization", req.optimization);
  }
  if (req.optimizationRuns !== undefined) {
    body.set("optimizationRuns", req.optimizationRuns);
  }
  body.set(
    "licenseType",
    req.licenseType === null || req.licenseType.trim() === ""
      ? licenseType
      : req.licenseType
  );
  body.set("contractAbi", req.contractAbi);
  if (req.libraryList !== undefined) {
    // console.log(`req.libraryList: ${JSON.stringify(req.libraryList)}`);

    const libraryList: Array<{ address: string; name: string }> = [];

    for (const [_libraryFileName, libraryInfo] of Object.entries(
      req.libraryList
    )) {
      for (const [libraryName, libraryAddress] of Object.entries(libraryInfo)) {
        /*
        console.log(
          `libraryList[]: libraryName=${libraryName}, libraryAddress=${libraryAddress}`
        );
        */
        libraryList.push({ address: libraryAddress, name: libraryName });
      }
    }

    if (libraryList.length > 0) {
      // console.log(`libraryList: ${JSON.stringify(libraryList)}`);
      body.set("libraryList", JSON.stringify(libraryList));
    }
  }
  body.set("compilerType", req.compilerType);

  const requestDetails = {
    method,
    headers: { "x-apiKey": req.apiKey },
    body,
  };

  let response: Dispatcher.ResponseData;
  try {
    response = await request(url, requestDetails);
  } catch (error: any) {
    throw new NomicLabsHardhatPluginError(
      pluginName,
      `Failed to send contract verification request.
Endpoint URL: ${url}
Reason: ${error.message}`,
      error
    );
  }

  if (!(response.statusCode >= 200 && response.statusCode <= 299)) {
    // This could be always interpreted as JSON if there were any such guarantee in the OKLink API.
    const responseText = await response.body.text();
    throw new NomicLabsHardhatPluginError(
      pluginName,
      `Failed to send contract verification request.
Endpoint URL: ${url}
The HTTP server response is not ok. Status code: ${response.statusCode} Response text: ${responseText}`
    );
  }

  const responseBody = await response.body.json();
  // console.log(`response: ${JSON.stringify(responseBody)}`);
  const oklinkResponse = new OklinkResponse(responseBody);

  if (oklinkResponse.isBytecodeMissingInNetworkError()) {
    throw new NomicLabsHardhatPluginError(
      pluginName,
      `Failed to send contract verification request.
Endpoint URL: ${url}
Reason: The OKLink API responded that the address ${req.contractAddress} does not have bytecode.
This can happen if the contract was recently deployed and this fact hasn't propagated to the backend yet.
Try waiting for a minute before verifying your contract. If you are invoking this from a script,
try to wait for five confirmations of your contract deployment transaction before running the verification subtask.`
    );
  }

  if (!oklinkResponse.isOk()) {
    throw new NomicLabsHardhatPluginError(
      pluginName,
      `The OKLink API responded with a failure status.
The verification may still succeed but should be checked manually.
Reason: ${oklinkResponse.errorType}`
    );
  }

  return oklinkResponse;
}

export class OklinkResponse {
  public readonly code: number;
  public readonly msg: string;
  public readonly detailMsg: string;
  public readonly isSuccess: boolean;
  public readonly contractAddress?: string;
  public readonly contractCreateTxHash?: string;
  public readonly compilerVersion?: string;
  public readonly optimization?: boolean;
  public readonly optimizationRuns?: number;
  public readonly errorType: string;
  public readonly statusCode?: number;
  public readonly compileErrorMessage?: string;
  public readonly contractCreationCode?: string;
  // public readonly contractErrorCodeList?: string;
  // public readonly errorLibrary?: string;

  constructor(response: any) {
    this.code = response.code;
    this.msg = response.msg;
    this.detailMsg = response.detailMsg;
    this.isSuccess = response.data.isSuccess;
    if (response.data.contractAddress !== undefined) {
      this.contractAddress = response.data.contractAddress;
    }
    if (response.data.contractCreateTxHash !== undefined) {
      this.contractCreateTxHash = response.data.contractCreateTxHash;
    }
    if (response.data.compilerVersion !== undefined) {
      this.compilerVersion = response.data.compilerVersion;
    }
    if (response.data.optimization !== undefined) {
      this.optimization = response.data.optimization;
    }
    if (response.data.optimizationRuns !== undefined) {
      this.optimizationRuns = response.data.optimizationRuns;
    }
    this.errorType =
      response.data.errorType === undefined
        ? response.data.isSuccess === true
          ? ""
          : "OKLINK_UNKNOWN_ERROR"
        : response.data.errorType;
    if (response.data.statusCode !== undefined) {
      this.statusCode = response.data.statusCode;
    }
    if (response.data.compileErrorMessage !== undefined) {
      this.compileErrorMessage = response.data.compileErrorMessage;
    }
    if (response.data.contractCreationCode !== undefined) {
      this.contractCreationCode = response.data.contractCreationCode;
    }
    /*
    if (response.data.contractErrorCodeList !== undefined) {
      this.contractErrorCodeList = response.data.contractErrorCodeList;
    }
    if (response.data.errorLibrary !== undefined) {
      this.errorLibrary = response.data.errorLibrary;
    }
    */
  }

  public isPending() {
    return false;
  }

  public isVerificationFailure() {
    return this.isSuccess !== true;
  }

  public isVerificationSuccess() {
    return this.isSuccess === true;
  }

  public isBytecodeMissingInNetworkError() {
    return false;
  }

  public isOk() {
    return true;
  }
}
