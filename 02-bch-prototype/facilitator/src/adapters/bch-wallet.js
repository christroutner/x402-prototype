/*
  BCH Wallet adapter for Bitcoin Cash operations
*/

// Global libraries
import MinimalBCHWallet from 'minimal-slp-wallet'
import RetryQueue from '@chris.troutner/retry-queue'

// Local libraries
import config from '../config/index.js'

class BCHWalletAdapter {
  constructor (localConfig = {}) {
    // Encapsulate dependencies
    this.msWallet = new MinimalBCHWallet()
    this.bchjs = this.msWallet.bchjs
    this.config = config
    this.retryQueue = new RetryQueue()

    // Bind 'this' object to all class methods
    this.validateUtxo = this.validateUtxo.bind(this)
  }

  // Validate that a UTXO payment to the server was made.
  async validateUtxo ({ txid, vout }) {
    try {
      // Ensure the minimal-slp-wallet is ready
      await this.msWallet.walletInfoPromise

      // Get the TX details
      // const txData = await this.msWallet.getTxData([txid])
      const txData = await this.retryQueue.addToQueue(this.msWallet.getTxData, [txid])
      console.log('txData: ', JSON.stringify(txData, null, 2))

      // Extract the sats sent and reciever address from the UTXO.
      const voutData = txData[0]?.vout?.[vout]
      const receiverAddress = voutData?.scriptPubKey?.addresses?.[0]
      const valueBch = Number(voutData?.value)
      const valueSats = Math.round(valueBch * 1e8)

      // Verify the receiver address is the server's address.
      if (receiverAddress !== this.config.serverBchAddress) {
        return {
          isValid: false,
          invalidReason: 'invalid_receiver_address',
          utxoAmountSat: null
        }
      }

      // TODO: Verify the payment did not trigger a Double Spend Proof.
      // This call is only available in bch-js and requires a connection to bch-api.

      return {
        isValid: true,
        invalidReason: 'valid_utxo',
        utxoAmountSat: valueSats

      }
    } catch (err) {
      console.error('Error in BCHWalletAdapter.validateUtxo()', err)

      return {
        isValid: false,
        invalidReason: err.message,
        utxoAmountSat: null
      }
    }
  }
}

export default BCHWalletAdapter
