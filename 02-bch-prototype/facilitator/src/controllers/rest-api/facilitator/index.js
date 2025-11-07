/*
  REST API library for the /facilitator route.
*/

// Public npm libraries.
import express from 'express'

// Local libraries.
import FacilitatorRESTControllerLib from './controller.js'

class FacilitatorRouter {
  constructor (localConfig = {}) {
    // Dependency Injection.
    this.adapters = localConfig.adapters
    if (!this.adapters) {
      throw new Error(
        'Instance of Adapters library required when instantiating Facilitator REST Controller.'
      )
    }
    this.useCases = localConfig.useCases
    if (!this.useCases) {
      throw new Error(
        'Instance of Use Cases library required when instantiating Facilitator REST Controller.'
      )
    }

    const dependencies = {
      adapters: this.adapters,
      useCases: this.useCases
    }

    // Encapsulate dependencies.
    this.facilitatorRESTController = new FacilitatorRESTControllerLib(dependencies)

    // Instantiate the router and set the base route.
    this.router = express.Router()
  }

  attach (app) {
    if (!app) {
      throw new Error(
        'Must pass app object when attaching REST API controllers.'
      )
    }

    // Define the routes and attach the controller.
    this.router.get('/supported', this.facilitatorRESTController.listSupportedKinds)
    this.router.post('/verify', this.facilitatorRESTController.verifyPayment)
    this.router.post('/settle', this.facilitatorRESTController.settlePayment)

    // Attach the Controller routes to the Express app.
    app.use('/facilitator', this.router)
  }
}

export default FacilitatorRouter
