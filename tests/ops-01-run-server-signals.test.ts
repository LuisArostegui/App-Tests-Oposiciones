import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { spawn } from "node:child_process";
import test from "node:test";
import { forwardTerminationSignals } from "../script/forward-termination-signals.mjs";

test("OPS-01: forwards SIGTERM to the server child once", () => {
  const parent = new EventEmitter();
  const forwarded: string[] = [];
  const child = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill: (signal: NodeJS.Signals) => {
      forwarded.push(signal);
      return true;
    },
  });

  forwardTerminationSignals(child, parent);
  parent.emit("SIGTERM");
  parent.emit("SIGTERM");

  assert.deepEqual(forwarded, ["SIGTERM"]);
});

test("OPS-01: forwards SIGINT and leaves an already exited child alone", () => {
  const parent = new EventEmitter();
  const forwarded: string[] = [];
  const child = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill: (signal: NodeJS.Signals) => {
      forwarded.push(signal);
      return true;
    },
  });

  forwardTerminationSignals(child, parent);
  parent.emit("SIGINT");
  assert.deepEqual(forwarded, ["SIGINT"]);

  const exitedChild = Object.assign(new EventEmitter(), {
    exitCode: 0 as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill: (signal: NodeJS.Signals) => {
      forwarded.push(signal);
      return true;
    },
  });
  forwardTerminationSignals(exitedChild, parent);
  parent.emit("SIGTERM");
  assert.deepEqual(forwarded, ["SIGINT"]);
});

test("OPS-01: a real child handles the forwarded SIGTERM and exits", {
  skip: process.platform === "win32",
  timeout: 5_000,
}, async (context) => {
  const child = spawn(process.execPath, ["-e", `
    process.on("SIGTERM", () => process.exit(0));
    process.stdout.write("ready\\n");
    setInterval(() => {}, 1_000);
  `], { stdio: ["ignore", "pipe", "inherit"] });
  context.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });

  await once(child.stdout!, "data");
  const parent = new EventEmitter();
  forwardTerminationSignals(child, parent);
  parent.emit("SIGTERM");

  const [exitCode, exitSignal] = await once(child, "exit") as [number | null, NodeJS.Signals | null];
  assert.equal(exitCode, 0);
  assert.equal(exitSignal, null);
});
