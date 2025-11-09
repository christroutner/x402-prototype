/*
  Demo x402 API client.
*/

// Global npm libraries
import { config } from 'dotenv'
import axios from 'axios'
import { createBCHSigner, withPaymentInterceptor } from './axios-402-handler.js'

async function main () {
  try {
    // Load environment variables
    config()

    // Fund the private key by sending BCH to: bitcoincash:qz9s2mccqamzppfq708cyfde5ejgmsr9hy7r3unmkk
    const privateKey = process.env.PRIVATE_KEY || 'L1eYaneXDDXy8VDig4Arwe8wYHbhtsA5wuQvwsKwhaYeneoZuKG4'
    const baseURL = process.env.RESOURCE_SERVER_URL || 'http://localhost:4021'
    const endpointPath = process.env.ENDPOINT_PATH || '/weather'
    const paymentAmountSats = parseInt(process.env.PAYMENT_AMOUNT_SATS) || 2000

    if (!baseURL || !privateKey || !endpointPath) {
      console.error('Missing required environment variables')
      process.exit(1)
    }

    // Step 1: Make a normal API call and expect a 402 error
    console.log('\n\nStep 1: Making first call, expecting a 402 error returned.')
    try {
      const response = await axios.get(baseURL + endpointPath)
      console.log(response.data)
      console.log('Step 1 failed. Expected a 402 error.')
    } catch (err) {
      console.log(`Status code: ${err.response.status}`)
      console.log(`Error data: ${JSON.stringify(err.response.data, null, 2)}`)
      console.log('\n\n')
    }

    // Create a signer from the private key.
    const signer = await createBCHSigner(privateKey, paymentAmountSats)

    // Wrap axios with the payment interceptor for automatic payment and
    // retry when the 402 error is encountered.
    const api = withPaymentInterceptor(
      axios.create({
        baseURL
      }),
      signer
    )

    // Step 2: Make a second call with a payment. Generate a new UTXO.
    console.log('\n\nStep 2: Making second call with a payment.')

    try {
      // Call the same endpoint path with a payment.
      const response = await api.get(endpointPath)
      console.log('Data returned after payment: ', response.data)
    } catch (err) {
      console.log('Step 2 failed. Expected a 200 success status code.')
      console.log(`Status code: ${err.response.status}`)
      console.log(`Error data: ${JSON.stringify(err.response.data, null, 2)}`)

      // Decode the payment response from the header.
      // const paymentResponse = decodeXPaymentResponse(err.response.config.headers['X-PAYMENT'])
      // console.log(paymentResponse)

      process.exit(1)
    }

    // Step 3: Make a third call an pay with the UTXO created in step 2.
    console.log('\n\nStep 3: Making third call with a payment using the UTXO created in step 2.')

    try {
      // Call the same endpoint path with a payment using the UTXO created in step 2.
      const response = await api.get(endpointPath)
      console.log('Data returned after payment: ', response.data)
    } catch (err) {
      console.log('Step 3 failed. Expected a 200 success status code.')
      console.log(`Status code: ${err.response.status}`)
      console.log(`Error data: ${JSON.stringify(err.response.data, null, 2)}`)
    }
  } catch (err) {
    console.error('Error starting client:', err)
  }
}
main()
