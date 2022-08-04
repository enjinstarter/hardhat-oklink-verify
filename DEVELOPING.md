# hardhat-oklink-verify

## Testing

This package contains a few integration tests that require specific environment variables to work:

- `RUN_OKLINK_TESTS`: Should be set to `"yes"` to run the integration tests.
- `TESTNET_NETWORK_URL`: Should be set to the URL of a testnet OKC node. Deployment transactions will be sent to this node. The chosen testnet should be supported by the OKLink API.
- `WALLET_PRIVATE_KEY`: Should be set to a private key that holds some native tokens in the chosen testnet to pay for gas.
- `OKLINK_API_KEY`: Should be set to a valid OKLink API token key. This token will be used by the plugin when sending requests to the OKLink API.
- `OKLINK_LICENSE_TYPE`: Optional. Should be set if want to overwrite auto-detected license type.