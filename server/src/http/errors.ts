export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new ApiError(400, 'BAD_REQUEST', message, details);
export const unprocessable = (message: string, details?: unknown) => new ApiError(422, 'UNPROCESSABLE', message, details);
export const notFound = (what = 'Resource') => new ApiError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (message: string, details?: unknown) => new ApiError(409, 'CONFLICT', message, details);
export const unauthorized = (message = 'Authentication required') => new ApiError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission to perform this action') => new ApiError(403, 'FORBIDDEN', message);

/** Standard error response body (documented in OpenAPI). */
export interface ErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}
