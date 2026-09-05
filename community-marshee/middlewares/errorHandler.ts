import { Request, Response, NextFunction } from "express";

interface AppError extends Error {
  statusCode?: number;
  details?: unknown;
}

// Centralized Express error-handling middleware.
// All unhandled errors should flow through here so we can:
// - Log once
// - Map to an HTTP status code
// - Return a consistent JSON response shape
export function errorHandler(
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  const isProd = process.env.NODE_ENV === "production";

  // Default values
  let statusCode = err.statusCode && Number.isInteger(err.statusCode)
    ? err.statusCode
    : 500;

  let message =
    err.message && typeof err.message === "string"
      ? err.message
      : "Internal server error";

  // Handle some common error types explicitly to avoid leaking internals
  // while still returning useful messages.
  const errorName = err.name;

  if (errorName === "ValidationError") {
    statusCode = 400;
    message = message || "Validation failed.";
  }

  if (errorName === "CastError") {
    statusCode = 400;
    message = "Invalid identifier format.";
  }

  // JWT / auth-related errors
  if (
    errorName === "JsonWebTokenError" ||
    errorName === "TokenExpiredError"
  ) {
    statusCode = 401;
    message = "Invalid or expired authentication token.";
  }

  // Log error once centrally
  // In production, this could later be routed to a logging service.
  // eslint-disable-next-line no-console
  console.error("Unhandled error:", {
    name: err.name,
    message: err.message,
    stack: err.stack,
  });

  const responseBody: {
    success: false;
    message: string;
    error?: unknown;
  } = {
    success: false,
    message,
  };

  // Only include detailed error info when not in production
  if (!isProd) {
    responseBody.error = {
      name: err.name,
      details: err.details,
    };
  }

  res.status(statusCode).json(responseBody);
}

