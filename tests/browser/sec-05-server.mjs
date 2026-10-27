import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve("dist/public");
const testPage = path.resolve("tests/browser/sec-05.html");
let offline = false;
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost:4174");
  if (request.method === "POST" && url.pathname === "/__test/online") {
    offline = false;
    response.writeHead(204).end();
    return;
  }
  if (request.method === "POST" && url.pathname === "/__test/offline") {
    offline = true;
    response.writeHead(204).end();
    return;
  }
  if (offline) {
    request.socket.destroy();
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    if (url.pathname === "/api/offline") {
      request.socket.destroy();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ source: "network" }));
    return;
  }

  if (url.pathname === "/assets/sec05-offline.css") {
    response.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
    response.end("/* cached static fixture */");
    return;
  }

  const candidate = url.pathname === "/sec05-browser-test.html"
    ? testPage
    : path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
  if (candidate !== testPage && candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    response.writeHead(400).end("Bad path");
    return;
  }
  try {
    const info = await stat(candidate);
    const file = info.isDirectory() ? path.join(candidate, "index.html") : candidate;
    response.writeHead(200, { "Content-Type": mimeTypes[path.extname(file)] ?? "application/octet-stream" });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
}).listen(4174, "127.0.0.1", () => {
  console.log("SEC-05 browser fixture: http://localhost:4174/sec05-browser-test.html");
});
