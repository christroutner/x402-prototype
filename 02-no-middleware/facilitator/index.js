/*
  Demo x402 Facilitator API server.
*/

// Global npm libraries
import { config } from 'dotenv'
import express from 'express'
import { Facilitator, createExpressAdapter } from '@christroutner/x402-sovereign'
import { baseSepolia } from 'viem/chains'

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

    // Initialize your sovereign facilitator
    const facilitator = new Facilitator({
      evmPrivateKey: process.env.EVM_PRIVATE_KEY,
      networks: [baseSepolia]
    })

    // Add facilitator endpoints using the Express adapter
    // This mounts GET /facilitator/supported, POST /facilitator/verify, POST /facilitator/settle
    createExpressAdapter(facilitator, app, '/facilitator')

    // Example: A simple route
    app.get('/', (req, res) => {
      res.json({
        message: 'X402 Sovereign Facilitator - Express Example',
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
  }
}
startFacilitator()
