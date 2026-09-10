export const PALEODEM_MIN_AGE_MA = 0;
export const PALEODEM_MAX_AGE_MA = 540;
export const PALEODEM_STEP_MA = 5;

/** Source-authored PaleoDEM v2 frames; narrative chapters remain a separate catalog. */
export const PALEODEM_AGES = Object.freeze(
  Array.from(
    { length: (PALEODEM_MAX_AGE_MA - PALEODEM_MIN_AGE_MA) / PALEODEM_STEP_MA + 1 },
    (_, index) => PALEODEM_MIN_AGE_MA + index * PALEODEM_STEP_MA,
  ),
);

export interface PaleodemAgeBracket {
  requestedAgeMa: number;
  youngerAgeMa: number;
  olderAgeMa: number;
  fraction: number;
  exact: boolean;
}

/** Resolve the two source-authored frames surrounding an age on the Ma axis. */
export function resolvePaleodemAgeBracket(ageMa: number): PaleodemAgeBracket {
  if (!Number.isFinite(ageMa)) throw new RangeError("ageMa must be finite");
  const requestedAgeMa = Math.max(PALEODEM_MIN_AGE_MA, Math.min(PALEODEM_MAX_AGE_MA, ageMa));
  const youngerAgeMa = Math.floor(requestedAgeMa / PALEODEM_STEP_MA) * PALEODEM_STEP_MA;
  const olderAgeMa = Math.ceil(requestedAgeMa / PALEODEM_STEP_MA) * PALEODEM_STEP_MA;
  const exact = youngerAgeMa === olderAgeMa;
  return {
    requestedAgeMa,
    youngerAgeMa,
    olderAgeMa,
    fraction: exact ? 0 : (requestedAgeMa - youngerAgeMa) / (olderAgeMa - youngerAgeMa),
    exact,
  };
}

export function nearestPaleodemAge(ageMa: number): number {
  const bounded = Math.max(PALEODEM_MIN_AGE_MA, Math.min(PALEODEM_MAX_AGE_MA, ageMa));
  return Math.round(bounded / PALEODEM_STEP_MA) * PALEODEM_STEP_MA;
}

export const PALEODEM_HEADER_BYTES = 16;
export const PALEODEM_WIDTH = 360;
export const PALEODEM_HEIGHT = 181;

export interface PaleodemElevationAsset {
  readonly ageMa: number;
  readonly width: number;
  readonly height: number;
  readonly elevation: Float32Array;
}

/** Decode a pinned runtime PaleoDEM v2 int16 grid (EHPD little-endian). */
export function decodePaleodemElevation(ageMa: number, buffer: ArrayBuffer): PaleodemElevationAsset {
  const expectedBytes = PALEODEM_HEADER_BYTES + PALEODEM_WIDTH * PALEODEM_HEIGHT * 2;
  if (buffer.byteLength !== expectedBytes) {
    throw new Error(`PaleoDEM ${ageMa} Ma byte length is invalid`);
  }
  const view = new DataView(buffer);
  if (
    view.getUint8(0) !== 0x45 || view.getUint8(1) !== 0x48 ||
    view.getUint8(2) !== 0x50 || view.getUint8(3) !== 0x44 ||
    view.getUint16(4, true) !== 1 || view.getUint16(6, true) !== ageMa ||
    view.getUint16(8, true) !== PALEODEM_WIDTH ||
    view.getUint16(10, true) !== PALEODEM_HEIGHT || view.getUint32(12, true) !== 0
  ) throw new Error(`PaleoDEM ${ageMa} Ma header is invalid`);
  const elevation = new Float32Array(PALEODEM_WIDTH * PALEODEM_HEIGHT);
  for (let index = 0; index < elevation.length; index += 1) {
    elevation[index] = view.getInt16(PALEODEM_HEADER_BYTES + index * 2, true);
  }
  return { ageMa, width: PALEODEM_WIDTH, height: PALEODEM_HEIGHT, elevation };
}

export function paleodemAssetUrl(ageMa: number, baseURI = document.baseURI): string {
  return new URL(`data/paleodem-${ageMa}ma.bin`, baseURI).toString();
}

export async function fetchPaleodemElevation(
  ageMa: number,
  baseURI = document.baseURI,
  signal?: AbortSignal,
): Promise<PaleodemElevationAsset> {
  const nearest = nearestPaleodemAge(ageMa);
  const response = await fetch(paleodemAssetUrl(nearest, baseURI), { signal });
  if (!response.ok) throw new Error(`Could not load PaleoDEM at ${nearest} Ma (${response.status})`);
  return decodePaleodemElevation(nearest, await response.arrayBuffer());
}
