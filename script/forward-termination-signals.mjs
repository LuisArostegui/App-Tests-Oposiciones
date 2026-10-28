export function forwardTerminationSignals(child, signalSource = process) {
  let forwardedSignal = null;

  for (const signal of ["SIGINT", "SIGTERM"]) {
    signalSource.on(signal, () => {
      if (forwardedSignal || child.exitCode !== null || child.signalCode !== null) return;
      forwardedSignal = signal;
      child.kill(signal);
    });
  }
}
