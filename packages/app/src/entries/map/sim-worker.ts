import { captureWorkerFaults, type FaultScope } from '../../session/worker/fault-capture.js';
import { endpointPort, type MessageEndpoint } from '../../session/worker/port.js';
import { serveSession } from '../../session/worker/serve.js';
import { buildMapWorkerWorld } from './world-inputs.js';

// A dedicated worker's global scope posts and listens as its `Worker` does from the other side; the
// DOM typings the app compiles against describe a window instead.
const scope = globalThis as unknown as MessageEndpoint & FaultScope & { close(): void };
const port = endpointPort(scope, () => scope.close());
captureWorkerFaults(scope, (message) => port.post(message));
serveSession(port, buildMapWorkerWorld);
