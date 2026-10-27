export const config = {
  app: {
    name: process.env.APP_NAME || "OposTest Pro",
    description: process.env.APP_DESCRIPTION || "Preparación de oposiciones",
    welcomeMessage: process.env.WELCOME_MESSAGE || "Preparando tu entorno de estudio...",
  },
  server: {
    port: parseInt(process.env.PORT || "5000", 10),
    nodeEnv: process.env.NODE_ENV || "development",
  },
};

const developmentSessionSecret = "opostest-development-session-secret-not-for-production";
const placeholderSecretPattern = /(default-secret-change-me|cambia[_ -]?esto|change[_ -]?this|replace[_ -]?with|your[_ -]?secret|placeholder)/i;

export function getSessionSecret(environment: NodeJS.ProcessEnv = process.env): string {
  const nodeEnv = environment.NODE_ENV ?? "development";
  const configuredSecret = environment.SESSION_SECRET?.trim();

  if (nodeEnv !== "production") {
    return configuredSecret || developmentSessionSecret;
  }

  if (!configuredSecret || configuredSecret === developmentSessionSecret || configuredSecret.length < 32
    || new Set(configuredSecret).size < 16 || placeholderSecretPattern.test(configuredSecret)) {
    throw new Error("SESSION_SECRET must be set to a strong, unique value of at least 32 characters in production");
  }

  return configuredSecret;
}

export function getTrustedProxyHops(environment: NodeJS.ProcessEnv = process.env): number {
  const value = environment.TRUST_PROXY_HOPS ?? "0";
  if (!/^\d+$/.test(value)) {
    throw new Error("TRUST_PROXY_HOPS must be a whole number between 0 and 10");
  }
  const hops = Number(value);
  if (hops > 10) {
    throw new Error("TRUST_PROXY_HOPS must be a whole number between 0 and 10");
  }
  return hops;
}

export function isRequestLoggingEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  const value = environment.REQUEST_LOGGING_ENABLED;
  if (value === undefined || value.trim() === "") return true;
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  throw new Error("REQUEST_LOGGING_ENABLED must be true or false");
}

export function isRegistrationEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  const value = environment.REGISTRATION_ENABLED?.trim();
  if (value === undefined || value === "") return environment.NODE_ENV !== "production";
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  throw new Error("REGISTRATION_ENABLED must be true or false");
}

export type AppConfig = typeof config.app;
