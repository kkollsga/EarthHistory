/** Local algorithm probe; deliberately excluded from deterministic `vitest run`. */
import { readFileSync } from "node:fs";
import { cpus, platform, release } from "node:os";
import { performance } from "node:perf_hooks";
import { decodePaleomapMotionCatalog, createPaleomapIntervalResolver, type UnitDirection } from "../src/data/paleomapMotion";

const STOP_BOUND_MS = 100;
const POINT_COUNT = 6_500;

function lonLatDirection(longitude: number, latitude: number): UnitDirection {
  const lon = longitude * Math.PI / 180;
  const lat = latitude * Math.PI / 180;
  const cosLat = Math.cos(lat);
  return [cosLat * Math.cos(lon), cosLat * Math.sin(lon), Math.sin(lat)];
}

const catalog = decodePaleomapMotionCatalog(JSON.parse(readFileSync("public/data/paleomap-motion-v1.json", "utf8")));
const resolver = createPaleomapIntervalResolver(catalog, 102.5, 100, 105);
const directions = Array.from({ length: POINT_COUNT }, (_, index) => {
  const latitude = -89.5 + 179 * ((index * 149) % POINT_COUNT) / (POINT_COUNT - 1);
  const longitude = -179.5 + 359 * index / (POINT_COUNT - 1);
  return lonLatDirection(longitude, latitude);
});

for (const direction of directions.slice(0, 100)) resolver.resolveAt(direction);
const samples = Array.from({ length: 7 }, () => {
  const started = performance.now();
  for (const direction of directions) resolver.resolveAt(direction);
  return performance.now() - started;
}).sort((left, right) => left - right);
const medianMs = samples[Math.floor(samples.length / 2)]!;
const result = {
  classification: "local algorithm probe; not production render-frame evidence",
  stopBoundMs: STOP_BOUND_MS,
  passedStopBound: medianMs < STOP_BOUND_MS,
  pointCount: POINT_COUNT,
  intervalMa: [100, 105],
  requestedAgeMa: 102.5,
  samplesMs: samples.map((value) => Number(value.toFixed(3))),
  medianMs: Number(medianMs.toFixed(3)),
  node: process.version,
  platform: `${platform()} ${release()}`,
  cpu: cpus()[0]?.model ?? "unknown",
};
console.log(JSON.stringify(result, null, 2));
if (!result.passedStopBound) process.exitCode = 1;
