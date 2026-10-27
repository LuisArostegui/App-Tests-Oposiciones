import type { RequestHandler } from "express";

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function originFromUrl(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

export function createSameOriginGuard(appUrl?: string): RequestHandler {
  const configuredOrigin = appUrl?.trim() ? originFromUrl(appUrl.trim()) : undefined;
  if (appUrl?.trim() && !configuredOrigin) {
    throw new Error("APP_URL must be a valid absolute URL");
  }

  return (req, res, next) => {
    if (!unsafeMethods.has(req.method) || !req.path.startsWith("/api/")) return next();

    const expectedOrigin = configuredOrigin ?? `${req.protocol}://${req.get("host")}`;
    const originHeader = req.get("origin");
    const refererHeader = req.get("referer");
    const sourceOrigin = originHeader
      ? (originFromUrl(originHeader) === originHeader ? originHeader : undefined)
      : refererHeader ? originFromUrl(refererHeader) : undefined;

    if (!sourceOrigin || sourceOrigin !== expectedOrigin) {
      return res.status(403).json({ message: "Origen de solicitud no válido" });
    }

    return next();
  };
}

export function createAuthRateLimiter(maxAttempts: number, windowMs: number): RequestHandler {
  const attemptsByIp = new Map<string, number[]>();
  let lastCleanup = Date.now();

  return (req, res, next) => {
    const now = Date.now();
    if (now - lastCleanup >= Math.min(windowMs, 60_000)) {
      attemptsByIp.forEach((attempts, ip) => {
        const activeAttempts = attempts.filter((timestamp) => timestamp > now - windowMs);
        if (activeAttempts.length) attemptsByIp.set(ip, activeAttempts);
        else attemptsByIp.delete(ip);
      });
      lastCleanup = now;
    }

    // req.ip respects Express's explicitly configured trusted proxy hops.
    const clientIp = req.ip || req.socket.remoteAddress || "unknown";
    const activeAttempts = (attemptsByIp.get(clientIp) ?? [])
      .filter((timestamp) => timestamp > now - windowMs);

    if (activeAttempts.length >= maxAttempts) {
      const retryAfter = Math.max(1, Math.ceil((activeAttempts[0]! + windowMs - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ message: "Demasiados intentos. Inténtalo de nuevo más tarde." });
    }

    activeAttempts.push(now);
    attemptsByIp.set(clientIp, activeAttempts);
    return next();
  };
}
