import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("dist/public");
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const users = {
  "account-a": { id: 1, username: "account-a", tests: [{ id: "account-a-private.json", count: 1, category: "Private A" }] },
  "account-b": { id: 2, username: "account-b", tests: [{ id: "account-b-private.json", count: 1, category: "Private B" }] },
};

function respondJson(response, status, payload, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  response.end(JSON.stringify(payload));
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost:4175");
  const sid = /(?:^|;\s*)sec05sid=([^;]+)/.exec(request.headers.cookie ?? "")?.[1];
  if (url.pathname === "/api/auth/me") {
    const user = users[sid];
    return user ? respondJson(response, 200, { id: user.id, username: user.username }) : respondJson(response, 401, { message: "No autenticado" });
  }
  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    let body = "";
    for await (const chunk of request) body += chunk;
    const { username } = JSON.parse(body);
    const user = users[username];
    if (!user) return respondJson(response, 401, { message: "Credenciales incorrectas" });
    return respondJson(response, 200, { id: user.id, username: user.username }, { "Set-Cookie": `sec05sid=${username}; Path=/; SameSite=Lax` });
  }
  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    return respondJson(response, 200, { message: "Sesión cerrada" }, { "Set-Cookie": "sec05sid=; Path=/; Max-Age=0; SameSite=Lax" });
  }
  if (url.pathname === "/api/tests") {
    const user = users[sid];
    return user ? respondJson(response, 200, user.tests) : respondJson(response, 401, { message: "No autenticado" });
  }
  if (url.pathname.startsWith("/api/")) return respondJson(response, 401, { message: "No autenticado" });

  const candidate = url.pathname === "/" || !path.extname(url.pathname)
    ? path.join(root, "index.html")
    : path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
  if (candidate !== path.join(root, "index.html") && !candidate.startsWith(`${root}${path.sep}`)) {
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
}).listen(4175, "127.0.0.1", () => {
  console.log("SEC-05 app fixture: http://localhost:4175/login");
});
