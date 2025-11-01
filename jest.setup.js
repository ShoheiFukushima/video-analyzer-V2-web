import '@testing-library/jest-dom'
import fetch, { Headers, Request, Response } from 'cross-fetch'

// Polyfill fetch for Jest environment
global.fetch = fetch
global.Headers = Headers
global.Request = Request
global.Response = Response

// Polyfill TextDecoder/TextEncoder for Jest environment
if (typeof global.TextDecoder === 'undefined') {
  const { TextDecoder, TextEncoder } = require('util')
  global.TextDecoder = TextDecoder
  global.TextEncoder = TextEncoder
}
