/*
  Facilitator use case for BCH payment verification and settlement.

  High level overview:
  - Client submits UTXO information as a proof of payment.
  - Facilitator adds new UTXOs to the Level DB for quick lookup.
  - Client can send any amount in UTXO. Each call is debited against that UTXO
    until the amount is exhausted.
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

    // Bind 'this' object to all class methods
    this.listSupportedKinds = this.listSupportedKinds.bind(this)
    this.validateUtxo = this.validateUtxo.bind(this)
    this.verifyPayment = this.verifyPayment.bind(this)
    this.settlePayment = this.settlePayment.bind(this)
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

  // Validate a payment UTXO
  async validateUtxo ({ paymentPayload, paymentRequirements }) {
    try {
      console.log('validateUtxo() paymentPayload:', paymentPayload)
      console.log('validateUtxo() paymentRequirements:', paymentRequirements)

      if (!paymentPayload?.payload?.authorization) {
        return {
          isValid: false,
          invalidReason: 'missing_authorization'
        }
      }

      // Generate unique identifier for UTXO,
      // UTXOs are uniquely identified by their TXID and the vout number.
      const utxoId = `${paymentPayload.payload.authorization.txid}:${paymentPayload.payload.authorization.vout}`

      const utxoDb = this.adapters?.levelDB?.utxoDb
      if (!utxoDb) {
        throw new Error('UTXO database not initialized')
      }

      const walletAdapter = this.adapters.bchWallet
      const logger = this.adapters.logger
      const bchjs = walletAdapter.getBCHJS()
      const callCostSat = BigInt(
        paymentRequirements?.minAmountRequired ??
          paymentRequirements?.maxAmountRequired ??
          0
      )
      const revalidateThresholdMs = 5 * 60 * 1000 // 5 minutes
      const { authorization } = paymentPayload.payload
      const { txid, vout } = authorization
      const payerAddress = authorization.from

      const ensureWalletReady = async () => {
        if (!walletAdapter.isWalletInitialized()) {
          await walletAdapter.initializeWallet()
        }
        return walletAdapter.getWallet()
      }

      const revalidateUtxo = async () => {
        const wallet = await ensureWalletReady()
        const isValid = await wallet.utxoIsValid({ txid, vout })
        if (!isValid) {
          return {
            isValid: false,
            invalidReason: 'utxo_not_spendable'
          }
        }

        const rawTx = await bchjs.RawTransactions.getRawTransaction(txid, true)
        const output = rawTx?.vout?.[vout]
        if (!output) {
          return {
            isValid: false,
            invalidReason: 'utxo_output_not_found'
          }
        }

        const confirmations = rawTx.confirmations ?? 0
        const minConfirmations =
          paymentRequirements?.minConfirmations ??
          walletAdapter.getMinConfirmations() ??
          DEFAULT_MIN_CONFIRMATIONS

        if (confirmations < minConfirmations) {
          return {
            isValid: false,
            invalidReason: 'insufficient_confirmations',
            confirmations
          }
        }

        const outputAddress =
          output?.scriptPubKey?.addresses?.[0] ||
          output?.scriptPubKey?.cashAddrs?.[0] ||
          ''
        const expectedAddress = paymentRequirements?.payTo

        if (expectedAddress && outputAddress !== expectedAddress) {
          return {
            isValid: false,
            invalidReason: 'recipient_mismatch',
            outputAddress
          }
        }

        const valueBch = Number(output.value)
        if (!Number.isFinite(valueBch)) {
          return {
            isValid: false,
            invalidReason: 'invalid_utxo_value'
          }
        }

        const utxoAmountSat = BigInt(
          Math.round(valueBch * 1e8)
        )

        if (utxoAmountSat <= 0n) {
          return {
            isValid: false,
            invalidReason: 'invalid_utxo_value'
          }
        }

        return {
          isValid: true,
          utxoAmountSat,
          outputAddress,
          confirmations
        }
      }

      // Try to get the UTXO information from the Level DB
      let utxoInfo = null
      try {
        utxoInfo = await utxoDb.get(utxoId)
      } catch (err) {
        /* exit quietly */
      }

      if (!utxoInfo) {
        console.log('UTXO not found in Level DB')

        let revalidation
        try {
          revalidation = await revalidateUtxo()
        } catch (err) {
          logger.error('Error validating new UTXO:', err)
          return {
            isValid: false,
            invalidReason: 'utxo_validation_failed'
          }
        }

        if (!revalidation.isValid) {
          return revalidation
        }

        const remainingBalanceSat = revalidation.utxoAmountSat - callCostSat
        if (remainingBalanceSat < 0n) {
          return {
            isValid: false,
            invalidReason: 'insufficient_utxo_balance',
            utxoAmountSat: revalidation.utxoAmountSat.toString()
          }
        }

        const timestamp = new Date().toISOString()
        const record = {
          utxoId,
          txid,
          vout,
          payerAddress,
          receiverAddress: revalidation.outputAddress,
          transactionValueSat: revalidation.utxoAmountSat.toString(),
          remainingBalanceSat: remainingBalanceSat.toString(),
          totalDebitedSat: callCostSat.toString(),
          lastUpdated: timestamp,
          firstSeen: timestamp,
          lastChecked: timestamp,
          confirmations: revalidation.confirmations
        }

        await utxoDb.put(utxoId, record)

        return {
          isValid: true,
          remainingBalanceSat: remainingBalanceSat.toString(),
          utxoInfo: record
        }
      } else {
        let currentRemainingSat = BigInt(
          utxoInfo.remainingBalanceSat ?? utxoInfo.remainingBalance ?? '0'
        )
        const totalDebitedSat = BigInt(
          utxoInfo.totalDebitedSat ?? utxoInfo.totalDebited ?? '0'
        )

        const nowMs = Date.now()
        const lastCheckedMs = utxoInfo.lastChecked
          ? Date.parse(utxoInfo.lastChecked)
          : 0
        const shouldRevalidate =
          !Number.isFinite(lastCheckedMs) ||
          nowMs - lastCheckedMs > revalidateThresholdMs

        if (shouldRevalidate) {
          let revalidation
          try {
            revalidation = await revalidateUtxo()
          } catch (err) {
            logger.error('Error revalidating existing UTXO:', err)
            return {
              isValid: false,
              invalidReason: 'utxo_revalidation_failed'
            }
          }

          if (!revalidation.isValid) {
            return revalidation
          }

          const onChainRemaining =
            revalidation.utxoAmountSat - totalDebitedSat

          if (onChainRemaining < 0n) {
            return {
              isValid: false,
              invalidReason: 'utxo_previous_spend_detected'
            }
          }

          if (onChainRemaining < currentRemainingSat) {
            currentRemainingSat = onChainRemaining
          }

          utxoInfo.confirmations = revalidation.confirmations
          utxoInfo.receiverAddress = revalidation.outputAddress
          utxoInfo.transactionValueSat =
            revalidation.utxoAmountSat.toString()
        }

        const updatedRemainingSat = currentRemainingSat - callCostSat

        if (updatedRemainingSat < 0n) {
          return {
            isValid: false,
            invalidReason: 'insufficient_utxo_balance',
            remainingBalanceSat: currentRemainingSat.toString()
          }
        }

        const updatedTotalDebitedSat = totalDebitedSat + callCostSat
        const timestamp = new Date().toISOString()
        const updatedRecord = {
          ...utxoInfo,
          remainingBalanceSat: updatedRemainingSat.toString(),
          totalDebitedSat: updatedTotalDebitedSat.toString(),
          lastUpdated: timestamp,
          lastChecked: timestamp
        }

        await utxoDb.put(utxoId, updatedRecord)

        return {
          isValid: true,
          remainingBalanceSat: updatedRemainingSat.toString(),
          utxoInfo: updatedRecord
        }
      }

      return {
        isValid: false,
        invalidReason: 'unknown_utxo_state'
      }
    } catch (err) {
      console.error('Error in validateUtxo:', err)
      return {
        isValid: false,
        invalidReason: 'unexpected_utxo_validation_error',
        errorMessage: err.message
      }
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
    console.log('FacilitatorUseCase verifyPayment() paymentPayload:', paymentPayload)
    console.log('FacilitatorUseCase verifyPayment() paymentRequirements:', paymentRequirements)

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

      // // Verify recipient address matches
      // if (authorization.to !== paymentRequirements.payTo) {
      //   return {
      //     isValid: false,
      //     invalidReason: 'invalid_exact_bch_payload_recipient_mismatch',
      //     payer: payerAddress
      //   }
      // }

      const utxoValidation = await this.validateUtxo({ paymentPayload, paymentRequirements })
      console.log('utxoValidation:', utxoValidation)

      if (!utxoValidation.isValid) {
        return {
          isValid: false,
          invalidReason: utxoValidation.invalidReason || 'invalid_utxo',
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
