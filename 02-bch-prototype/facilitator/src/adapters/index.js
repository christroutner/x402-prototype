/*
  This is a top-level library that encapsulates all the additional Adapters.
  The concept of Adapters comes from Clean Architecture:
  https://troutsblog.com/blog/clean-architecture
*/

// Load individual adapter libraries.
import BCHWalletAdapter from './bch-wallet.js'
import Logger from './logger.js'
import config from '../config/index.js'
import LevelDBAdapter from './leveldb.js'

class Adapters {
  constructor (localConfig = {}) {
    // Encapsulate dependencies
    this.config = config
    this.logger = new Logger({ logLevel: config.logLevel })
    this.bchWallet = new BCHWalletAdapter({
      bchPrivateKey: localConfig.bchPrivateKey || config.bchPrivateKey,
      network: localConfig.network || config.network,
      minConfirmations: localConfig.minConfirmations || config.minConfirmations,
      restURL: localConfig.restURL || config.restURL,
      apiToken: localConfig.apiToken || config.apiToken,
      authPass: localConfig.authPass || config.authPass
    })
    this.levelDB = new LevelDBAdapter()
  }

  async start () {
    try {
      await this.levelDB.openDb()
      this.logger.info('Level DB adapter initialized.')

      return true
    } catch (err) {
      this.logger.error('Error in adapters/index.js/start()', err)
      throw err
    }
  }
}

export default Adapters
