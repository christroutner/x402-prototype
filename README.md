# x402-prototype

This is a disposable code repository. It's purpose is to help me learn the client and server
interaction of the x402 protocol.

## 01-soverign-base-sepolia

This example combines the x402 examples from Coinbase with [this fork of x402-soverign](https://github.com/christroutner/x402-sovereign), to run an Express server and interact with it using an Axios client to pay for endpoint access with USDC on the Base Sepolia network. x402-soverign fork allows me to run my own facilitator, without any dependence on Coinbase.

## 02-soverign-base-middleware

This is a copy of the 01 example. However, the x402 middleware wrappers for Express and Axios are removed and replaced with local code to replace that middleware. This will allow me to hack that middleware and add handlers for working with BCH payments.


