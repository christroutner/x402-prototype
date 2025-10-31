/*
  Demo x402 API client.
*/

// Global npm libraries
import { config } from 'dotenv'
import { withPaymentInterceptor, createSigner, decodeXPaymentResponse } from 'x402-axios'
import axios from 'axios'

async function main () {
  try {
    // Load environment variables
    config()

    const privateKey = process.env.PRIVATE_KEY
    const baseURL = process.env.RESOURCE_SERVER_URL
    const endpointPath = process.env.ENDPOINT_PATH

    if (!baseURL || !privateKey || !endpointPath) {
      console.error('Missing required environment variables')
      process.exit(1)
    }

    // Make a normal API call and expect a 402 error
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

    // Make a second call with a payment.

    // const signer = await createSigner('base-sepolia', privateKey)

    // const api = withPaymentInterceptor(
    //   axios.create({
    //     baseURL
    //   }),
    //   signer
    // )

    // try {
    //   // Call without making a payment, expect a 402 error
    //   const response = await api.get(endpointPath)
    //   console.log(response.data)
    // } catch (err) {
    //   console.log(`Status code: ${err.response.status}`)
    //   console.log(`Error data: ${JSON.stringify(err.response.data, null, 2)}`)

    // // Decode the payment response from the header.
    // const paymentResponse = decodeXPaymentResponse(err.response.config.headers['X-PAYMENT'])
    // console.log(paymentResponse)
    // }
  } catch (err) {
    console.error('Error starting client:', err)
  }
}
main()
