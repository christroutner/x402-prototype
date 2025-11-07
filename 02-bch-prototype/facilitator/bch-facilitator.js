/*
  Demo x402 Facilitator API server for Bitcoin Cash (BCH).
*/

// Global npm libraries
import { config } from 'dotenv'
import express from 'express'
import { BCHFacilitator, createExpressAdapter } from './src/facilitator.js'

/**
 * Start the BCH Facilitator server
 */
async function startFacilitator () {
  try {
    // Load environment variables
    config()

    // Constants
    const port = process.env.PORT || 4040

    // Create express app
    const app = express()

    // Parse JSON bodies
    app.use(express.json())

    // Initialize BCH facilitator
    const facilitator = new BCHFacilitator({
      bchPrivateKey: process.env.BCH_PRIVATE_KEY,
      network: 'bch',
      minConfirmations: parseInt(process.env.MIN_CONFIRMATIONS || '1', 10),
      restURL: process.env.BCH_REST_URL,
      apiToken: process.env.BCH_API_TOKEN,
      authPass: process.env.BCH_AUTH_PASS
    })

    // Add facilitator endpoints using the Express adapter
    // This mounts GET /facilitator/supported, POST /facilitator/verify, POST /facilitator/settle
    createExpressAdapter(facilitator, app, '/facilitator')

    // Example: A simple route
    app.get('/', (req, res) => {
      res.json({
        message: 'X402 BCH Facilitator - Express Example',
        endpoints: {
          supported: 'GET /facilitator/supported',
          verify: 'POST /facilitator/verify',
          settle: 'POST /facilitator/settle'
        }
      })
    })

    app.listen(port, () => {
      console.log(`Server running on http://localhost:${port}`)
      console.log(`Facilitator endpoints available at http://localhost:${port}/facilitator`)
    })
  } catch (err) {
    console.error('Error starting facilitator server:', err)
    process.exit(1)
  }
}

// Start the server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startFacilitator()
}
