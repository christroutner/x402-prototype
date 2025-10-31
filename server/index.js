/*
  Demo x402 API server.
*/

// Global npm libraries
import { config } from "dotenv";
import express from "express";

async function startServer() {
  try {
    // Load environment variables
    config()

    // Create express app
    const app = express()

    // Start server
    app.listen(3000, () => {
      console.log('Server is running on port 3000');
    })
  } catch(err) {
    console.error('Error starting server:', err);
  }
}

startServer();