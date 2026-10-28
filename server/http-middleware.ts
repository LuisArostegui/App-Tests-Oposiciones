import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

export function createRequestLogger(enabled = true): RequestHandler {
  return (req, res, next) => {
    if (!enabled) return next();

    const startedAt = Date.now();

    res.on("finish", () => {
      if (req.path.startsWith("/api")) {
        const route = typeof req.route?.path === "string" && req.route.path.startsWith("/api")
          ? req.route.path
          : "/api/*";
        console.log(`${req.method} ${route} ${res.statusCode} in ${Date.now() - startedAt}ms`);
      }
    });

    next();
  };
}

export const requestLogger = createRequestLogger();

export function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function getRequestErrorType(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "type" in error && typeof error.type === "string"
    ? error.type
    : undefined;
}

export const apiErrorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  const requestErrorType = getRequestErrorType(error);
  if (["entity.parse.failed", "request.size.invalid", "request.aborted"].includes(requestErrorType ?? "")) {
    const isImport = req.path === "/api/tests/import";
    return res.status(400).json({ message: isImport ? "JSON mal formado. Revisa el archivo e inténtalo de nuevo." : "Solicitud no válida" });
  }
  if (error instanceof ZodError) {
    return res.status(400).json({ message: "Solicitud no válida" });
  }
  if (requestErrorType === "entity.too.large") {
    return res.status(413).json({ message: "El cuerpo de la solicitud es demasiado grande" });
  }
  if (["charset.unsupported", "encoding.unsupported"].includes(requestErrorType ?? "")) {
    return res.status(415).json({ message: "Formato de solicitud no admitido" });
  }

  console.error("API request failed with an internal error");
  return res.status(500).json({ message: "Error interno del servidor" });
};
