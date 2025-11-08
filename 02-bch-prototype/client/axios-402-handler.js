/*
  Axios wrapper for x402 payment protocol with Bitcoin Cash (BCH) support.
  Automatically handles 402 payment responses by creating and attaching X-PAYMENT headers.
*/

// Global libraries
// import { randomBytes } from 'crypto'
import { createRequire } from 'module'
import BCHWallet from 'minimal-slp-wallet'
import RetryQueue from '@chris.troutner/retry-queue'

const require = createRequire(import.meta.url)
const BCHJS = require('@psf/bch-js')

// Global variables
const currentUtxo = {
  txid: null,
  vout: null,
  satsLeft: null
}

/**
 * Creates a BCH signer from a private key in WIF format.
 *
 * @param {string} privateKeyWIF - Private key in Wallet Import Format (WIF)
 * @returns {Object} Signer object with signMessage method and address property
 */
export function createBCHSigner (privateKeyWIF, paymentAmountSats) {
  const bchjs = new BCHJS()

  // Create ECPair from WIF
  const ecpair = bchjs.ECPair.fromWIF(privateKeyWIF)

  // Get cash address (bitcoincash: format)
  const address = bchjs.ECPair.toCashAddress(ecpair)

  return {
    ecpair,
    address,
    wif: privateKeyWIF,
    paymentAmountSats,
    /**
     * Signs a message using the private key.
     *
     * @param {string} message - Message to sign
     * @returns {string} Base64-encoded signature
     */
    signMessage (message) {
      return bchjs.BitcoinCash.signMessageWithPrivKey(privateKeyWIF, message)
    }
  }
}

/**
 * Creates a payment header for BCH x402 payments.
 *
 * @param {Object} signer - BCH signer object from createBCHSigner
 * @param {Object} paymentRequirements - Payment requirements from 402 response
 * @param {number} x402Version - x402 protocol version (default: 1)
 * @returns {Promise<string>} JSON string of the payment header
 */
export async function createPaymentHeader (signer, paymentRequirements, x402Version = 1, txid, vout) {
  // Instantiate minimal-slp-wallet
  const bchWallet = new BCHWallet()
  await bchWallet.walletInfoPromise

  // Generate random 32-byte nonce
  // const nonceBytes = randomBytes(32)
  // const nonce = '0x' + nonceBytes.toString('hex')

  // Calculate timestamps
  // const now = Math.floor(Date.now() / 1000)
  // const validAfter = String(now - 60) // 60 seconds before current time
  // const validBefore = String(now + (paymentRequirements.maxTimeoutSeconds || 60))

  // Build authorization object
  const authorization = {
    from: signer.address,
    to: paymentRequirements.payTo,
    value: paymentRequirements.minAmountRequired,
    txid,
    vout,
    amount: signer.paymentAmountSats // Optional
  }

  // Create message to sign (JSON stringified authorization)
  const messageToSign = JSON.stringify(authorization)

  // Sign the message
  const signature = signer.signMessage(messageToSign)

  // Build payment header
  const paymentHeader = {
    x402Version,
    scheme: paymentRequirements.scheme || 'exact',
    network: paymentRequirements.network || 'bch',
    payload: {
      signature,
      authorization
    }
  }

  console.log('axios-402-handler.js createPaymentHeader() paymentHeader:', paymentHeader)

  // Return as JSON string
  return JSON.stringify(paymentHeader)
}

/**
 * Selects payment requirements from the accepts array.
 * Filters for BCH network and exact scheme.
 *
 * @param {Array} accepts - Array of payment requirements
 * @returns {Object} Selected payment requirements
 */
function selectPaymentRequirements (accepts) {
  // Filter for BCH network and exact scheme
  const bchRequirements = accepts.filter(req => {
    return req.network === 'bch' && req.scheme === 'utxo'
  })

  if (bchRequirements.length === 0) {
    throw new Error('No BCH payment requirements found in 402 response')
  }

  // Return the first matching requirement
  return bchRequirements[0]
}

async function sendPayment (signer, paymentRequirements) {
  try {
    const wif = signer.wif

    // Get the payment amount in satoshis. This can be the paymentAmountSats to
    // pay on each batch payment, dictated by the user. Or it can be the
    // minAmountRequired from the payment requirements.
    const paymentAmountSats = signer.paymentAmountSats

    // Initialize the wallet with the private key.
    const bchWallet = new BCHWallet(wif)
    await bchWallet.initialize()

    const retryQueue = new RetryQueue()

    // Send the payment
    const receivers = [
      {
        address: paymentRequirements.payTo,
        amountSat: paymentAmountSats
      }
    ]
    // const txid = await bchWallet.send(receivers)
    const txid = await retryQueue.addToQueue(bchWallet.send, receivers)
    console.log('Payment sent with txid: ', txid)

    return {
      txid,
      vout: 0,
      satsSent: paymentAmountSats
    }
  } catch (err) {
    console.error('Error in sendPayment()')
    throw err
  }
}

/**
 * Adds a payment interceptor to an axios instance.
 * Automatically handles 402 responses by creating payment headers and retrying.
 *
 * @param {Object} axiosInstance - Axios instance to add interceptor to
 * @param {Object} signer - BCH signer object from createBCHSigner
 * @returns {Object} Modified axios instance
 */
export function withPaymentInterceptor (axiosInstance, signer) {
  axiosInstance.interceptors.response.use(
    response => response,
    async (error) => {
      // Only handle 402 errors
      if (!error.response || error.response.status !== 402) {
        return Promise.reject(error)
      }

      try {
        const originalConfig = error.config
        if (!originalConfig || !originalConfig.headers) {
          return Promise.reject(new Error('Missing axios request configuration'))
        }

        // Prevent infinite retry loops
        if (originalConfig.__is402Retry) {
          return Promise.reject(error)
        }

        // Extract payment requirements from 402 response
        const { x402Version, accepts } = error.response.data

        if (!accepts || !Array.isArray(accepts) || accepts.length === 0) {
          return Promise.reject(new Error('No payment requirements found in 402 response'))
        }

        // Select payment requirements
        const paymentRequirements = selectPaymentRequirements(accepts)
        const cost = paymentRequirements.minAmountRequired

        let txid = null
        let vout = null
        let satsLeft = null
        if (currentUtxo.txid === null || currentUtxo.satsLeft < cost) {
          console.log('Sending a new payment to the server.')

          // Send a new payment to the server.
          const payment = await sendPayment(signer, paymentRequirements)
          txid = payment.txid
          vout = payment.vout
          satsLeft = payment.satsSent - cost
        } else {
          console.log('Using the current UTXO being debited against.')

          // Use the current UTXO being debited against.
          txid = currentUtxo.txid
          vout = currentUtxo.vout
          satsLeft = currentUtxo.satsLeft - cost
        }

        // Update the info on the current UTXO being debited against.
        currentUtxo.txid = txid
        currentUtxo.vout = vout
        currentUtxo.satsLeft = satsLeft

        // Create payment header
        const paymentHeader = await createPaymentHeader(
          signer,
          paymentRequirements,
          x402Version || 1,
          txid,
          vout
        )

        // Mark request as retry to prevent loops
        originalConfig.__is402Retry = true

        // Add payment header to request
        originalConfig.headers['X-PAYMENT'] = paymentHeader
        originalConfig.headers['Access-Control-Expose-Headers'] = 'X-PAYMENT-RESPONSE'

        // Retry the original request with payment header
        const secondResponse = await axiosInstance.request(originalConfig)
        return secondResponse
      } catch (paymentError) {
        // If payment creation fails, reject with the original error
        return Promise.reject(paymentError)
      }
    }
  )

  return axiosInstance
}
