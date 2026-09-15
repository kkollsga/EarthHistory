/**
 * Module worker that decodes, ear-clips and refines one EHPR v1 payload.
 *
 * Triangulating the worst measured interval on the main thread would cost a
 * visible stall in the middle of a scrub, so the whole pass happens here and
 * only typed arrays cross back, transferred rather than copied. The decision
 * logic lives in `palaeoTriangulate.ts` so the same code path is what the
 * main-thread fallback and the unit tests run.
 */

import { handlePalaeoTriangulationRequest, type PalaeoTriangulationRequest } from "./palaeoTriangulate";

self.onmessage = (event: MessageEvent<PalaeoTriangulationRequest>) => {
  const { response, transfer } = handlePalaeoTriangulationRequest(event.data);
  (self as unknown as Worker).postMessage(response, transfer as Transferable[]);
};
