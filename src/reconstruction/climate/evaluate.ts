import type { ClimateCancellation, ClimateGeographyInput, ClimatePotentialControls,
  ClimatePotentialField, SurfaceCell, WindBand } from "./types";

const OUTPUT_ARRAYS_PER_CELL = 1 + 4 * 4;
// Spherical area mean of (abs(latitude) / 90)^1.3. Keeps the declared global
// mean centered while the latitude curve redistributes heat poleward/equatorward.
const LATITUDE_COOLING_AREA_MEAN = 0.29171897123760065;

function abortError(): DOMException {
  return new DOMException("climate potential revision canceled or stale", "AbortError");
}

function checkCurrent(cancellation?: ClimateCancellation): void {
  if (cancellation?.signal?.aborted || cancellation?.isCurrentRevision?.() === false) throw abortError();
}

function windAt(latitude: number, bands: readonly WindBand[]): WindBand {
  const band = bands.find((candidate) => latitude >= candidate.minimumLatitude && latitude <= candidate.maximumLatitude);
  if (!band) throw new Error("climate controls do not cover every latitude");
  return band;
}

function validate(input: ClimateGeographyInput, controls: ClimatePotentialControls): number {
  if (!input.revisionIdentity || !Number.isFinite(input.requestedAgeMa) || input.requestedAgeMa < 0 ||
      input.requestedAgeMa > 1_800 || !Number.isInteger(input.width) || !Number.isInteger(input.height) ||
      input.width < 2 || input.height < 2 || input.width > 360 || input.height > 181) {
    throw new Error("invalid climate geography identity or dimensions");
  }
  const cells = input.width * input.height;
  if (!Number.isSafeInteger(controls.maximumCells) || controls.maximumCells < 1 ||
      !Number.isSafeInteger(controls.maximumOutputBytes) || controls.maximumOutputBytes < 1 ||
      cells > controls.maximumCells || input.surface.length !== cells || input.elevationMetres.length !== cells ||
      cells * OUTPUT_ARRAYS_PER_CELL > controls.maximumOutputBytes) {
    throw new Error("climate field allocation bound exceeded");
  }
  if (!Number.isInteger(controls.maximumUpwindSteps) || controls.maximumUpwindSteps < 1 ||
      controls.maximumUpwindSteps > 32 || !Number.isFinite(controls.globalMeanTemperatureC) ||
      !Number.isFinite(controls.equatorToPoleTemperatureC) || controls.equatorToPoleTemperatureC < 0 ||
      !Number.isFinite(controls.lapseRateCPerKm) || controls.lapseRateCPerKm < 0 ||
      !Number.isFinite(controls.landDryingPerStep) || controls.landDryingPerStep < 0 ||
      !Number.isFinite(controls.orographicMoistureLossPerKm) || controls.orographicMoistureLossPerKm < 0 ||
      !Number.isFinite(controls.snowTemperatureThresholdC) ||
      !Number.isFinite(controls.biologyCapacity) || controls.biologyCapacity < 0 || controls.biologyCapacity > 1 ||
      controls.windBands.length === 0 || controls.evidence.sourceIds.length === 0 ||
      controls.evidence.methodId !== "schematic-geographic-climate-v1" ||
      controls.evidence.methodVersion !== 1 || controls.evidence.status !== "procedural-synthesis" ||
      controls.evidence.sourceIds.some((sourceId) => sourceId.length === 0) ||
      controls.evidence.limitations.some((limitation) => limitation.length === 0)) {
    throw new Error("invalid climate potential controls");
  }
  for (const band of controls.windBands) {
    if (!Number.isFinite(band.minimumLatitude) || !Number.isFinite(band.maximumLatitude) ||
        band.minimumLatitude < -90 || band.maximumLatitude > 90 ||
        band.minimumLatitude > band.maximumLatitude || ![-1, 0, 1].includes(band.zonal) ||
        ![-1, 0, 1].includes(band.meridional)) {
      throw new Error("invalid climate wind band");
    }
  }
  for (let row = 0; row < input.height; row += 1) {
    windAt(90 - row * 180 / (input.height - 1), controls.windBands);
  }
  for (const value of input.surface) {
    if (value !== 0 && value !== 1 && value !== 2) throw new Error("invalid climate surface classification");
  }
  for (const row of [0, input.height - 1]) {
    const surface = input.surface[row * input.width];
    const elevation = input.elevationMetres[row * input.width];
    for (let column = 1; column < input.width; column += 1) {
      const candidateElevation = input.elevationMetres[row * input.width + column];
      const sameElevation = elevation === candidateElevation ||
        (Number.isNaN(elevation) && Number.isNaN(candidateElevation));
      if (input.surface[row * input.width + column] !== surface || !sameElevation) {
        throw new Error("climate pole rows must use one canonical surface and elevation");
      }
    }
  }
  return cells;
}

function copyEvidence(controls: ClimatePotentialControls) {
  return Object.freeze({
    sourceIds: Object.freeze([...controls.evidence.sourceIds]),
    methodId: controls.evidence.methodId,
    methodVersion: controls.evidence.methodVersion,
    status: controls.evidence.status,
    limitations: Object.freeze([...controls.evidence.limitations]),
  });
}

function temperature(latitude: number, elevationMetres: number, controls: ClimatePotentialControls): number {
  const latitudeShape = Math.pow(Math.abs(latitude) / 90, 1.3);
  const latitudeCooling = controls.equatorToPoleTemperatureC *
    (latitudeShape - LATITUDE_COOLING_AREA_MEAN);
  const heightCooling = controls.lapseRateCPerKm * Math.max(0, elevationMetres) / 1_000;
  return controls.globalMeanTemperatureC - latitudeCooling - heightCooling;
}

function upwindMoisture(index: number, input: ClimateGeographyInput, controls: ClimatePotentialControls): number | null {
  const { width, height, surface, elevationMetres } = input;
  let row = Math.floor(index / width);
  let column = index % width;
  const latitude = 90 - row * 180 / (height - 1);
  const wind = windAt(latitude, controls.windBands);
  let moisture = 1;
  let previousElevation = Math.max(0, elevationMetres[index]!);
  for (let step = 1; step <= controls.maximumUpwindSteps; step += 1) {
    column = (column - wind.zonal + width) % width;
    row = Math.max(0, Math.min(height - 1, row + wind.meridional));
    const sourceIndex = row * width + column;
    const sourceSurface = surface[sourceIndex] as SurfaceCell;
    if (sourceSurface === 0 || !Number.isFinite(elevationMetres[sourceIndex])) return null;
    if (sourceSurface === 1) return Math.max(0, moisture);
    const sourceElevation = Math.max(0, elevationMetres[sourceIndex]!);
    const upwindRiseKm = Math.max(0, sourceElevation - previousElevation) / 1_000;
    moisture -= controls.landDryingPerStep + upwindRiseKm * controls.orographicMoistureLossPerKm;
    previousElevation = sourceElevation;
  }
  return Math.max(0, moisture - controls.landDryingPerStep * controls.maximumUpwindSteps);
}

export function evaluateClimatePotential(
  input: ClimateGeographyInput,
  controls: ClimatePotentialControls,
  cancellation?: ClimateCancellation,
): ClimatePotentialField {
  checkCurrent(cancellation);
  const cells = validate(input, controls);
  const status = new Uint8Array(cells);
  const temperatureC = new Float32Array(cells);
  const moisturePotential = new Float32Array(cells);
  const snowPotential = new Float32Array(cells);
  const biologyPotential = new Float32Array(cells);
  temperatureC.fill(Number.NaN);
  moisturePotential.fill(Number.NaN);
  snowPotential.fill(Number.NaN);
  biologyPotential.fill(Number.NaN);

  for (let row = 0; row < input.height; row += 1) {
    checkCurrent(cancellation);
    const latitude = 90 - row * 180 / (input.height - 1);
    for (let column = 0; column < input.width; column += 1) {
      const index = row * input.width + column;
      const surface = input.surface[index] as SurfaceCell;
      const elevation = input.elevationMetres[index]!;
      if (surface === 0 || !Number.isFinite(elevation)) continue;
      const localTemperature = temperature(latitude, elevation, controls);
      if (surface === 1) {
        status[index] = 1;
        temperatureC[index] = localTemperature;
        moisturePotential[index] = 1;
        snowPotential[index] = localTemperature <= controls.snowTemperatureThresholdC ? 1 : 0;
        biologyPotential[index] = 0;
        continue;
      }
      const moisture = upwindMoisture(index, input, controls);
      if (moisture === null) continue;
      status[index] = 2;
      temperatureC[index] = localTemperature;
      moisturePotential[index] = moisture;
      snowPotential[index] = Math.max(0, Math.min(1,
        (controls.snowTemperatureThresholdC - localTemperature + 2) / 8));
      biologyPotential[index] = controls.landBiologyEligible
        ? controls.biologyCapacity * moisture * Math.max(0, Math.min(1, (localTemperature + 10) / 25))
        : 0;
    }
  }
  // Longitude is singular at the poles. Column zero is the documented
  // canonical meridian; copy its result so one physical point has one state.
  for (const row of [0, input.height - 1]) {
    const canonical = row * input.width;
    for (let column = 1; column < input.width; column += 1) {
      const index = canonical + column;
      status[index] = status[canonical]!;
      temperatureC[index] = temperatureC[canonical]!;
      moisturePotential[index] = moisturePotential[canonical]!;
      snowPotential[index] = snowPotential[canonical]!;
      biologyPotential[index] = biologyPotential[canonical]!;
    }
  }
  const byteLength = status.byteLength + temperatureC.byteLength + moisturePotential.byteLength +
    snowPotential.byteLength + biologyPotential.byteLength;
  return Object.freeze({
    identity: `${input.revisionIdentity}:climate:${controls.evidence.methodId}@${controls.evidence.methodVersion}`,
    revisionIdentity: input.revisionIdentity,
    requestedAgeMa: input.requestedAgeMa,
    width: input.width,
    height: input.height,
    status,
    temperatureC,
    moisturePotential,
    snowPotential,
    biologyPotential,
    evidence: copyEvidence(controls),
    byteLength,
  });
}
