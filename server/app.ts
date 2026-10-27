import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { createServer } from "node:http";
import { registerRoutes } from "./routes";
import { passport } from "./auth";
import { pool } from "./db";
import { getSessionSecret, getTrustedProxyHops, isRequestLoggingEnabled } from "./config";
import { apiErrorHandler, createRequestLogger } from "./http-middleware";
import { createAuthRateLimiter, createSameOriginGuard } from "./security-middleware";

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

export async function createApplication(environment: NodeJS.ProcessEnv = process.env) {
  const sessionSecret = getSessionSecret(environment);
  const trustProxyHops = getTrustedProxyHops(environment);
  const requestLoggingEnabled = isRequestLoggingEnabled(environment);
  const sameOriginGuard = createSameOriginGuard(environment.APP_URL);

  const app = express();
  app.set("trust proxy", trustProxyHops);
  app.locals.secureSessionCookie = environment.NODE_ENV === "production";
  const httpServer = createServer(app);

  app.use(createRequestLogger(requestLoggingEnabled));
  app.use(express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }));
  app.use(express.urlencoded({ extended: false }));

  const PgSession = connectPgSimple(session);
  app.use(session({
    store: new PgSession({
      pool,
      tableName: "session",
      createTableIfMissing: true,
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: environment.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  }));

  app.use(passport.initialize());
  app.use(passport.session());
  app.use(sameOriginGuard);

  await registerRoutes(httpServer, app);
  app.use(apiErrorHandler);

  return { app, server: httpServer };
}
