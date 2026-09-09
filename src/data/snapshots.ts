import { pointsOfInterest, timeSlices } from "./catalog";
import { tectonicsAt } from "./tectonics";
import type {
  AreaTrackingCatalog,
  AreaTrackingLayer,
  CountryOutline,
  LandPolygon,
  LonLat,
  ModernClimateClass,
  ModernClimateControl,
  SurfaceStage,
  TimeSlice,
  WorldSnapshot,
} from "./types";

interface GeographyAsset {
  ageMa: number;
  land: LandPolygon[];
  countries: CountryOutline[];
  sourceIds: string[];
}

interface ElevationAsset {
  ageMa: number;
  width: number;
  height: number;
  elevation: number[];
}

interface CountryAsset {
  ageMa: number;
  countries: CountryOutline[];
  poiCoordinates: Record<string, [number, number]>;
  referenceFrame: string;
}

interface ModernClimateAsset {
  period: "1991–2020";
  width: number;
  height: number;
  cellSizeDegrees: number;
  longitudeOrigin: number;
  latitudeOrigin: number;
  noDataValue: number;
  encoding: "row-major-rle-value-count";
  runs: Array<[value: number, count: number]>;
  legend: ModernClimateClass[];
  sourceIds: string[];
}

const PALEODEM_AGES = [0, 20, 35, 55, 65, 95, 130, 185, 220, 250, 300, 320, 360, 400, 430, 470, 520, 540] as const;
const elevationAssets = new Map<number, Promise<ElevationAsset>>();
const countryAssets = new Map<number, Promise<CountryAsset>>();
const areaTrackingAssets = new Map<number, Promise<AreaTrackingLayer>>();
let modernGeography: Promise<GeographyAsset> | undefined;
let modernClimateAsset: Promise<ModernClimateAsset> | undefined;
let areaTrackingCatalogAsset: Promise<AreaTrackingCatalog> | undefined;

export function resolveDataAssetUrl(
  path: string,
  baseUri: string | undefined = typeof document === "undefined" ? undefined : document.baseURI,
): string {
  return baseUri === undefined ? path : new URL(path, baseUri).toString();
}

function nearest<T>(values: readonly T[], distance: (value: T) => number): T {
  return values.reduce((best, value) => (distance(value) < distance(best) ? value : best));
}

function loadJson<T>(path: string, clear: () => void): Promise<T> {
  return fetch(resolveDataAssetUrl(path))
    .then(async (response) => {
      if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
      return (await response.json()) as T;
    })
    .catch((error: unknown) => {
      clear();
      throw error;
    });
}

function loadAreaTrackingCatalog(): Promise<AreaTrackingCatalog> {
  areaTrackingCatalogAsset ??= loadJson<AreaTrackingCatalog>(
    "data/country-tracking-catalog.json",
    () => {
      areaTrackingCatalogAsset = undefined;
    },
  ).then((catalog) => {
    if (
      catalog.schemaVersion !== 1 ||
      catalog.coordinateEncoding !== "int16-le-longitude-latitude" ||
      catalog.measure !== "normalized-geodesic-arclength" ||
      !(catalog.coordinateScaleDegrees > 0) ||
      catalog.parts.some((part, index) =>
        part.id !== index || part.feature < 0 || part.feature >= catalog.features.length
      )
    ) {
      areaTrackingCatalogAsset = undefined;
      throw new Error("Invalid country tracking catalog");
    }
    return catalog;
  });
  return areaTrackingCatalogAsset;
}

function decodeAreaTracking(
  ageMa: number,
  catalog: AreaTrackingCatalog,
  buffer: ArrayBuffer,
): AreaTrackingLayer {
  const headerBytes = 16;
  const recordBytes = 8;
  if (buffer.byteLength < headerBytes) throw new Error(`Country tracking ${ageMa} Ma header is truncated`);
  const view = new DataView(buffer);
  if (
    view.getUint8(0) !== 0x45 || view.getUint8(1) !== 0x48 ||
    view.getUint8(2) !== 0x54 || view.getUint8(3) !== 0x52 ||
    view.getUint16(4, true) !== catalog.schemaVersion ||
    view.getUint16(6, true) !== ageMa ||
    view.getUint16(10, true) !== 0
  ) throw new Error(`Country tracking ${ageMa} Ma header does not match its catalog`);
  const partCount = view.getUint16(8, true);
  const pointCount = view.getUint32(12, true);
  const coordinateOffset = headerBytes + partCount * recordBytes;
  const expectedBytes = coordinateOffset + pointCount * 2 * Int16Array.BYTES_PER_ELEMENT;
  if (buffer.byteLength !== expectedBytes) {
    throw new Error(`Country tracking ${ageMa} Ma byte length is invalid`);
  }
  const partIds = new Uint16Array(partCount);
  const pointOffsets = new Uint32Array(partCount + 1);
  let previousPartId = -1;
  let previousOffset = 0;
  for (let index = 0; index < partCount; index += 1) {
    const offset = headerBytes + index * recordBytes;
    const partId = view.getUint16(offset, true);
    const reserved = view.getUint16(offset + 2, true);
    const pointOffset = view.getUint32(offset + 4, true);
    if (
      reserved !== 0 || partId <= previousPartId || partId >= catalog.parts.length ||
      pointOffset < previousOffset || pointOffset >= pointCount
    ) throw new Error(`Country tracking ${ageMa} Ma part table is invalid`);
    partIds[index] = partId;
    pointOffsets[index] = pointOffset;
    previousPartId = partId;
    previousOffset = pointOffset;
  }
  pointOffsets[partCount] = pointCount;
  if (partCount > 0 && pointOffsets[0] !== 0) {
    throw new Error(`Country tracking ${ageMa} Ma first part does not start at zero`);
  }
  for (let index = 0; index < partCount; index += 1) {
    if (pointOffsets[index + 1] - pointOffsets[index] < 2) {
      throw new Error(`Country tracking ${ageMa} Ma contains a degenerate part`);
    }
  }
  const coordinates = new Int16Array(pointCount * 2);
  for (let index = 0; index < coordinates.length; index += 1) {
    coordinates[index] = view.getInt16(coordinateOffset + index * 2, true);
  }
  return {
    ageMa,
    catalog,
    partIds,
    pointOffsets,
    coordinates,
    byteLength: partIds.byteLength + pointOffsets.byteLength + coordinates.byteLength,
  };
}

function loadAreaTracking(ageMa: number): Promise<AreaTrackingLayer> {
  const cached = areaTrackingAssets.get(ageMa);
  if (cached) return cached;
  const pending = Promise.all([
    loadAreaTrackingCatalog(),
    fetch(resolveDataAssetUrl(`data/country-tracking-${ageMa}ma.bin`)).then(async (response) => {
      if (!response.ok) throw new Error(`Could not load country tracking at ${ageMa} Ma (${response.status})`);
      return response.arrayBuffer();
    }),
  ])
    .then(([catalog, buffer]) => decodeAreaTracking(ageMa, catalog, buffer))
    .catch((error: unknown) => {
      areaTrackingAssets.delete(ageMa);
      throw error;
    });
  areaTrackingAssets.set(ageMa, pending);
  return pending;
}

function loadModernGeography(): Promise<GeographyAsset> {
  modernGeography ??= loadJson<GeographyAsset>("data/geography-0ma.json", () => {
    modernGeography = undefined;
  });
  return modernGeography;
}

function loadModernClimate(): Promise<ModernClimateAsset> {
  modernClimateAsset ??= loadJson<ModernClimateAsset>("data/koppen-1991-2020-0p5.json", () => {
    modernClimateAsset = undefined;
  });
  return modernClimateAsset;
}

function decodeModernClimate(asset: ModernClimateAsset): ModernClimateControl {
  if (asset.encoding !== "row-major-rle-value-count") {
    throw new Error(`Unsupported modern climate encoding: ${asset.encoding}`);
  }
  const classes = new Uint8Array(asset.width * asset.height);
  let offset = 0;
  for (const [value, count] of asset.runs) {
    if (!Number.isInteger(value) || value < 0 || value > 30 || !Number.isInteger(count) || count <= 0) {
      throw new Error("Modern climate asset contains an invalid run");
    }
    if (offset + count > classes.length) throw new Error("Modern climate asset exceeds its declared dimensions");
    classes.fill(value, offset, offset + count);
    offset += count;
  }
  if (offset !== classes.length) throw new Error("Modern climate asset does not fill its declared dimensions");
  return {
    period: asset.period,
    width: asset.width,
    height: asset.height,
    cellSizeDegrees: asset.cellSizeDegrees,
    longitudeOrigin: asset.longitudeOrigin,
    latitudeOrigin: asset.latitudeOrigin,
    noDataValue: asset.noDataValue,
    classes,
    legend: asset.legend,
    sourceIds: asset.sourceIds,
  };
}

function loadElevation(ageMa: number): Promise<ElevationAsset> {
  const cached = elevationAssets.get(ageMa);
  if (cached) return cached;
  const pending = loadJson<ElevationAsset>(`data/paleodem-${ageMa}ma.json`, () => {
    elevationAssets.delete(ageMa);
  });
  elevationAssets.set(ageMa, pending);
  return pending;
}

function loadCountries(ageMa: number): Promise<CountryAsset> {
  const cached = countryAssets.get(ageMa);
  if (cached) return cached;
  const pending = loadJson<CountryAsset>(`data/countries-${ageMa}ma.json`, () => {
    countryAssets.delete(ageMa);
  });
  countryAssets.set(ageMa, pending);
  return pending;
}

function closestTimelineSlice(ageMa: number): TimeSlice {
  return nearest(timeSlices, (slice) => Math.abs(slice.ageMa - ageMa));
}

function environmentFor(ageMa: number): WorldSnapshot["environment"] {
  let stage: SurfaceStage = "modern-biomes";
  let vegetation = 1;
  let biomeStage = 1;
  let oceanCoverage = 0.71;
  let cloudCover = 0.64;
  let atmosphereOpacity = 1;
  let haze = 0.05;
  let iceLatitude = 66;
  let iceIntensity = 0.12;
  let temperatureC = 14;

  if (ageMa > 4530) {
    stage = "accretion"; vegetation = 0; biomeStage = 0; oceanCoverage = 0; cloudCover = 0; atmosphereOpacity = 0.2; haze = 0.8; iceLatitude = 90; iceIntensity = 0; temperatureC = 2200;
  } else if (ageMa > 4500) {
    stage = "giant-impact"; vegetation = 0; biomeStage = 0; oceanCoverage = 0; cloudCover = 0.1; atmosphereOpacity = 0.7; haze = 1; iceLatitude = 90; iceIntensity = 0; temperatureC = 1800;
  } else if (ageMa > 4480) {
    stage = "magma-ocean"; vegetation = 0; biomeStage = 0; oceanCoverage = 0.05; cloudCover = 0.25; atmosphereOpacity = 0.9; haze = 0.9; iceLatitude = 90; iceIntensity = 0; temperatureC = 1100;
  } else if (ageMa > 4420) {
    stage = "cooling-crust"; vegetation = 0; biomeStage = 0; oceanCoverage = 0.18; cloudCover = 0.45; atmosphereOpacity = 0.9; haze = 0.7; iceLatitude = 90; iceIntensity = 0; temperatureC = 450;
  } else if (ageMa > 4000) {
    stage = "growing-oceans"; vegetation = 0; biomeStage = 0; oceanCoverage = 0.55; cloudCover = 0.8; atmosphereOpacity = 0.9; haze = 0.5; iceLatitude = 90; iceIntensity = 0; temperatureC = 70;
  } else if (ageMa > 600) {
    stage = "microbial-world"; vegetation = ageMa <= 3500 ? 0.025 : 0; biomeStage = 0.03; oceanCoverage = 0.68; cloudCover = 0.68; atmosphereOpacity = 0.9; haze = ageMa > 2400 ? 0.5 : 0.24; iceLatitude = 72; iceIntensity = 0.08; temperatureC = 24;
  } else if (ageMa > 475) {
    stage = "barren-continents"; vegetation = 0; biomeStage = 0; haze = 0.1; iceLatitude = 72; iceIntensity = 0.08; temperatureC = 20;
  } else if (ageMa > 390) {
    stage = "early-land-plants"; vegetation = 0.08; biomeStage = 0.12; haze = 0.08; iceLatitude = 67; iceIntensity = 0.12; temperatureC = 18;
  } else if (ageMa > 130) {
    stage = "forest-world"; vegetation = 0.58; biomeStage = 0.55; haze = 0.08; iceLatitude = 70; iceIntensity = 0.08; temperatureC = 19;
  } else if (ageMa > 5) {
    stage = "flowering-plants"; vegetation = 0.82; biomeStage = 0.82; haze = 0.06; iceLatitude = 69; iceIntensity = 0.1; temperatureC = 18;
  }

  if (ageMa >= 630 && ageMa <= 725) {
    iceLatitude = 8; iceIntensity = 0.95; cloudCover = 0.55; temperatureC = -15;
  } else if (ageMa >= 33 && ageMa <= 38) {
    iceLatitude = 58; iceIntensity = 0.55; temperatureC = 12;
  } else if (ageMa > 0 && ageMa < 0.03) {
    iceLatitude = 44; iceIntensity = 0.8; vegetation = 0.72; temperatureC = 9;
  }

  return { iceLatitude, vegetation, temperatureC, stage, oceanCoverage, cloudCover, atmosphereOpacity, haze, iceIntensity, biomeStage };
}

function potentialIce(
  elevation: Float32Array,
  width: number,
  height: number,
  environment: WorldSnapshot["environment"],
): Uint8Array {
  const output = new Uint8Array(elevation.length);
  const globalTemperature = environment.temperatureC ?? 14;
  const intensity = environment.iceIntensity ?? 0;
  for (let y = 0; y < height; y += 1) {
    const latitude = 90 - (180 * y) / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (intensity === 0) continue;
      const latitudeCooling = Math.max(0, Math.abs(latitude) - 20) * 0.52;
      const elevationCooling = Math.max(0, elevation[index]) * 0.0065;
      const localTemperature = globalTemperature - latitudeCooling - elevationCooling;
      const snowballSeaIce = intensity >= 0.9 && elevation[index] <= 0;
      if (snowballSeaIce || ((localTemperature < 0 || Math.abs(latitude) >= environment.iceLatitude) && elevation[index] > 0)) {
        output[index] = Math.round(Math.max(0, Math.min(1, (-localTemperature / 18 + 0.25) * intensity)) * 255);
        if (snowballSeaIce) output[index] = Math.max(output[index], Math.round(190 * intensity));
      }
    }
  }
  return output;
}

function scenarioControls(ageMa: number, environment: WorldSnapshot["environment"]): NonNullable<WorldSnapshot["controls"]> {
  const width = 90;
  const height = 46;
  const signals: number[] = [];
  const phase = (ageMa % 997) / 997;
  for (let y = 0; y < height; y += 1) {
    const latitude = 90 - (180 * y) / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const longitude = -180 + (360 * x) / width;
      const lon = (longitude * Math.PI) / 180;
      const lat = (latitude * Math.PI) / 180;
      signals.push(
        Math.sin(lon * 2.1 + phase * 6.28) * Math.cos(lat * 1.7) +
        0.55 * Math.sin(lon * 4.3 - lat * 2.2 + phase * 11) +
        0.28 * Math.cos(lon * 7.1 + lat * 3.4),
      );
    }
  }
  const sorted = [...signals].sort((a, b) => a - b);
  const oceanFraction = Math.max(0.25, Math.min(0.9, environment.oceanCoverage ?? 0.68));
  const seaLevel = sorted[Math.floor(sorted.length * oceanFraction)];
  const elevation = Float32Array.from(signals, (signal) => Math.round((signal - seaLevel) * 2400));
  return {
    width,
    height,
    elevation,
    potentialIce: potentialIce(elevation, width, height, environment),
    vegetationPotential: vegetationPotential(elevation, width, height, environment),
  };
}

function vegetationPotential(
  elevation: Float32Array,
  width: number,
  height: number,
  environment: WorldSnapshot["environment"],
): Uint8Array {
  const output = new Uint8Array(elevation.length);
  const capacity = environment.biomeStage ?? environment.vegetation;
  for (let y = 0; y < height; y += 1) {
    const latitude = 90 - (180 * y) / (height - 1);
    const latitudeFitness = Math.max(0, Math.cos((latitude * Math.PI) / 180));
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (elevation[index] <= 0 || capacity === 0) continue;
      const altitudeFitness = Math.max(0, 1 - elevation[index] / 5000);
      output[index] = Math.round(255 * capacity * latitudeFitness * altitudeFitness);
    }
  }
  return output;
}

function poisAt(ageMa: number, exactOnly = false): string[] {
  return pointsOfInterest
    .filter((poi) => {
      if (ageMa <= poi.ageStartMa && ageMa >= poi.ageEndMa) return true;
      if (exactOnly) return false;
      const midpoint = (poi.ageStartMa + poi.ageEndMa) / 2;
      const closest = midpoint <= 540
        ? nearest(PALEODEM_AGES, (candidate) => Math.abs(candidate - midpoint))
        : closestTimelineSlice(midpoint).ageMa;
      return closest === ageMa;
    })
    .map((poi) => poi.id);
}

export async function getSnapshot(ageMa: number): Promise<WorldSnapshot> {
  if (!Number.isFinite(ageMa) || ageMa < 0) {
    throw new RangeError("ageMa must be a finite, non-negative number");
  }

  if (ageMa <= 540) {
    const actualAge = nearest(PALEODEM_AGES, (candidate) => Math.abs(candidate - ageMa));
    const chapter = closestTimelineSlice(ageMa);
    const [elevationAsset, geography, reconstructedCountries, climateAsset, areaTracking] = await Promise.all([
      loadElevation(actualAge),
      actualAge === 0 ? loadModernGeography() : Promise.resolve(undefined),
      actualAge === 0 ? Promise.resolve(undefined) : loadCountries(actualAge),
      chapter.id === "present" ? loadModernClimate() : Promise.resolve(undefined),
      loadAreaTracking(actualAge),
    ]);
    const environment = environmentFor(ageMa);
    const elevation = Float32Array.from(elevationAsset.elevation);
    const mismatch = ageMa === actualAge ? "" : ` Requested ${ageMa} Ma; the returned source age is ${actualAge} Ma.`;
    const poiIds = poisAt(chapter.ageMa, chapter.id === "present");
    const sourcePoiCoordinates: Record<string, LonLat> = actualAge === 0
      ? pointsOfInterest.reduce<Record<string, LonLat>>((coordinates, poi) => {
          if (poi.coordinates) coordinates[poi.id] = poi.coordinates;
          return coordinates;
        }, {})
      : reconstructedCountries?.poiCoordinates ?? {};
    const poiCoordinates = Object.fromEntries(
      poiIds.filter((id) => sourcePoiCoordinates[id]).map((id) => [id, sourcePoiCoordinates[id]]),
    );
    return {
      ...chapter,
      id: `${chapter.id}__paleodem-${actualAge}ma`,
      label: chapter.label,
      ageMa: actualAge,
      requestedAgeMa: ageMa,
      geographicSourceAgeMa: actualAge,
      evidence: actualAge === 0 ? "model-output" : "model-output",
      sourceIds: actualAge === 0
        ? ["scotese-wright-paleodem-v2", "natural-earth-land-110m", "natural-earth-countries-110m", ...(climateAsset ? ["beck-koppen-geiger-2023"] : [])]
        : ["scotese-wright-paleodem-v2", "paleomap-political-boundaries-v3", "paleomap-global-plate-model-v3"],
      land: geography?.land ?? [],
      countries: geography?.countries ?? reconstructedCountries?.countries ?? [],
      areaTracking,
      tectonics: tectonicsAt(chapter.ageMa),
      poiIds,
      poiCoordinates,
      environment,
      controls: {
        width: elevationAsset.width,
        height: elevationAsset.height,
        elevation,
        potentialIce: potentialIce(elevation, elevationAsset.width, elevationAsset.height, environment),
        vegetationPotential: vegetationPotential(elevation, elevationAsset.width, elevationAsset.height, environment),
      },
      modernClimate: climateAsset ? decodeModernClimate(climateAsset) : undefined,
      caveat: `PaleoDEM is an interpreted surface in its native PALEOMAP frame. Ice and vegetation controls are procedural potential fields constrained by latitude, elevation, event state, and biological era; they are not mapped ancient boundaries.${mismatch}${actualAge === 0 ? ` Natural Earth supplies only the present-day reference outlines.${climateAsset ? " Beck et al. (2023) 1991–2020 Köppen–Geiger classes constrain modern climate potential, not mapped vegetation." : ""}` : " Country lines are an approximate present-day political reference reconstructed from the prepartitioned PALEOMAP v3 overlay with its matching rotation model; they are not historical borders."}`,
    };
  }

  const scenario = closestTimelineSlice(ageMa);
  const environment = environmentFor(scenario.ageMa);
  return {
    ...scenario,
    id: `${scenario.id}__scenario`,
    requestedAgeMa: ageMa,
    land: [],
    countries: [],
    tectonics: [],
    poiIds: poisAt(scenario.ageMa),
    poiCoordinates: {},
    environment,
    controls: scenarioControls(scenario.ageMa, environment),
    caveat: `Scenario at ${scenario.ageMa} Ma. The elevation field is deterministic artistic crust/islands for visual continuity; no resolved global coastline, country, or plate geometry is asserted. Requested ${ageMa} Ma; the returned scenario age is explicit and is not an interpolated reconstruction.`,
  };
}
