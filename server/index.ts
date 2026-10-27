import path from "path";
import dotenv from "dotenv";

// Resolve .env path (works in both ESM/tsx and CJS/esbuild bundle)
function resolveEnvPath(): string {
  // process.argv[1] is the entry script path in both environments
  const entryDir = process.argv[1]
    ? path.dirname(process.argv[1])
    : process.cwd();
  // In production: dist/index.cjs -> go up one level to find .env
  // In development: server/index.ts -> go up one level to find .env
  return path.resolve(entryDir, "..", ".env");
}

dotenv.config({ path: resolveEnvPath() });

import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { passport } from "./auth";
import { pool } from "./db";
import { apiErrorHandler, requestLogger } from "./http-middleware";

const app = express();
app.use(requestLogger);

// Trust proxy for HTTPS behind Nginx/reverse proxy (required for secure cookies)
app.set("trust proxy", 1);

const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

const PgSession = connectPgSimple(session);

app.use(
  session({
    store: new PgSession({
      pool: pool,
      tableName: "session",
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || "default-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  }),
);

app.use(passport.initialize());
app.use(passport.session());

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

(async () => {
  await registerRoutes(httpServer, app);

  app.use(apiErrorHandler);

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
