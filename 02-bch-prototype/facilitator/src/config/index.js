/*
  Configuration for BCH Facilitator service
*/

import * as url from 'url'
import { readFileSync } from 'fs'
import dotenv from 'dotenv'

// Load environment variables before accessing process.env
dotenv.config()

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))
const pkgInfo = JSON.parse(readFileSync(`${__dirname.toString()}/../../package.json`))

const version = pkgInfo.version

export default {
  // Server port
  port: process.env.PORT || 4345,

  // Environment
  env: process.env.NODE_ENV || 'development',

  // Logging level
  logLevel: process.env.LOG_LEVEL || 'info',

  // BCH Facilitator configuration
  bchPrivateKey: process.env.BCH_PRIVATE_KEY,
  network: process.env.NETWORK || 'bch',
  minConfirmations: parseInt(process.env.MIN_CONFIRMATIONS || '1', 10),
  restURL: process.env.BCH_REST_URL,
  apiToken: process.env.BCH_API_TOKEN,
  authPass: process.env.BCH_AUTH_PASS,

  // Version
  version,

  serverBchAddress: process.env.SERVER_BCH_ADDRESS || 'bitcoincash:qqlrzp23w08434twmvr4fxw672whkjy0py26r63g3d'
}
