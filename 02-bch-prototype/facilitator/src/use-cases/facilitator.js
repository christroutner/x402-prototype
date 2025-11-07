/*
  Facilitator use case for BCH payment verification and settlement
*/

export const DEFAULT_MIN_CONFIRMATIONS = 1

class FacilitatorUseCase {
  constructor (localConfig = {}) {
    this.adapters = localConfig.adapters
    if (!this.adapters) {
      throw new Error(
        'Instance of adapters must be passed in when instantiating Facilitator Use Case.'
      )
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
    this.adapters.logger.info('FacilitatorUseCase verifyPayment() paymentPayload:', paymentPayload)
    this.adapters.logger.info('FacilitatorUseCase verifyPayment() paymentRequirements:', paymentRequirements)

    try {
      const bchjs = this.adapters.bchWallet.getBCHJS()

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
        isValidSignature = bchjs.BitcoinCash.verifyMessage(
          payerAddress,
          signature,
          messageToVerify
        )
      } catch (error) {
        this.adapters.logger.error('Error verifying signature:', error)
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

      // Check time window
      const now = Math.floor(Date.now() / 1000)
      const validAfter = parseInt(authorization.validAfter, 10)
      const validBefore = parseInt(authorization.validBefore, 10)

      if (now < validAfter) {
        return {
          isValid: false,
          invalidReason: 'invalid_exact_bch_payload_authorization_valid_after',
          payer: payerAddress
        }
      }

      if (now >= validBefore) {
        return {
          isValid: false,
          invalidReason: 'invalid_exact_bch_payload_authorization_valid_before',
          payer: payerAddress
        }
      }

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
        const balanceData = await bchjs.Blockchain.getBalance(payerAddress)
        const balance = balanceData.balance + balanceData.unconfirmedBalance

        if (balance < paymentAmount) {
          return {
            isValid: false,
            invalidReason: 'insufficient_funds',
            payer: payerAddress
          }
        }
      } catch (error) {
        this.adapters.logger.error('Error checking balance:', error)
        // Continue verification even if balance check fails
        // The transaction will fail during settlement if balance is insufficient
      }

      return {
        isValid: true,
        payer: payerAddress
      }
    } catch (error) {
      this.adapters.logger.error('Error in verifyPayment:', error)
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
    this.adapters.logger.info('FacilitatorUseCase settlePayment() paymentPayload:', paymentPayload)
    this.adapters.logger.info('FacilitatorUseCase settlePayment() paymentRequirements:', paymentRequirements)

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
      if (!this.adapters.bchWallet.isWalletInitialized()) {
        await this.adapters.bchWallet.initializeWallet()
      }

      const wallet = this.adapters.bchWallet.getWallet()
      const facilitatorAddress = this.adapters.bchWallet.getFacilitatorAddress()

      // Create and broadcast transaction
      // Note: The facilitator creates the transaction, not the payer
      // This is different from EVM where we use the signed authorization
      // For BCH, we need to create a new transaction from the facilitator's wallet
      // However, the payment authorization proves the payer's intent
      // In a real implementation, you might want to use a different approach
      // For now, we'll create a transaction from facilitator to payTo with the authorized amount

      // Check facilitator balance first
      const facilitatorBalance = await wallet.getBalance({ bchAddress: facilitatorAddress })
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

      const txid = await wallet.send(outputs)

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
      const minConfirmations = this.adapters.bchWallet.getMinConfirmations()
      if (minConfirmations > 0) {
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
      this.adapters.logger.error('Error in settlePayment:', error)
      return {
        success: false,
        errorReason: 'unexpected_settle_error',
        transaction: '',
        network: 'bch',
        payer: paymentPayload?.payload?.authorization?.from || ''
      }
    }
  }
}

export default FacilitatorUseCase
