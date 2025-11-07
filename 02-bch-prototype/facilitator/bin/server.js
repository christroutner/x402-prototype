/*
  Express server for BCH Facilitator API.
  The architecture of the code follows the Clean Architecture pattern.
*/

// npm libraries
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'

// Local libraries
import config from '../src/config/index.js'
import Controllers from '../src/controllers/index.js'
import Logger from '../src/adapters/logger.js'

const wlogger = new Logger({ logLevel: config.logLevel })

// Load environment variables
dotenv.config()

class Server {
  constructor () {
    // Encapsulate dependencies
    this.controllers = new Controllers()
    this.config = config
    this.process = process
  }

  async startServer () {
    try {
      // Create an Express instance.
      const app = express()

      // MIDDLEWARE START
      app.use(express.json())
      app.use(express.urlencoded({ extended: true }))
      app.use(cors({ origin: '*' }))

      // Request logging middleware
      app.use((req, res, next) => {
        wlogger.info(`${req.method} ${req.path}`)
        next()
      })

      // Error handling middleware
      app.use((err, req, res, next) => {
        wlogger.error('Express error:', err)
        res.status(500).json({
          error: err.message || 'Internal server error'
        })
      })

      // Wait for any adapters to initialize.
      await this.controllers.initAdapters()

      // Wait for any use-libraries to initialize.
      await this.controllers.initUseCases()

      // Attach REST API controllers to the app.
      this.controllers.attachRESTControllers(app)

      // Health check endpoint
      app.get('/health', (req, res) => {
        res.json({
          status: 'ok',
          service: 'bch-facilitator',
          version: config.version
        })
      })

      // Root endpoint
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

      // MIDDLEWARE END

      console.log(`Running server in environment: ${this.config.env}`)
      wlogger.info(`Running server in environment: ${this.config.env}`)

      this.server = app.listen(this.config.port, () => {
        console.log(`Server started on port ${this.config.port}`)
        wlogger.info(`Server started on port ${this.config.port}`)
      })

      this.server.on('error', (err) => {
        console.error('Server error:', err)
      })

      this.server.on('close', () => {
        console.log('Server closed.')
      })

      return this.server
    } catch (err) {
      console.error('Could not start server. Error: ', err)
      wlogger.error('Could not start server. Error: ', err)

      console.log(
        'Exiting after 5 seconds. Depending on process manager to restart.'
      )
      await this.sleep(5000)
      this.process.exit(1)
    }
  }

  sleep (ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

export default Server
