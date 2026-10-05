/// <reference lib="webworker" />
// The generate worker: a shell around generateJob.ts.
import { createGenerateJob } from "./generateJob.ts";
import type { ToGen } from "./protocol.ts";

declare const self: DedicatedWorkerGlobalScope;

// Lets queued messages (a stop, a newer start) run between lines. A MessageChannel task is used instead of
// setTimeout(0), which browsers clamp to 4 ms once it nests (DECISIONS D-27).
const channel = new MessageChannel();
const waiting: (() => void)[] = [];
channel.port1.onmessage = () => waiting.shift()?.();
const pause = () => new Promise<void>((resolve) => {
  waiting.push(resolve);
  channel.port2.postMessage(0);
});

const handle = createGenerateJob({
  post: (msg, transfer = []) => self.postMessage(msg, transfer),
  pause,
  now: () => performance.now(),
});

self.onmessage = (e: MessageEvent<ToGen>) => handle(e.data);
