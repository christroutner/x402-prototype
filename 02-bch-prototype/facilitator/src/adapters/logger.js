/*
  Simple logger adapter for BCH Facilitator
*/

class Logger {
  constructor (localConfig = {}) {
    this.logLevel = localConfig.logLevel || 'info'
  }

  info (message) {
    console.log(`[INFO] ${message}`)
  }

  error (message, error) {
    if (error) {
      console.error(`[ERROR] ${message}`, error)
    } else {
      console.error(`[ERROR] ${message}`)
    }
  }

  warn (message) {
    console.warn(`[WARN] ${message}`)
  }

  debug (message) {
    if (this.logLevel === 'debug') {
      console.log(`[DEBUG] ${message}`)
    }
  }
}

export default Logger
