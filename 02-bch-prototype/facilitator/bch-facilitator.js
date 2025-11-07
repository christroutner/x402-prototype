/*
  Entry point for BCH Facilitator API server.
  This file instantiates and starts the Server class.
*/

import Server from './bin/server.js'

// Start the server
// const server = new Server()
// async function startServer () {
//   try {
//     await server.startServer()
//     console.log('startServer() returned.')
//   } catch (err) {
//     console.error('Failed to start server:', err)
//     process.exit(1)
//   }
// }
// startServer()

const server = new Server()
server.startServer().catch(err => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
