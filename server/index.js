/*
  Demo x402 API server.
*/

// Global npm libraries
import { config } from 'dotenv'
import express from 'express'
import { paymentMiddleware } from 'x402-express'

async function startServer () {
  try {
    // Load environment variables
    config()

    // Constants
    const facilitatorUrl = process.env.FACILITATOR_URL
    const payTo = process.env.ADDRESS
    const port = process.env.PORT || 4021

    // Create express app
    const app = express()

    // Add x402 middleware
    app.use(
      paymentMiddleware(
        payTo,
        {
          'GET /weather': {
            // USDC amount in dollars
            price: '$0.001',
            network: 'base-sepolia',
            config: {
              description: 'Access to weather data'
            }
          },
          network: 'base-sepolia'
        },
        {
          url: facilitatorUrl
        }
      )
    )

    // Weather endpoint
    app.get('/weather', (req, res) => {
      res.send({
        report: {
          weather: 'sunny',
          temperature: 70
        }
      })
    })

    // Start server
    app.listen(port, () => {
      // console.log('Server is running on port 3000');
      console.log(`Server listening at http://localhost:${port}`)
    })
  } catch (err) {
    console.error('Error starting server:', err)
  }
}

startServer()
