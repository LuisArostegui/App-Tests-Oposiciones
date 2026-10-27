import path from "node:path";
import dotenv from "dotenv";

function resolveEnvPath(): string {
  const entryDir = process.argv[1] ? path.dirname(process.argv[1]) : process.cwd();
  return path.resolve(entryDir, "..", ".env");
}

dotenv.config({ path: resolveEnvPath() });

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

async function startServer(): Promise<void> {
  const { createApplication } = await import("./app");
  const { app, server } = await createApplication();

  if (process.env.NODE_ENV === "production") {
    const { serveStatic } = await import("./static");
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(server, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen({ port, host: "0.0.0.0" }, () => {
    log(`serving on port ${port}`);
  });
}

startServer().catch((error: unknown) => {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  log(`Application startup failed (${errorType})`, "startup");
  process.exitCode = 1;
});
