/*
  This is a top-level library that encapsulates all the additional Use Cases.
  The concept of Use Cases comes from Clean Architecture:
  https://troutsblog.com/blog/clean-architecture
*/

// Local libraries
import FacilitatorUseCase from './facilitator.js'

class UseCases {
  constructor (localConfig = {}) {
    this.adapters = localConfig.adapters
    if (!this.adapters) {
      throw new Error(
        'Instance of adapters must be passed in when instantiating Use Cases library.'
      )
    }

    this.facilitator = new FacilitatorUseCase({ adapters: this.adapters })
  }

  // Run any startup Use Cases at the start of the app.
  async start () {
    this.adapters.logger.info('Use Cases have been started.')
    return true
  }
}

export default UseCases
