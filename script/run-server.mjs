import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];

if (mode !== "development" && mode !== "production") {
  console.error("Uso: node script/run-server.mjs <development|production>");
  process.exit(2);
}

const args = mode === "development"
  ? [path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs"), path.join(projectRoot, "server", "index.ts")]
  : [path.join(projectRoot, "dist", "index.cjs")];

const child = spawn(process.execPath, args, {
  cwd: projectRoot,
  env: { ...process.env, NODE_ENV: mode },
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`No se pudo iniciar el servidor: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
