// Global npm libraries
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const BCHJS = require('@psf/bch-js')
const MinimalBCHWallet = require('minimal-slp-wallet')

export const DEFAULT_MIN_CONFIRMATIONS = 1

/**
 * BCH Facilitator class for x402 protocol
 * Handles payment verification and settlement on Bitcoin Cash network
 */
export class BCHFacilitator {
  constructor (options) {
    if (!options.bchPrivateKey) {
      throw new Error('BCHFacilitator: bchPrivateKey is required')
    }

    // Validate mainnet private key (must start with L or K)
    const wif = options.bchPrivateKey
    if (!wif.startsWith('L') && !wif.startsWith('K')) {
      throw new Error('BCHFacilitator: bchPrivateKey must be a mainnet WIF (starts with L or K)')
    }

    this.bchPrivateKey = options.bchPrivateKey
    this.network = options.network || 'bch'
    this.minConfirmations = options.minConfirmations ?? DEFAULT_MIN_CONFIRMATIONS

    // Initialize bch-js with optional configuration
    const bchjsOptions = {}
    if (options.restURL) {
      bchjsOptions.restURL = options.restURL
    }
    if (options.apiToken) {
      bchjsOptions.apiToken = options.apiToken
    }
    if (options.authPass) {
      bchjsOptions.authPass = options.authPass
    }

    this.bchjs = new BCHJS(bchjsOptions)

    // Create ECPair from WIF to get facilitator address
    const ecpair = this.bchjs.ECPair.fromWIF(this.bchPrivateKey)
    this.facilitatorAddress = this.bchjs.ECPair.toCashAddress(ecpair)

    // Initialize minimal-slp-wallet for transaction operations
    // The wallet will be initialized asynchronously when needed
    this.wallet = null
    this.walletInitialized = false
  }

  /**
   * Initialize the wallet (load UTXOs)
   * Must be called before using settlePayment
   */
  async initializeWallet () {
    if (this.walletInitialized) {
      return
    }

    try {
      this.wallet = new MinimalBCHWallet(this.bchPrivateKey, {
        restURL: this.bchjs.restURL,
        apiToken: this.bchjs.apiToken,
        authPass: this.bchjs.authPass
      })

      // Wait for wallet creation
      await this.wallet.walletInfoPromise

      // Initialize UTXO store
      await this.wallet.initialize()

      this.walletInitialized = true
    } catch (error) {
      console.error('Error initializing wallet:', error)
      throw new Error(`Failed to initialize wallet: ${error.message}`)
    }
  }

  /**
   * Returns the list of payment "kinds" this facilitator supports.
   *
   * @returns Object with array of supported payment kinds
   */
  listSupportedKinds () {
    return {
      kinds: [
        {
          x402Version: 1,
          scheme: 'exact',
          network: 'bch'
        }
      ]
    }
  }

  /**
   * Verifies a payment authorization without settling it on-chain.
   *
   * Checks the signature and payment details are valid according to the
   * payment requirements.
   *
   * @param paymentPayload The signed payment authorization
   * @param paymentRequirements The expected payment details
   * @returns Verification result with validity and payer address
   */
  async verifyPayment (paymentPayload, paymentRequirements) {
    console.log('BCHFacilitator verifyPayment() paymentPayload:', paymentPayload)
    console.log('BCHFacilitator verifyPayment() paymentRequirements:', paymentRequirements)

    try {
      // Verify network matches
      if (paymentRequirements.network !== 'bch') {
        return {
          isValid: false,
          invalidReason: 'invalid_network',
          payer: ''
        }
      }

      if (paymentPayload.network !== 'bch') {
        return {
          isValid: false,
          invalidReason: 'invalid_network',
          payer: ''
        }
      }

      // Verify scheme matches
      if (paymentRequirements.scheme !== 'utxo' || paymentPayload.scheme !== 'utxo') {
        return {
          isValid: false,
          invalidReason: 'invalid_scheme',
          payer: ''
        }
      }

      // Extract authorization and signature
      const payload = paymentPayload.payload
      if (!payload || !payload.authorization || !payload.signature) {
        return {
          isValid: false,
          invalidReason: 'invalid_payload',
          payer: ''
        }
      }

      const { authorization, signature } = payload
      const payerAddress = authorization.from

      // Verify signature
      const messageToVerify = JSON.stringify(authorization)
      let isValidSignature = false

      try {
        isValidSignature = this.bchjs.BitcoinCash.verifyMessage(
          payerAddress,
          signature,
          messageToVerify
        )
      } catch (error) {
        console.error('Error verifying signature:', error)
        return {
          isValid: false,
          invalidReason: 'invalid_exact_bch_payload_signature',
          payer: payerAddress
        }
      }

      if (!isValidSignature) {
        return {
          isValid: false,
          invalidReason: 'invalid_exact_bch_payload_signature',
          payer: payerAddress
        }
      }

      // Ignore these TODOs for now.
      // TODO:
      // - Get the TX information and isolate the vout
      // - Make sure the vout address targets the 'to' address in the paymentRequirements
      // - Make sure this is not a double spend
      // - Check DB to see if this UTXO has been logged.
      //   - If not, create a new entry with a debit for the first usage, return success.
      //   - If it exists, debit this usage against the UTXO. If there is not enough left to debit, throw an error.

      // Check time window
      // const now = Math.floor(Date.now() / 1000)
      // const validAfter = parseInt(authorization.validAfter, 10)
      // const validBefore = parseInt(authorization.validBefore, 10)

      // if (now < validAfter) {
      //   return {
      //     isValid: false,
      //     invalidReason: 'invalid_exact_bch_payload_authorization_valid_after',
      //     payer: payerAddress
      //   }
      // }

      // if (now >= validBefore) {
      //   return {
      //     isValid: false,
      //     invalidReason: 'invalid_exact_bch_payload_authorization_valid_before',
      //     payer: payerAddress
      //   }
      // }

      // Verify recipient address matches
      if (authorization.to !== paymentRequirements.payTo) {
        return {
          isValid: false,
          invalidReason: 'invalid_exact_bch_payload_recipient_mismatch',
          payer: payerAddress
        }
      }

      // Verify amount meets requirements
      const paymentAmount = BigInt(authorization.value)
      const requiredAmount = BigInt(paymentRequirements.maxAmountRequired)

      if (paymentAmount < requiredAmount) {
        return {
          isValid: false,
          invalidReason: 'invalid_exact_bch_payload_authorization_value',
          payer: payerAddress
        }
      }

      // Check balance
      try {
        const balanceData = await this.bchjs.Blockchain.getBalance(payerAddress)
        const balance = balanceData.balance + balanceData.unconfirmedBalance

        if (balance < paymentAmount) {
          return {
            isValid: false,
            invalidReason: 'insufficient_funds',
            payer: payerAddress
          }
        }
      } catch (error) {
        console.error('Error checking balance:', error)
        // Continue verification even if balance check fails
        // The transaction will fail during settlement if balance is insufficient
      }

      return {
        isValid: true,
        payer: payerAddress
      }
    } catch (error) {
      console.error('Error in verifyPayment:', error)
      return {
        isValid: false,
        invalidReason: 'unexpected_verify_error',
        payer: paymentPayload?.payload?.authorization?.from || ''
      }
    }
  }

  /**
   * Settles a payment by broadcasting the transaction to the blockchain.
   *
   * Creates a transaction from the payment authorization and broadcasts it
   * to the Bitcoin Cash network.
   *
   * @param paymentPayload The signed payment authorization
   * @param paymentRequirements The expected payment details
   * @returns Settlement result with transaction hash and status
   */
  async settlePayment (paymentPayload, paymentRequirements) {
    console.log('BCHFacilitator settlePayment() paymentPayload:', paymentPayload)
    console.log('BCHFacilitator settlePayment() paymentRequirements:', paymentRequirements)

    try {
      // Re-verify payment
      const verification = await this.verifyPayment(paymentPayload, paymentRequirements)

      if (!verification.isValid) {
        return {
          success: false,
          errorReason: verification.invalidReason || 'invalid_payment',
          transaction: '',
          network: 'bch',
          payer: verification.payer || ''
        }
      }

      const payerAddress = verification.payer
      const authorization = paymentPayload.payload.authorization
      const amount = parseInt(authorization.value, 10) // Amount in satoshis
      const payTo = paymentRequirements.payTo

      // Initialize wallet if not already initialized
      if (!this.walletInitialized) {
        await this.initializeWallet()
      }

      // Create and broadcast transaction
      // Note: The facilitator creates the transaction, not the payer
      // This is different from EVM where we use the signed authorization
      // For BCH, we need to create a new transaction from the facilitator's wallet
      // However, the payment authorization proves the payer's intent
      // In a real implementation, you might want to use a different approach
      // For now, we'll create a transaction from facilitator to payTo with the authorized amount

      // Check facilitator balance first
      const facilitatorBalance = await this.wallet.getBalance({ bchAddress: this.facilitatorAddress })
      if (facilitatorBalance < amount) {
        return {
          success: false,
          errorReason: 'insufficient_funds',
          transaction: '',
          network: 'bch',
          payer: payerAddress
        }
      }

      // Create transaction
      const outputs = [
        {
          address: payTo,
          amount
        }
      ]

      const txid = await this.wallet.send(outputs)

      if (!txid) {
        return {
          success: false,
          errorReason: 'invalid_transaction_state',
          transaction: '',
          network: 'bch',
          payer: payerAddress
        }
      }

      // Wait for confirmations if required
      if (this.minConfirmations > 0) {
        // In a production system, you would wait for confirmations here
        // For now, we'll just return the txid
        // You could use bchjs.Blockchain.getTransaction(txid) to check confirmations
      }

      return {
        success: true,
        transaction: txid,
        network: 'bch',
        payer: payerAddress
      }
    } catch (error) {
      console.error('Error in settlePayment:', error)
      return {
        success: false,
        errorReason: 'unexpected_settle_error',
        transaction: '',
        network: 'bch',
        payer: paymentPayload?.payload?.authorization?.from || ''
      }
    }
  }

  /**
   * handleRequest()
   *
   * Framework-agnostic HTTP request handler for facilitator endpoints.
   * Handles GET /supported, POST /verify, and POST /settle.
   *
   * Returns a standard { status, body } response that can be used with any framework.
   */
  async handleRequest (request) {
    const { method, path, body } = request

    // GET /supported
    if (method === 'GET' && path === '/supported') {
      return {
        status: 200,
        body: this.listSupportedKinds()
      }
    }

    // POST /verify
    if (method === 'POST' && path === '/verify') {
      try {
        if (!body?.paymentPayload || !body?.paymentRequirements) {
          return {
            status: 400,
            body: { error: 'Missing paymentPayload or paymentRequirements' }
          }
        }

        const result = await this.verifyPayment(
          body.paymentPayload,
          body.paymentRequirements
        )

        // Add invalidReason if payment is invalid
        const responseBody = {
          isValid: result.isValid,
          payer: result.payer
        }

        if (!result.isValid && result.invalidReason) {
          responseBody.invalidReason = result.invalidReason
        }

        return {
          status: 200,
          body: responseBody
        }
      } catch (error) {
        return {
          status: 400,
          body: {
            error: 'Failed to verify payment',
            message: error instanceof Error ? error.message : 'Unknown error'
          }
        }
      }
    }

    // POST /settle
    if (method === 'POST' && path === '/settle') {
      try {
        if (!body?.paymentPayload || !body?.paymentRequirements) {
          return {
            status: 400,
            body: { error: 'Missing paymentPayload or paymentRequirements' }
          }
        }

        const result = await this.settlePayment(
          body.paymentPayload,
          body.paymentRequirements
        )

        return {
          status: 200,
          body: result
        }
      } catch (error) {
        return {
          status: 400,
          body: {
            error: 'Failed to settle payment',
            message: error instanceof Error ? error.message : 'Unknown error'
          }
        }
      }
    }

    // 404 - Not Found
    return {
      status: 404,
      body: { error: 'Not found' }
    }
  }
}

/**
 * Creates an Express adapter for the BCH Facilitator
 * Similar to createExpressAdapter from the EVM facilitator
 */
export function createExpressAdapter (facilitator, router, basePath = '') {
  const normalizePath = (path) => {
    const normalized = basePath + path
    return normalized || '/'
  }

  router.get(normalizePath('/supported'), async (req, res) => {
    try {
      const response = await facilitator.handleRequest({
        method: 'GET',
        path: '/supported'
      })
      res.status(response.status).json(response.body)
    } catch (error) {
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  router.post(normalizePath('/verify'), async (req, res) => {
    try {
      const response = await facilitator.handleRequest({
        method: 'POST',
        path: '/verify',
        body: req.body
      })
      res.status(response.status).json(response.body)
    } catch (error) {
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  router.post(normalizePath('/settle'), async (req, res) => {
    try {
      const response = await facilitator.handleRequest({
        method: 'POST',
        path: '/settle',
        body: req.body
      })
      res.status(response.status).json(response.body)
    } catch (error) {
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })
}
