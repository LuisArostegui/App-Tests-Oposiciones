import { request } from "node:http";

function shutDownOwnedFixture(port, owner) {
  return new Promise((resolve, reject) => {
    const req = request({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/__test/shutdown",
      headers: { "x-test-run-id": owner },
    }, (res) => {
      res.resume();
      res.on("end", () => {
        if (res.statusCode === 204 || res.statusCode === 403 || res.statusCode === 404) {
          resolve();
          return;
        }
        reject(new Error(`El fixture de navegador en ${port} rechazó el cierre (${res.statusCode ?? "sin estado"}).`));
      });
    });

    req.setTimeout(5_000, () => req.destroy(new Error(`El fixture de navegador en ${port} no respondió al cierre.`)));
    req.on("error", (error) => {
      if (error.code === "ECONNREFUSED") {
        resolve();
        return;
      }
      reject(error);
    });
    req.end();
  });
}

export default async function teardown() {
  const owner = process.env.BROWSER_FIXTURE_OWNER;
  if (!owner) throw new Error("Falta el identificador para cerrar los fixtures de navegador.");
  const outcomes = await Promise.allSettled([
    shutDownOwnedFixture(4174, owner),
    shutDownOwnedFixture(4175, owner),
  ]);
  const errors = outcomes.filter((outcome) => outcome.status === "rejected").map((outcome) => outcome.reason);
  if (errors.length > 0) throw new AggregateError(errors, "No se pudieron cerrar limpiamente los fixtures de navegador.");
}
