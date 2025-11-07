/*
  Payment middleware for Bitcoin Cash (BCH) network.
*/

/**
 * Computes route patterns from routes configuration
 * @param {Object} routes - Routes configuration object
 * @returns {Array} Array of route pattern objects with verb, pattern regex, and config
 */
function computeRoutePatterns (routes) {
  // Normalize routes - handle both simple price values and full config objects
  const normalizedRoutes = Object.fromEntries(
    Object.entries(routes).map(([pattern, value]) => {
      // Skip the 'network' property if it exists at the root level
      if (pattern === 'network') {
        return null
      }
      const normalizedValue = typeof value === 'string' || typeof value === 'number'
        ? { price: value, network: routes.network || 'bch' }
        : value
      return [pattern, normalizedValue]
    }).filter(Boolean)
  )

  return Object.entries(normalizedRoutes).map(([pattern, routeConfig]) => {
    // Split pattern into verb and path, defaulting to "*" for verb if not specified
    const parts = pattern.includes(' ') ? pattern.split(/\s+/) : ['*', pattern]
    const verb = parts[0] || '*'
    const path = parts[1] || parts[0]

    if (!path) {
      throw new Error(`Invalid route pattern: ${pattern}`)
    }

    // Convert path pattern to regex
    const regexPattern = `^${
      path
        // First escape all special regex characters except * and []
        .replace(/[$()+.?^{|}]/g, '\\$&')
        // Then handle our special pattern characters
        .replace(/\*/g, '.*?') // Make wildcard non-greedy and optional
        .replace(/\[([^\]]+)\]/g, '[^/]+') // Convert [param] to regex capture
        .replace(/\//g, '\\/') // Escape slashes
    }$`

    return {
      verb: verb.toUpperCase(),
      pattern: new RegExp(regexPattern, 'i'),
      config: routeConfig
    }
  })
}

/**
 * Finds the matching route pattern for the given path and method
 * @param {Array} routePatterns - Array of route patterns to search through
 * @param {string} path - The path to match against
 * @param {string} method - The HTTP method to match against
 * @returns {Object|undefined} The matching route pattern or undefined if no match is found
 */
function findMatchingRoute (routePatterns, path, method) {
  // Normalize the path:
  // 1. Remove query parameters and hash fragments
  // 2. Replace backslashes with forward slashes
  // 3. Replace multiple consecutive slashes with a single slash
  // 4. Trim trailing slashes
  let normalizedPath
  try {
    // First split off query parameters and hash fragments
    const pathWithoutQuery = path.split(/[?#]/)[0]

    // Then decode the path - this needs to happen before any normalization
    // so encoded characters are properly handled
    const decodedPath = decodeURIComponent(pathWithoutQuery)

    // Normalize the path (just clean up slashes)
    normalizedPath = decodedPath
      .replace(/\\/g, '/') // replace backslashes
      .replace(/\/+/g, '/') // collapse slashes
      .replace(/(.+?)\/+$/, '$1') // trim trailing slashes
  } catch {
    // If decoding fails (e.g., invalid % encoding), return undefined
    return undefined
  }

  // Find matching route pattern
  const matchingRoutes = routePatterns.filter(({ pattern, verb }) => {
    const matchesPath = pattern.test(normalizedPath)
    const upperMethod = method.toUpperCase()
    const matchesVerb = verb === '*' || upperMethod === verb

    return matchesPath && matchesVerb
  })

  if (matchingRoutes.length === 0) {
    return undefined
  }

  // Use the most specific route (longest path pattern)
  const matchingRoute = matchingRoutes.reduce((a, b) =>
    b.pattern.source.length > a.pattern.source.length ? b : a
  )

  return matchingRoute
}

/**
 * Creates a payment middleware factory for Express
 * @param {string} payTo - The BCH address to receive payments
 * @param {Object} routes - Configuration for protected routes and their payment requirements
 * @param {Object} facilitator - Optional configuration for the payment facilitator service
 * @returns {Function} An Express middleware handler
 */
export function paymentMiddleware (payTo, routes, facilitator) {
  const x402Version = 1

  // Pre-compile route patterns to regex and extract verbs
  const routePatterns = computeRoutePatterns(routes)

  return async function paymentMiddleware (req, res, next) {
    const matchingRoute = findMatchingRoute(routePatterns, req.path, req.method.toUpperCase())

    if (!matchingRoute) {
      return next()
    }

    const { price, network, config = {} } = matchingRoute.config
    console.log('paymentMiddleware() price:', price)
    const {
      description = '',
      mimeType = '',
      maxTimeoutSeconds = 60,
      discoverable = true
    } = config

    // Hardcode maxAmountRequired for now (can be made configurable later)
    const minAmountRequired = 1000 // 1000 satoshis

    // Construct resource URL from request
    const resource = `${req.protocol}://${req.headers.host}${req.path}`

    // Build payment requirements object
    const paymentRequirements = [{
      scheme: 'utxo',
      network: network || 'bch',
      minAmountRequired,
      resource,
      description,
      mimeType,
      payTo,
      maxTimeoutSeconds,
      asset: '0x0000000000000000000000000000000000000001',
      outputSchema: {
        input: {
          type: 'http',
          method: req.method.toUpperCase(),
          discoverable
        }
      },
      extra: {}
    }]

    // Check for X-PAYMENT header
    const payment = req.header('X-PAYMENT')

    if (!payment) {
      console.log(`Returning 402 with these payment requirements in the X-PAYMENT header: ${JSON.stringify(paymentRequirements, null, 2)}`)

      // Return 402 with payment requirements
      res.status(402).json({
        x402Version,
        error: 'X-PAYMENT header is required',
        accepts: paymentRequirements
      })
      return
    }

    // Parse X-PAYMENT header (BCH uses JSON string, not base64 like EVM)
    let decodedPayment
    try {
      decodedPayment = JSON.parse(payment)

      // Validate required fields
      if (!decodedPayment.x402Version || !decodedPayment.scheme || !decodedPayment.network || !decodedPayment.payload) {
        throw new Error('Missing required fields in payment payload')
      }

      // Ensure x402Version is set
      decodedPayment.x402Version = x402Version
    } catch (error) {
      console.error('Error parsing X-PAYMENT header:', error)
      res.status(402).json({
        x402Version,
        error: error.message || 'Invalid or malformed payment header',
        accepts: paymentRequirements
      })
      return
    }

    // Find matching payment requirements based on scheme and network
    const selectedPaymentRequirements = paymentRequirements.find(req => {
      return req.scheme === decodedPayment.scheme && req.network === decodedPayment.network
    })

    if (!selectedPaymentRequirements) {
      res.status(402).json({
        x402Version,
        error: 'Unable to find matching payment requirements',
        accepts: paymentRequirements
      })
      return
    }

    // Get facilitator URL (default to localhost:4040 if not provided)
    const facilitatorUrl = facilitator?.url || 'http://localhost:4040/facilitator'

    const url = `${facilitatorUrl}/verify`
    console.log('facilitator URL:', url)

    // Call facilitator /verify endpoint
    try {
      const verifyResponse = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          x402Version,
          paymentPayload: decodedPayment,
          paymentRequirements: selectedPaymentRequirements
        })
      })
      console.log('verifyResponse:', verifyResponse)

      if (!verifyResponse.ok) {
        throw new Error(`Facilitator verification failed: ${verifyResponse.status} ${verifyResponse.statusText}`)
      }

      const verificationResult = await verifyResponse.json()

      // Handle verification response
      if (!verificationResult.isValid) {
        res.status(402).json({
          x402Version,
          error: verificationResult.invalidReason || 'Payment verification failed',
          accepts: paymentRequirements,
          payer: verificationResult.payer || ''
        })
        return
      }

      // Payment verified successfully - continue to next middleware
      console.log('Payment verified successfully for payer:', verificationResult.payer)
    } catch (error) {
      console.error('Error during payment verification:', error)
      res.status(402).json({
        x402Version,
        error: error.message || 'Payment verification failed',
        accepts: paymentRequirements
      })
      return
    }

    // Continue to the next middleware or route handler
    next()
  }
}
