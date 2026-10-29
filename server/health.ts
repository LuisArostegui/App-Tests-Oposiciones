import type { RequestHandler } from "express";

export function createHealthHandler(checkDatabase: () => Promise<unknown>): RequestHandler {
  return async (_request, response) => {
    try {
      await checkDatabase();
      return response.status(200).json({ status: "ok" });
    } catch {
      return response.status(503).json({ status: "unavailable" });
    }
  };
}
