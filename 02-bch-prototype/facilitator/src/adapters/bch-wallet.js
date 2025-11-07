/*
  BCH Wallet adapter for Bitcoin Cash operations
*/

import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const BCHJS = require('@psf/bch-js')
const MinimalBCHWallet = require('minimal-slp-wallet')

class BCHWalletAdapter {
  constructor (localConfig = {}) {
    if (!localConfig.bchPrivateKey) {
      throw new Error('BCHWalletAdapter: bchPrivateKey is required')
    }

    // Validate mainnet private key (must start with L or K)
    const wif = localConfig.bchPrivateKey
    if (!wif.startsWith('L') && !wif.startsWith('K')) {
      throw new Error('BCHWalletAdapter: bchPrivateKey must be a mainnet WIF (starts with L or K)')
    }

    this.bchPrivateKey = localConfig.bchPrivateKey
    this.network = localConfig.network || 'bch'
    this.minConfirmations = localConfig.minConfirmations ?? 1

    // Initialize bch-js with optional configuration
    const bchjsOptions = {}
    if (localConfig.restURL) {
      bchjsOptions.restURL = localConfig.restURL
    }
    if (localConfig.apiToken) {
      bchjsOptions.apiToken = localConfig.apiToken
    }
    if (localConfig.authPass) {
      bchjsOptions.authPass = localConfig.authPass
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
   * Get the facilitator address
   */
  getFacilitatorAddress () {
    return this.facilitatorAddress
  }

  /**
   * Get BCHJS instance
   */
  getBCHJS () {
    return this.bchjs
  }

  /**
   * Get wallet instance (must be initialized first)
   */
  getWallet () {
    if (!this.walletInitialized) {
      throw new Error('Wallet not initialized. Call initializeWallet() first.')
    }
    return this.wallet
  }

  /**
   * Check if wallet is initialized
   */
  isWalletInitialized () {
    return this.walletInitialized
  }

  /**
   * Get minimum confirmations required
   */
  getMinConfirmations () {
    return this.minConfirmations
  }
}

export default BCHWalletAdapter
