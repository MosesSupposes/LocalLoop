export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code = 'error',
    public detail?: unknown,
  ) {
    super(message)
  }
}

export const badRequest = (message: string, detail?: unknown) =>
  new HttpError(400, message, 'bad_request', detail)
export const unauthorized = (message = 'Sign in to continue') =>
  new HttpError(401, message, 'unauthorized')
export const forbidden = (message = 'Not allowed') => new HttpError(403, message, 'forbidden')
export const notFound = (message = 'Not found') => new HttpError(404, message, 'not_found')
export const conflict = (message: string, detail?: unknown) =>
  new HttpError(409, message, 'conflict', detail)
export const tooMany = (message = 'Too many requests, slow down') =>
  new HttpError(429, message, 'rate_limited')
