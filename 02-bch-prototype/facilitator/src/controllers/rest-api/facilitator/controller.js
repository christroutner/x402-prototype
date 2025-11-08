/*
  REST API Controller library for the /facilitator route
*/

class FacilitatorRESTControllerLib {
  constructor (localConfig = {}) {
    // Dependency Injection.
    this.adapters = localConfig.adapters
    if (!this.adapters) {
      throw new Error(
        'Instance of Adapters library required when instantiating /facilitator REST Controller.'
      )
    }
    this.useCases = localConfig.useCases
    if (!this.useCases) {
      throw new Error(
        'Instance of Use Cases library required when instantiating /facilitator REST Controller.'
      )
    }

    // Bind 'this' object to all subfunctions
    this.listSupportedKinds = this.listSupportedKinds.bind(this)
    this.verifyPayment = this.verifyPayment.bind(this)
    this.settlePayment = this.settlePayment.bind(this)
    this.handleError = this.handleError.bind(this)
  }

  /**
   * GET /facilitator/supported
   * Returns the list of payment kinds this facilitator supports
   */
  async listSupportedKinds (req, res) {
    try {
      console.log('listSupportedKinds() called')

      const result = this.useCases.facilitator.listSupportedKinds()
      return res.status(200).json(result)
    } catch (err) {
      return this.handleError(err, req, res)
    }
  }

  /**
   * POST /facilitator/verify
   * Verifies a payment authorization without settling it on-chain
   */
  async verifyPayment (req, res) {
    try {
      console.log('verifyPayment() called')
      // console.log('req.body:', req.body)

      if (!req.body?.paymentPayload || !req.body?.paymentRequirements) {
        return res.status(400).json({
          error: 'Missing paymentPayload or paymentRequirements'
        })
      }

      const result = await this.useCases.facilitator.verifyPayment(
        req.body.paymentPayload,
        req.body.paymentRequirements
      )

      // Add invalidReason if payment is invalid
      const responseBody = {
        isValid: result.isValid,
        payer: result.payer
      }

      if (!result.isValid && result.invalidReason) {
        responseBody.invalidReason = result.invalidReason
      }

      return res.status(200).json(responseBody)
    } catch (err) {
      return this.handleError(err, req, res)
    }
  }

  /**
   * POST /facilitator/settle
   * Settles a payment by broadcasting the transaction to the blockchain
   */
  async settlePayment (req, res) {
    try {
      console.log('settlePayment() called')

      if (!req.body?.paymentPayload || !req.body?.paymentRequirements) {
        return res.status(400).json({
          error: 'Missing paymentPayload or paymentRequirements'
        })
      }

      const result = await this.useCases.facilitator.settlePayment(
        req.body.paymentPayload,
        req.body.paymentRequirements
      )

      return res.status(200).json(result)
    } catch (err) {
      return this.handleError(err, req, res)
    }
  }

  handleError (err, req, res) {
    this.adapters.logger.error('Error in FacilitatorRESTController:', err)
    return res.status(500).json({
      error: err.message || 'Internal server error'
    })
  }
}

export default FacilitatorRESTControllerLib
