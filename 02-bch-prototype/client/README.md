# x402-bch Client Demo

This directory contains a reference client for the Bitcoin Cash adaptation of the x402 protocol. The client script (`bch-client.js`) exercises the end-to-end flow described in the core [`x402` specification](../../../x402-bch/specs/x402-specification.md) and in the BCH-focused [`x402-bch` specification](../../../x402-bch/specs/x402-bch-specification.md). It showcases how an HTTP consumer can satisfy `402 Payment Required` responses by funding and reusing BCH UTXOs through a Facilitator.

## Where the Client Fits
- **Clients** originate HTTP requests, learn pricing from `402` responses, and present signed BCH payment payloads.
- **Servers** protect API resources, advertise BCH pricing metadata, and forward payment headers for verification.
- **Facilitators** verify signatures, track debit balances for funded UTXOs, and return validation decisions.

This client demonstrates the Client role: it detects `402` responses, funds a BCH UTXO via the helper in `axios-402-handler.js`, signs authorization payloads, and retries the original request until the Facilitator confirms payment.

## Features
- Handles the full BCH `utxo` scheme payload (`signature`, `txid`, `vout`, debit amount) described in the spec.
- Automatically retries requests that receive `402` responses after attaching `X-PAYMENT` headers.
- Reuses ledger balances tracked by the Facilitator until a UTXO is exhausted.
- Uses `minimal-slp-wallet` utilities for BCH key management and transaction introspection.

## Prerequisites
- Node.js 20 LTS or newer (required for ES module compatibility).
- npm 9+ (ships with Node 20).
- Access to an x402-bch Resource Server and Facilitator (see `../../facilitator` and `../../server` directories for demos).

## Installation
```bash
cd /home/trout/work/personal/x402/x402-prototype/02-bch-prototype/client
npm install
```

## Configuration
Create a `.env` file in this directory (or export environment variables) with the following options:

```
PRIVATE_KEY=Base58Check_WIF_private_key   # BCH key that will fund the reusable UTXO
RESOURCE_SERVER_URL=http://localhost:4021 # URL of the x402-enabled resource server
ENDPOINT_PATH=/weather                    # Resource path to call
PAYMENT_AMOUNT_SATS=2000                  # Satoshis to send when funding a new UTXO
```

Defaults are provided in `bch-client.js` for quick local testing, but a funded BCH key is required for real payments.

## Running the Demo
```bash
npm start
```

The script performs three steps:
1. Requests the resource without payment to trigger an HTTP `402` and log the advertised `PaymentRequirements`.
2. Funds a BCH UTXO, signs the authorization payload, retries the request, and logs the successful response once the Facilitator validates the payment.
3. Issues a follow-up request that reuses the same UTXO balance until it is depleted.

Facilitator responses (such as remaining satoshis) are visible in the console output. You can adjust `PAYMENT_AMOUNT_SATS` to experiment with batching multiple paid calls.

## Related Components
- `axios-402-handler.js`: Wraps Axios with interceptors that detect `402` responses, build BCH payment payloads, and manage retries.
- `../../facilitator`: Reference Facilitator service that verifies BCH payment payloads and maintains UTXO ledgers.
- `../../server`: Example resource server that publishes BCH pricing metadata and delegates verification to the Facilitator.

## Troubleshooting
- **402 loops**: Ensure the private key was funded and that the Facilitator recognizes the `payTo` address advertised by the server.
- **Signature errors**: Verify the `PRIVATE_KEY` matches the `from` address and that your environment uses UTF-8 encoding.
- **Network mismatches**: Confirm the server and client are both set to use the `bch` network and the `utxo` scheme.

For full protocol details, consult `../../../x402-bch/specs/x402-bch-specification.md`.

## Future Work

- `axios-402-handler.js` will be abstracted and packaged into it's own library, similar to [x402-axios](https://www.npmjs.com/package/x402-axios).
- Unit tests will be added for this example