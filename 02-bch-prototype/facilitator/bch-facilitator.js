/*
  Entry point for BCH Facilitator API server.
  This file instantiates and starts the Server class.
*/

import Server from './bin/server.js'

const server = new Server()
server.startServer().catch(err => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
