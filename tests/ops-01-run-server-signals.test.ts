import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
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
