/*
  Axios wrapper for x402 payment protocol with Bitcoin Cash (BCH) support.
  Automatically handles 402 payment responses by creating and attaching X-PAYMENT headers.
*/

import { randomBytes } from 'crypto'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const BCHJS = require('@psf/bch-js')

/**
 * Creates a BCH signer from a private key in WIF format.
 *
 * @param {string} privateKeyWIF - Private key in Wallet Import Format (WIF)
 * @returns {Object} Signer object with signMessage method and address property
 */
export function createBCHSigner (privateKeyWIF) {
  const bchjs = new BCHJS()

  // Create ECPair from WIF
  const ecpair = bchjs.ECPair.fromWIF(privateKeyWIF)

  // Get cash address (bitcoincash: format)
  const address = bchjs.ECPair.toCashAddress(ecpair)

  return {
    ecpair,
    address,
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
export async function createPaymentHeader (signer, paymentRequirements, x402Version = 1) {
  // Generate random 32-byte nonce
  const nonceBytes = randomBytes(32)
  const nonce = '0x' + nonceBytes.toString('hex')

  // Calculate timestamps
  const now = Math.floor(Date.now() / 1000)
  const validAfter = String(now - 60) // 60 seconds before current time
  const validBefore = String(now + (paymentRequirements.maxTimeoutSeconds || 60))

  // Build authorization object
  const authorization = {
    from: signer.address,
    to: paymentRequirements.payTo,
    value: paymentRequirements.maxAmountRequired,
    validAfter,
    validBefore,
    nonce
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
    return req.network === 'bch' && req.scheme === 'exact'
  })

  if (bchRequirements.length === 0) {
    throw new Error('No BCH payment requirements found in 402 response')
  }

  // Return the first matching requirement
  return bchRequirements[0]
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

        // Create payment header
        const paymentHeader = await createPaymentHeader(
          signer,
          paymentRequirements,
          x402Version || 1
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
