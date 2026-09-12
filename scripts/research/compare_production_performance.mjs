import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const comparatorPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(comparatorPath), '../..');
const baselineUrl = process.env.BASELINE_URL ?? 'http://127.0.0.1:4190/EarthHistory';
const candidateUrl = process.env.CANDIDATE_URL ?? 'http://127.0.0.1:4191/EarthHistory';
const baselineRoot = resolve(process.env.BASELINE_ROOT
  ?? '/tmp/earthhistory-post014-fixes/baseline-v0.1.4');
const candidateRoot = resolve(process.env.CANDIDATE_ROOT ?? join(repoRoot, 'dist'));
const resultPath = resolve(process.env.RESULT_PATH
  ?? '/tmp/earthhistory-post014-fixes/ui/production-performance.json');
const stopRule = {
  maximumColdReadyDeltaMs: 250,
  maximumColdReadyRatioIncrease: 0.20,
  minimumRelativeCadence: 0.90,
  maximumFrameP50Ms: 33.33,
  minimumFrameSamples: 50,
  regionalCameraDistanceEarthRadii: [1.7, 1.9],
  requireStableCandidateGeometry: true,
};
const sampleCount = 5;
const frameWindowMs = 2_000;
const scrubDurationMs = 2_000;
const preMeasurementAttempts = [
  {
    samplesRecorded: 0,
    outcome: 'stopped-before-measurement',
    reason: 'The published 0.1.4 control has no Iceland material at the proposed modern Iceland anchor.',
  },
  {
    samplesRecorded: 0,
    outcome: 'stopped-before-measurement',
    reason: 'The first regional discovery selected a native chart whose valid interval ends at 410 Ma, before the full 410-412 Ma scrub.',
  },
  {
    samplesRecorded: 30,
    fixedSceneSamplesRecorded: 20,
    scrubSamplesRecorded: 10,
    outcome: 'failed-stop-rule',
    comparatorSha256: 'fdfb30f4de13d63463e20dd1b3099e35f6fc489d05524edfd1d8889d3bb01b7d',
    evidence: '/tmp/earthhistory-post014-fixes/ui/production-performance-failed-unsettled-camera.json',
    reason: 'The final scrub snapshot preceded completion of the focus-camera transition: longitude spread was 0.052 degrees against the unchanged 0.05-degree framing limit.',
  },
];
const regionalZoomProtocol = {
  outwardWheelEvents: 24,
  inwardWheelDeltaY: -220,
  outwardWheelDeltaY: 220,
  maximumInwardWheelEvents: 40,
  minimumResetDistanceEarthRadii: 3.6,
  targetDistanceEarthRadii: [1.76, 1.86],
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
};
const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)];
};

const finitePositive = (value) => Number.isFinite(value) && value > 0;
const validInventory = (inventory) => inventory !== null && typeof inventory === 'object'
  && ['batches', 'vertices', 'triangles', 'countryVertices', 'countrySegments']
    .every((key) => Number.isFinite(inventory[key]) && inventory[key] > 0);
const regionalCamera = (camera) => Number.isFinite(camera.longitude)
  && Number.isFinite(camera.latitude) && finitePositive(camera.distance)
  && camera.distance >= stopRule.regionalCameraDistanceEarthRadii[0]
  && camera.distance <= stopRule.regionalCameraDistanceEarthRadii[1];
const cameraDelta = (left, right) => ({
  longitudeDegrees: Math.abs(left.longitude - right.longitude),
  latitudeDegrees: Math.abs(left.latitude - right.latitude),
  distanceEarthRadii: Math.abs(left.distance - right.distance),
});
const matchingCamera = (left, right) => {
  const delta = cameraDelta(left, right);
  return delta.longitudeDegrees <= 0.05 && delta.latitudeDegrees <= 0.05
    && delta.distanceEarthRadii <= 0.005;
};
const validZoom = (zoom) => zoom !== null && typeof zoom === 'object'
  && Number.isFinite(zoom.resetCamera?.longitude)
  && Number.isFinite(zoom.resetCamera?.latitude)
  && Number.isFinite(zoom.resetCamera?.distance)
  && zoom.resetCamera.distance >= regionalZoomProtocol.minimumResetDistanceEarthRadii
  && regionalCamera(zoom.camera)
  && Number.isInteger(zoom.inwardWheelEvents) && zoom.inwardWheelEvents > 0
  && zoom.inwardWheelEvents <= regionalZoomProtocol.maximumInwardWheelEvents
  && zoom.camera.distance >= regionalZoomProtocol.targetDistanceEarthRadii[0]
  && zoom.camera.distance <= regionalZoomProtocol.targetDistanceEarthRadii[1];

function validSample(row) {
  return row.status === 'ready'
    && finitePositive(row.readyMs)
    && finitePositive(row.frameP50Ms)
    && finitePositive(row.frameP95Ms)
    && finitePositive(row.cadenceFps)
    && row.frameSamples >= stopRule.minimumFrameSamples
    && row.elapsedMs >= frameWindowMs * 0.9
    && row.elapsedMs <= frameWindowMs * 1.5
    && ['webgpu', 'webgl2'].includes(row.backend)
    && row.visibility === 'visible'
    && row.focused === true
    && row.focusMarker === 'true'
    && row.lockStatus === 'resolved'
    && typeof row.materialAddress === 'string'
    && row.materialAddress.length > 0
    && Number.isFinite(row.age)
    && Number.isInteger(row.run) && row.run >= 1 && row.run <= sampleCount
    && finitePositive(row.nodeWallReadyMs)
    && typeof row.geometryIdentity === 'string' && row.geometryIdentity.length > 0
    && validInventory(row.inventory)
    && validZoom(row.zoom)
    && regionalCamera(row.camera)
    && matchingCamera(row.zoom.camera, row.camera)
    && row.errors.length === 0;
}

function validScrub(row) {
  return row.finalStatus === 'ready'
    && finitePositive(row.frameP50Ms)
    && finitePositive(row.frameP95Ms)
    && finitePositive(row.cadenceFps)
    && row.frameSamples >= stopRule.minimumFrameSamples
    && row.elapsedMs >= scrubDurationMs * 0.9
    && row.elapsedMs <= scrubDurationMs * 1.5
    && row.dispatchedAges.length >= 20
    && new Set(row.dispatchedAges.map((age) => age.toFixed(6))).size >= 20
    && Math.abs(row.dispatchedAges[0] - 410) <= 1e-6
    && Math.abs(row.dispatchedAges.at(-1) - 412) <= 1e-6
    && row.dispatchedAges.every((age) => Number.isFinite(age) && age >= 410 && age <= 412)
    && ['webgpu', 'webgl2'].includes(row.backend)
    && row.visibility === 'visible'
    && row.focused === true
    && row.focusMarker === 'true'
    && row.lockStatus === 'resolved'
    && typeof row.materialAddress === 'string'
    && row.materialAddress.length > 0
    && Number.isInteger(row.run) && row.run >= 1 && row.run <= sampleCount
    && validZoom(row.zoom)
    && regionalCamera(row.camera)
    && Math.abs(row.zoom.camera.distance - row.camera.distance) <= 0.005
    && row.samples.length >= stopRule.minimumFrameSamples
    && row.samples.every((sample) => Number.isFinite(sample.age)
      && sample.age >= 410 && sample.age <= 412
      && ['ready', 'updating', 'publishing'].includes(sample.status)
      && typeof sample.geometryIdentity === 'string' && sample.geometryIdentity.length > 0
      && Number.isFinite(sample.camera.longitude) && Number.isFinite(sample.camera.latitude)
      && finitePositive(sample.camera.distance) && validInventory(sample.inventory))
    && row.errors.length === 0;
}

function framingSpread(rows) {
  const longitudes = rows.map((row) => row.camera.longitude);
  const latitudes = rows.map((row) => row.camera.latitude);
  const distances = rows.map((row) => row.camera.distance);
  return {
    longitudeDegrees: Math.max(...longitudes) - Math.min(...longitudes),
    latitudeDegrees: Math.max(...latitudes) - Math.min(...latitudes),
    distanceEarthRadii: Math.max(...distances) - Math.min(...distances),
  };
}

function evaluate(rows, scrubRows) {
  const scenes = {};
  const backends = new Set(rows.map((row) => row.backend));
  const sampleValidationPass = rows.length === sampleCount * 2 * 2
    && rows.every(validSample)
    && backends.size === 1;
  for (const scene of ['north-atlantic-0', 'regional-411']) {
    const baseline = rows.filter((row) => row.variant === 'baseline' && row.scene === scene);
    const candidate = rows.filter((row) => row.variant === 'candidate' && row.scene === scene);
    const exactSampleCountPass = baseline.length === sampleCount && candidate.length === sampleCount;
    const pairedSampleRunsPass = Array.from({ length: sampleCount }, (_, index) => index + 1)
      .every((run) => baseline.filter((row) => row.run === run).length === 1
        && candidate.filter((row) => row.run === run).length === 1);
    const sharedMaterialLockPass = new Set([...baseline, ...candidate]
      .map((row) => row.materialAddress)).size === 1;
    const cameraSpread = exactSampleCountPass ? framingSpread([...baseline, ...candidate]) : {
      longitudeDegrees: Number.NaN, latitudeDegrees: Number.NaN, distanceEarthRadii: Number.NaN,
    };
    const equalFramingPass = cameraSpread.longitudeDegrees <= 0.05
      && cameraSpread.latitudeDegrees <= 0.05 && cameraSpread.distanceEarthRadii <= 0.005;
    const baselineReady = median(baseline.map((row) => row.readyMs));
    const candidateReady = median(candidate.map((row) => row.readyMs));
    const baselineP50 = median(baseline.map((row) => row.frameP50Ms));
    const candidateP50 = median(candidate.map((row) => row.frameP50Ms));
    const baselineCadence = median(baseline.map((row) => row.cadenceFps));
    const candidateCadence = median(candidate.map((row) => row.cadenceFps));
    const readyDelta = candidateReady - baselineReady;
    const cadenceRatio = candidateCadence / baselineCadence;
    scenes[scene] = {
      samplesPerVariant: { baseline: baseline.length, candidate: candidate.length },
      exactSampleCountPass,
      pairedSampleRunsPass,
      sharedMaterialLockPass,
      cameraSpread,
      equalFramingPass,
      baselineReadyMedianMs: baselineReady,
      candidateReadyMedianMs: candidateReady,
      readyDeltaMs: readyDelta,
      readyPass: exactSampleCountPass && pairedSampleRunsPass
        && sharedMaterialLockPass && equalFramingPass
        && readyDelta <= Math.max(stopRule.maximumColdReadyDeltaMs,
        baselineReady * stopRule.maximumColdReadyRatioIncrease),
      baselineFrameP50MedianMs: baselineP50,
      candidateFrameP50MedianMs: candidateP50,
      baselineCadenceMedianFps: baselineCadence,
      candidateCadenceMedianFps: candidateCadence,
      candidateToBaselineCadenceRatio: cadenceRatio,
      relativeCadencePass: exactSampleCountPass && cadenceRatio >= stopRule.minimumRelativeCadence,
      absoluteCadencePass: candidateP50 <= stopRule.maximumFrameP50Ms,
    };
  }
  const baselineScrubs = scrubRows.filter((row) => row.variant === 'baseline');
  const candidateScrubs = scrubRows.filter((row) => row.variant === 'candidate');
  const pairedRuns = Array.from({ length: sampleCount }, (_, index) => index + 1).every((run) =>
    baselineScrubs.filter((row) => row.run === run).length === 1
      && candidateScrubs.filter((row) => row.run === run).length === 1);
  const scrubBackends = new Set(scrubRows.map((row) => row.backend));
  const scrubMaterials = new Set(scrubRows.map((row) => row.materialAddress));
  const regionalMaterials = new Set(rows.filter((row) => row.scene === 'regional-411')
    .map((row) => row.materialAddress));
  const scrubValidationPass = scrubRows.length === sampleCount * 2
    && baselineScrubs.length === sampleCount && candidateScrubs.length === sampleCount
    && pairedRuns && scrubRows.every(validScrub)
    && scrubBackends.size === 1 && scrubMaterials.size === 1
    && scrubRows[0]?.backend === rows[0]?.backend
    && regionalMaterials.size === 1
    && scrubRows[0]?.materialAddress === rows.find((row) => row.scene === 'regional-411')?.materialAddress;
  const scrubCameraSpread = scrubRows.length === sampleCount * 2 ? framingSpread(scrubRows) : {
    longitudeDegrees: Number.NaN, latitudeDegrees: Number.NaN, distanceEarthRadii: Number.NaN,
  };
  const scrubEqualFramingPass = scrubCameraSpread.longitudeDegrees <= 0.05
    && scrubCameraSpread.latitudeDegrees <= 0.05 && scrubCameraSpread.distanceEarthRadii <= 0.005;
  const candidateScrubSamples = candidateScrubs.flatMap((row) => row.samples);
  const geometryStable = candidateScrubSamples.length >= sampleCount * 2
    && candidateScrubSamples.every((sample) => sample.geometryIdentity)
    && candidateScrubSamples.every((sample) => Number.isFinite(sample.camera.longitude)
      && Number.isFinite(sample.camera.latitude) && finitePositive(sample.camera.distance))
    && new Set(candidateScrubSamples.map((sample) => sample.geometryIdentity)).size === 1
    && new Set(candidateScrubSamples.map((sample) => JSON.stringify(sample.inventory))).size === 1
    && candidateScrubSamples.every((sample) => ['ready', 'updating', 'publishing'].includes(sample.status));
  const baselineScrubCadence = median(baselineScrubs.map((row) => row.cadenceFps));
  const candidateScrubCadence = median(candidateScrubs.map((row) => row.cadenceFps));
  const candidateScrubP50 = median(candidateScrubs.map((row) => row.frameP50Ms));
  const scrubCadenceRatio = scrubValidationPass
    ? candidateScrubCadence / baselineScrubCadence : Number.NaN;
  const scrubCadencePass = scrubValidationPass
    && scrubCadenceRatio >= stopRule.minimumRelativeCadence
    && candidateScrubP50 <= stopRule.maximumFrameP50Ms;
  return {
    scenes,
    sampleValidationPass,
    scrubValidationPass,
    scrubCameraSpread,
    scrubEqualFramingPass,
    geometryStable,
    baselineScrubCadenceMedianFps: baselineScrubCadence,
    candidateScrubCadenceMedianFps: candidateScrubCadence,
    candidateScrubFrameP50MedianMs: candidateScrubP50,
    scrubCadenceRatio,
    scrubCadencePass,
    pass: Object.values(scenes).every((scene) => scene.readyPass
      && scene.relativeCadencePass && scene.absoluteCadencePass)
      && sampleValidationPass && scrubValidationPass && scrubEqualFramingPass
      && geometryStable && scrubCadencePass,
  };
}

function selfTest() {
  const zoom = {
    resetCamera: { longitude: -20, latitude: 65, distance: 3.68 },
    camera: { longitude: -20, latitude: 65, distance: 1.82 },
    inwardWheelEvents: 22,
  };
  const make = (variant, scene, readyMs, frameP50Ms, cadenceFps = 60) => ({
    variant, scene, readyMs, frameP50Ms, frameP95Ms: 18, cadenceFps,
    age: scene === 'north-atlantic-0' ? 0 : 411,
    nodeWallReadyMs: readyMs + 25,
    frameSamples: 120, elapsedMs: 2_000, status: 'ready', backend: 'webgl2',
    visibility: 'visible', focused: true, focusMarker: 'true', lockStatus: 'resolved',
    materialAddress: 'shared-material', errors: [],
    camera: { longitude: -20, latitude: 65, distance: 1.82 },
    zoom,
    geometryIdentity: 'one',
    inventory: { batches: 5, vertices: 10, triangles: 10, countryVertices: 10, countrySegments: 5 },
  });
  const healthyRows = ['north-atlantic-0', 'regional-411'].flatMap((scene) => [
    ...Array.from({ length: sampleCount }, (_, index) => ({
      ...make('baseline', scene, 500, 16.7), run: index + 1,
    })),
    ...Array.from({ length: sampleCount }, (_, index) => ({
      ...make('candidate', scene, 600, 16.7), run: index + 1,
    })),
  ]);
  const makeScrub = (variant, run, cadenceFps = 60) => ({
    variant, run, elapsedMs: 2_000, frameSamples: 120, cadenceFps,
    frameP50Ms: 16.7, frameP95Ms: 18, finalStatus: 'ready', backend: 'webgl2',
    visibility: 'visible', focused: true, focusMarker: 'true', lockStatus: 'resolved',
    materialAddress: 'shared-material', errors: [],
    camera: { longitude: -58, latitude: 4, distance: 1.82 },
    zoom: {
      resetCamera: { longitude: -58, latitude: 4, distance: 3.68 },
      camera: { longitude: -58, latitude: 4, distance: 1.82 },
      inwardWheelEvents: 22,
    },
    dispatchedAges: Array.from({ length: 121 }, (_, index) => 410 + index / 60),
    samples: Array.from({ length: 120 }, (_, index) => ({ age: 410 + index / 60,
      status: 'updating',
      geometryIdentity: 'one', camera: { longitude: -58, latitude: 4, distance: 1.82 },
      inventory: { batches: 5, vertices: 10, triangles: 10,
        countryVertices: 10, countrySegments: 5 } })),
  });
  const scrub = Array.from({ length: sampleCount }, (_, index) => [
    makeScrub('baseline', index + 1), makeScrub('candidate', index + 1),
  ]).flat();
  if (!evaluate(healthyRows, scrub).pass) throw new Error('healthy performance fixture was rejected');
  const smoothFrames = Array.from({ length: 121 }, (_, index) => index * (2_000 / 120));
  const oneSecondStallFrames = smoothFrames.filter((time) => time <= 500 || time >= 1_500);
  const smoothMetrics = frameMetrics(smoothFrames, 0, 2_000);
  const stalledMetrics = frameMetrics(oneSecondStallFrames, 0, 2_000);
  if (stalledMetrics.frameP50Ms > 20
      || stalledMetrics.cadenceFps / smoothMetrics.cadenceFps >= stopRule.minimumRelativeCadence) {
    throw new Error('synthetic stall fixture does not isolate frame-count cadence from p50');
  }
  const measuredStall = healthyRows.map((row) => row.variant === 'candidate'
    ? { ...row, ...stalledMetrics } : { ...row, ...smoothMetrics });
  if (evaluate(measuredStall, scrub).pass) throw new Error('one-second frame stall was accepted');
  const mutated = healthyRows.map((row) => row.variant === 'candidate' && row.scene === 'north-atlantic-0'
    ? { ...row, readyMs: 900 } : row);
  if (evaluate(mutated, scrub).pass) throw new Error('cold-ready mutation was accepted');
  const stalled = healthyRows.map((row) => row.variant === 'candidate'
    ? { ...row, cadenceFps: 40 } : row);
  if (evaluate(stalled, scrub).pass) throw new Error('frame-count cadence mutation was accepted');
  const slowP50 = healthyRows.map((row) => row.variant === 'candidate'
    ? { ...row, frameP50Ms: 40 } : row);
  if (evaluate(slowP50, scrub).pass) throw new Error('absolute p50 mutation was accepted');
  const sparseFrames = healthyRows.map((row, index) => index === 0
    ? { ...row, frameSamples: 1 } : row);
  if (evaluate(sparseFrames, scrub).pass) throw new Error('invalid frame sample mutation was accepted');
  const uncontrolledZoom = healthyRows.map((row, index) => index === 0
    ? { ...row, zoom: { ...row.zoom, resetCamera: { ...row.zoom.resetCamera, distance: 3 } } } : row);
  if (evaluate(uncontrolledZoom, scrub).pass) throw new Error('uncontrolled zoom mutation was accepted');
  const invalidResetCamera = healthyRows.map((row, index) => index === 0
    ? { ...row, zoom: { ...row.zoom,
      resetCamera: { ...row.zoom.resetCamera, longitude: Number.NaN } } } : row);
  if (evaluate(invalidResetCamera, scrub).pass) {
    throw new Error('non-finite reset-camera mutation was accepted');
  }
  const invalidInventory = healthyRows.map((row, index) => index === 0
    ? { ...row, inventory: { ...row.inventory, vertices: Number.NaN } } : row);
  if (evaluate(invalidInventory, scrub).pass) throw new Error('non-finite inventory mutation was accepted');
  if (evaluate(healthyRows.slice(1), scrub).pass) throw new Error('missing sample mutation was accepted');
  const duplicateSampleRun = healthyRows.map((row, index) => index === 0 ? { ...row, run: 2 } : row);
  if (evaluate(duplicateSampleRun, scrub).pass) throw new Error('unpaired sample-run mutation was accepted');
  const hidden = healthyRows.map((row, index) => index === 0
    ? { ...row, visibility: 'hidden' } : row);
  if (evaluate(hidden, scrub).pass) throw new Error('hidden sample mutation was accepted');
  const backend = healthyRows.map((row) => row.variant === 'candidate'
    ? { ...row, backend: 'webgpu' } : row);
  if (evaluate(backend, scrub).pass) throw new Error('backend mismatch mutation was accepted');
  const unlocked = healthyRows.map((row, index) => index === 0
    ? { ...row, materialAddress: '', focusMarker: 'false' } : row);
  if (evaluate(unlocked, scrub).pass) throw new Error('missing material-lock mutation was accepted');
  const differentLock = healthyRows.map((row) => row.variant === 'candidate'
    && row.scene === 'regional-411' ? { ...row, materialAddress: 'other-material' } : row);
  if (evaluate(differentLock, scrub).pass) throw new Error('different material-lock mutation was accepted');
  const reframed = healthyRows.map((row, index) => index === 0
    ? { ...row, camera: { ...row.camera, longitude: row.camera.longitude + 1 } } : row);
  if (evaluate(reframed, scrub).pass) throw new Error('camera framing mutation was accepted');
  const churn = structuredClone(scrub);
  churn.find((row) => row.variant === 'candidate').samples[60].geometryIdentity = 'changed';
  if (evaluate(healthyRows, churn).pass) {
    throw new Error('geometry-churn mutation was accepted');
  }
  const stepped = structuredClone(scrub);
  stepped.find((row) => row.variant === 'candidate').dispatchedAges = [410, 411, 412];
  if (evaluate(healthyRows, stepped).pass) throw new Error('discrete scrub mutation was accepted');
  const lateStart = structuredClone(scrub);
  lateStart.find((row) => row.variant === 'candidate').dispatchedAges[0] = 410.01;
  if (evaluate(healthyRows, lateStart).pass) throw new Error('late scrub-start mutation was accepted');
  const invalidInternalAge = structuredClone(scrub);
  invalidInternalAge.find((row) => row.variant === 'candidate').dispatchedAges[10] = Number.NaN;
  if (evaluate(healthyRows, invalidInternalAge).pass) {
    throw new Error('non-finite internal scrub age mutation was accepted');
  }
  const stalledScrub = structuredClone(scrub);
  for (const row of stalledScrub.filter((candidate) => candidate.variant === 'candidate')) {
    row.cadenceFps = 40;
  }
  if (evaluate(healthyRows, stalledScrub).pass) throw new Error('scrub cadence mutation was accepted');
  const missingPairedScrub = scrub.filter((row) => !(row.variant === 'candidate' && row.run === 3));
  if (evaluate(healthyRows, missingPairedScrub).pass) {
    throw new Error('missing paired scrub mutation was accepted');
  }
  console.log('production performance stop-rule self-test passed');
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function artifact(root) {
  const assets = (await readdir(join(root, 'assets'))).sort();
  const entry = assets.find((name) => /^index-.*\.js$/.test(name));
  if (entry === undefined) throw new Error(`${root}: production JavaScript entry missing`);
  const assetFiles = await Promise.all(assets.map(async (name) => {
    const path = join(root, 'assets', name);
    return { name, bytes: (await stat(path)).size, sha256: await sha256(path) };
  }));
  const outerManifest = join(root, 'data/manifest.json');
  const packageManifest = join(root, 'data/reconstruction/cao-v2.4/manifest.json');
  return {
    root,
    indexSha256: await sha256(join(root, 'index.html')),
    entry,
    entrySha256: await sha256(join(root, 'assets', entry)),
    assetFiles,
    outerManifestBytes: (await stat(outerManifest)).size,
    outerManifestSha256: await sha256(outerManifest),
    packageManifestBytes: (await stat(packageManifest)).size,
    packageManifestSha256: await sha256(packageManifest),
  };
}

async function installFrameProbe(context) {
  await context.addInitScript(() => {
    window.__post014FrameTimes = [];
    window.__post014FirstReadyLockedAt = null;
    const tick = (now) => {
      window.__post014FrameTimes.push(now);
      if (window.__post014FrameTimes.length > 1000) window.__post014FrameTimes.shift();
      if (window.__post014FirstReadyLockedAt === null) {
        const params = new URLSearchParams(location.hash.slice(1));
        const expectedAge = Number(params.get('age'));
        const expectedMaterial = params.get('material');
        const canvas = document.querySelector('canvas');
        const lock = document.querySelector('.location-lock');
        if (Number.isFinite(expectedAge) && expectedMaterial !== null
          && canvas?.dataset.caoFoundationStatus === 'ready'
          && Math.abs(Number(canvas.dataset.caoFoundationRequestedAgeMa) - expectedAge) <= 1e-6
          && canvas.dataset.focusMarker === 'true'
          && lock?.getAttribute('data-status') === 'resolved') {
          window.__post014FirstReadyLockedAt = now;
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function frameMetrics(frameTimes, started, ended) {
  const times = frameTimes.filter((value) => value >= started && value <= ended);
  const intervals = times.slice(1).map((value, index) => value - times[index]);
  const elapsedMs = ended - started;
  return {
    elapsedMs: Number(elapsedMs.toFixed(2)),
    frameSamples: times.length,
    cadenceFps: Number((times.length / (elapsedMs / 1000)).toFixed(3)),
    frameP50Ms: intervals.length ? Number(percentile(intervals, 0.5).toFixed(2)) : Number.NaN,
    frameP95Ms: intervals.length ? Number(percentile(intervals, 0.95).toFixed(2)) : Number.NaN,
  };
}

async function waitForReadyAndLock(page, age, materialAddress, timeout = 30_000) {
  await page.waitForFunction(({ expectedAge, expectedMaterial }) => {
    const canvas = document.querySelector('canvas');
    const data = canvas?.dataset;
    const material = new URLSearchParams(location.hash.slice(1)).get('material');
    const lock = document.querySelector('.location-lock');
    return data?.caoFoundationStatus === 'ready'
      && Math.abs(Number(data.caoFoundationRequestedAgeMa) - expectedAge) <= 1e-6
      && data?.focusMarker === 'true'
      && lock?.getAttribute('data-status') === 'resolved'
      && material === expectedMaterial;
  }, { expectedAge: age, expectedMaterial: materialAddress }, { timeout });
}

async function waitForCameraTarget(page, expected, timeout = 5_000) {
  await page.waitForFunction((target) => {
    const data = document.querySelector('canvas')?.dataset ?? {};
    return Math.abs(Number(data.cameraLongitude) - target.longitude) <= 0.005
      && Math.abs(Number(data.cameraLatitude) - target.latitude) <= 0.005
      && Math.abs(Number(data.cameraDistance) - target.distance) <= 0.005;
  }, expected, { timeout });
}

async function cameraSnapshot(page) {
  return page.evaluate(() => {
    const data = document.querySelector('canvas')?.dataset ?? {};
    return {
      longitude: Number(data.cameraLongitude),
      latitude: Number(data.cameraLatitude),
      distance: Number(data.cameraDistance),
    };
  });
}

async function establishRegionalZoom(page, canvas) {
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('canvas has no regional-zoom target box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let index = 0; index < regionalZoomProtocol.outwardWheelEvents; index += 1) {
    await page.mouse.wheel(0, regionalZoomProtocol.outwardWheelDeltaY);
  }
  await page.evaluate(async () => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  const resetCamera = await cameraSnapshot(page);
  if (!Number.isFinite(resetCamera.distance)
      || resetCamera.distance < regionalZoomProtocol.minimumResetDistanceEarthRadii) {
    throw new Error(`regional zoom did not reach its known outer baseline: ${resetCamera.distance}`);
  }
  let camera = resetCamera;
  let inwardWheelEvents = 0;
  for (let index = 0; index < regionalZoomProtocol.maximumInwardWheelEvents; index += 1) {
    if (camera.distance <= regionalZoomProtocol.targetDistanceEarthRadii[1]) break;
    await page.mouse.wheel(0, regionalZoomProtocol.inwardWheelDeltaY);
    inwardWheelEvents += 1;
    await page.evaluate(async () => new Promise((resolve) => requestAnimationFrame(() => resolve())));
    camera = await cameraSnapshot(page);
  }
  if (!regionalCamera(camera)
      || camera.distance < regionalZoomProtocol.targetDistanceEarthRadii[0]
      || camera.distance > regionalZoomProtocol.targetDistanceEarthRadii[1]) {
    throw new Error(`regional zoom did not reach its controlled target: ${camera.distance}`);
  }
  return { resetCamera, camera, inwardWheelEvents };
}

function assertMatchingCamera(left, right, label) {
  if (!matchingCamera(left, right)) {
    throw new Error(`${label}: camera mismatch ${JSON.stringify(cameraDelta(left, right))}`);
  }
}

async function discoverMaterialLock(browser, url, scene) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  try {
    const params = new URLSearchParams({ age: String(scene.age), layers: 'borders', relief: '8',
      coordinates: 'cao', at: scene.at.join(',') });
    await page.goto(`${url}/#${params}`, { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    const canvas = page.locator("canvas[aria-label='Interactive three-dimensional Earth']");
    await canvas.waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForFunction((expected) => {
      const data = document.querySelector('canvas')?.dataset;
      return data?.caoFoundationStatus === 'ready'
        && Math.abs(Number(data.caoFoundationRequestedAgeMa) - expected) <= 1e-6;
    }, scene.age, { timeout: 30_000 });
    const box = await canvas.boundingBox();
    if (box === null) throw new Error(`${scene.id}: canvas has no material-lock target box`);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(() => document.querySelector('canvas')?.dataset.focusKind === 'none');
    const offsets = [
      [0, 0], [-0.12, 0], [0.12, 0], [-0.2, 0], [0.2, 0],
      [-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12],
      [-0.25, -0.12], [0.25, -0.12], [-0.25, 0.12], [0.25, 0.12],
    ];
    for (const [dx, dy] of offsets) {
      await page.mouse.click(box.x + box.width * (0.5 + dx), box.y + box.height * (0.5 + dy));
      const materialAddress = await page.waitForFunction(() => {
        const canvas = document.querySelector('canvas');
        const value = new URLSearchParams(location.hash.slice(1)).get('material');
        const lock = document.querySelector('.location-lock');
        return value && canvas?.dataset.focusMarker === 'true'
          && lock?.getAttribute('data-status') === 'resolved' ? value : null;
      }, undefined, { timeout: 1_000 }).then((handle) => handle.jsonValue()).catch(() => null);
      if (typeof materialAddress === 'string' && materialAddress.length > 0) {
        const zoom = await establishRegionalZoom(page, canvas);
        const camera = await cameraSnapshot(page);
        return { materialAddress, requestedAt: scene.at, zoom, lockedCamera: camera };
      }
      if (await canvas.getAttribute('data-focus-kind') !== 'none') {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForFunction(() => document.querySelector('canvas')?.dataset.focusKind === 'none');
      }
    }
    throw new Error(`${scene.id}: no shared baseline material lock found near the fixed view`);
  } finally {
    await context.close();
  }
}

async function verifyMaterialLock(browser, url, scene, age, materialAddress) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  try {
    const params = new URLSearchParams({ age: String(age), layers: 'borders', relief: '8',
      coordinates: 'cao', material: materialAddress, at: scene.at.join(',') });
    await page.goto(`${url}/#${params}`, { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    await waitForReadyAndLock(page, age, materialAddress);
    const canvas = page.locator("canvas[aria-label='Interactive three-dimensional Earth']");
    return await establishRegionalZoom(page, canvas);
  } finally {
    await context.close();
  }
}

async function sample(browser, variant, url, scene, materialAddress, run) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce',
  });
  await installFrameProbe(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const started = performance.now();
  const params = new URLSearchParams({ age: String(scene.age), layers: 'borders', relief: '8',
    coordinates: 'cao', material: materialAddress, at: scene.at.join(',') });
  try {
    await page.goto(`${url}/#${params}`, { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    const canvas = page.locator("canvas[aria-label='Interactive three-dimensional Earth']");
    await canvas.waitFor({ state: 'visible', timeout: 30_000 });
    await waitForReadyAndLock(page, scene.age, materialAddress);
    const zoom = await establishRegionalZoom(page, canvas);
    const nodeWallReadyMs = performance.now() - started;
    const payload = await page.evaluate(async ({ durationMs }) => {
      window.__post014FrameTimes = [];
      const frameStarted = performance.now();
      await new Promise((resolve) => setTimeout(resolve, durationMs));
      const frameEnded = performance.now();
      return {
        frameTimes: window.__post014FrameTimes,
        frameStarted,
        frameEnded,
        firstReadyLockedAt: window.__post014FirstReadyLockedAt,
        data: { ...document.querySelector('canvas').dataset },
        visibility: document.visibilityState,
        focused: document.hasFocus(),
        lockStatus: document.querySelector('.location-lock')?.getAttribute('data-status'),
        materialAddress: new URLSearchParams(location.hash.slice(1)).get('material'),
      };
    }, { durationMs: frameWindowMs });
    const timing = frameMetrics(payload.frameTimes, payload.frameStarted, payload.frameEnded);
    return {
      variant, scene: scene.id, age: scene.age, run,
      readyMs: Number(Number(payload.firstReadyLockedAt).toFixed(2)),
      nodeWallReadyMs: Number(nodeWallReadyMs.toFixed(2)),
      ...timing,
      status: payload.data.caoFoundationStatus,
      backend: payload.data.rendererBackend,
      focusMarker: payload.data.focusMarker,
      lockStatus: payload.lockStatus,
      materialAddress: payload.materialAddress,
      camera: {
        longitude: Number(payload.data.cameraLongitude),
        latitude: Number(payload.data.cameraLatitude),
        distance: Number(payload.data.cameraDistance),
      },
      zoom,
      geometryIdentity: payload.data.caoFoundationGeometryIdentity,
      inventory: {
        batches: Number(payload.data.caoFoundationBatches),
        vertices: Number(payload.data.caoFoundationVertices),
        triangles: Number(payload.data.caoFoundationTriangles),
        countryVertices: Number(payload.data.caoFoundationCountryLineVertices),
        countrySegments: Number(payload.data.caoFoundationCountryLineSegments),
      },
      visibility: payload.visibility,
      focused: payload.focused,
      errors,
    };
  } finally {
    await context.close();
  }
}

async function scrub(browser, variant, url, scene, materialAddress, finalCameraTarget, run) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce',
  });
  await installFrameProbe(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    const params = new URLSearchParams({ age: '410', layers: 'borders', relief: '8',
      coordinates: 'cao', material: materialAddress, at: scene.at.join(',') });
    await page.goto(`${url}/#${params}`, { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    await waitForReadyAndLock(page, 410, materialAddress);
    const canvas = page.locator("canvas[aria-label='Interactive three-dimensional Earth']");
    const zoom = await establishRegionalZoom(page, canvas);
    const result = await page.evaluate(async ({ durationMs }) => {
      const input = document.querySelector('#geological-age');
      if (!(input instanceof HTMLInputElement)) throw new Error('geological age range missing');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter === undefined) throw new Error('native range setter missing');
      window.__post014FrameTimes = [];
      const started = performance.now();
      const dispatchedAges = [];
      const samples = [];
      const dispatchAndSample = (age) => {
        setter.call(input, String(age / 538.8 * 1000));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        dispatchedAges.push(age);
        const data = document.querySelector('canvas')?.dataset ?? {};
          samples.push({
            age,
            status: data.caoFoundationStatus,
            geometryIdentity: data.caoFoundationGeometryIdentity,
            camera: {
              longitude: Number(data.cameraLongitude),
              latitude: Number(data.cameraLatitude),
              distance: Number(data.cameraDistance),
            },
          inventory: {
            batches: Number(data.caoFoundationBatches),
            vertices: Number(data.caoFoundationVertices),
            triangles: Number(data.caoFoundationTriangles),
            countryVertices: Number(data.caoFoundationCountryLineVertices),
            countrySegments: Number(data.caoFoundationCountryLineSegments),
          },
        });
      };
      dispatchAndSample(410);
      await new Promise((resolve) => {
        const drive = (now) => {
          const fraction = Math.min(1, (now - started) / durationMs);
          const age = 410 + 2 * fraction;
          dispatchAndSample(age);
          if (fraction === 1) resolve();
          else requestAnimationFrame(drive);
        };
        requestAnimationFrame(drive);
      });
      return { started, ended: performance.now(), frameTimes: window.__post014FrameTimes,
        dispatchedAges, samples };
    }, { durationMs: scrubDurationMs });
    await waitForReadyAndLock(page, 412, materialAddress, 15_000);
    await waitForCameraTarget(page, finalCameraTarget);
    const final = await page.evaluate(() => ({
      data: { ...document.querySelector('canvas').dataset },
      visibility: document.visibilityState,
      focused: document.hasFocus(),
      lockStatus: document.querySelector('.location-lock')?.getAttribute('data-status'),
      materialAddress: new URLSearchParams(location.hash.slice(1)).get('material'),
    }));
    return {
      variant, run,
      ...frameMetrics(result.frameTimes, result.started, result.ended),
      dispatchedAges: result.dispatchedAges,
      samples: result.samples,
      finalStatus: final.data.caoFoundationStatus,
      backend: final.data.rendererBackend,
      focusMarker: final.data.focusMarker,
      lockStatus: final.lockStatus,
      materialAddress: final.materialAddress,
      camera: {
        longitude: Number(final.data.cameraLongitude),
        latitude: Number(final.data.cameraLatitude),
        distance: Number(final.data.cameraDistance),
      },
      zoom,
      visibility: final.visibility,
      focused: final.focused,
      errors,
    };
  } finally {
    await context.close();
  }
}

if (process.argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

const browser = await chromium.launch({
  channel: 'chrome', headless: false,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
try {
  const rows = [];
  const variants = {
    baseline: baselineUrl,
    candidate: candidateUrl,
  };
  const scenes = [
    { id: 'north-atlantic-0', age: 0, at: [-42, 72] },
    { id: 'regional-411', age: 411, at: [-42, 72] },
  ];
  const materialLocks = {};
  const lockDiscovery = {};
  lockDiscovery['north-atlantic-0'] = await discoverMaterialLock(browser, baselineUrl, scenes[0]);
  materialLocks['north-atlantic-0'] = lockDiscovery['north-atlantic-0'].materialAddress;
  lockDiscovery['regional-411'] = {
    ...lockDiscovery['north-atlantic-0'],
    reusedFrom: 'north-atlantic-0',
    verifiedAgesMa: [410, 411, 412],
  };
  materialLocks['regional-411'] = materialLocks['north-atlantic-0'];
  console.log(`performance preflight: shared North Atlantic lock ${materialLocks['north-atlantic-0']}`);
  const preflightViews = { baseline: {}, candidate: {} };
  for (const variant of ['baseline', 'candidate']) {
    preflightViews[variant]['north-atlantic-0'] = {
      0: await verifyMaterialLock(browser, variants[variant], scenes[0], 0,
        materialLocks['north-atlantic-0']),
    };
    preflightViews[variant]['regional-411'] = {};
    for (const age of [410, 411, 412]) {
      console.log(`performance preflight: ${variant} regional-411 at ${age} Ma`);
      preflightViews[variant]['regional-411'][age] = await verifyMaterialLock(
        browser, variants[variant], scenes[1], age, materialLocks['regional-411'],
      );
    }
  }
  assertMatchingCamera(
    preflightViews.baseline['north-atlantic-0'][0].camera,
    preflightViews.candidate['north-atlantic-0'][0].camera,
    'north-atlantic-0 baseline/candidate preflight',
  );
  for (const age of [410, 411, 412]) {
    assertMatchingCamera(
      preflightViews.baseline['regional-411'][age].camera,
      preflightViews.candidate['regional-411'][age].camera,
      `regional-411 ${age} Ma baseline/candidate preflight`,
    );
  }
  const orders = [
    ['baseline', 'candidate'], ['candidate', 'baseline'], ['baseline', 'candidate'],
    ['candidate', 'baseline'], ['baseline', 'candidate'],
  ];
  const scrubRows = [];
  for (let run = 0; run < orders.length; run += 1) {
    for (const variant of orders[run]) {
      for (const scene of scenes) rows.push(await sample(
        browser, variant, variants[variant], scene, materialLocks[scene.id], run + 1,
      ));
      scrubRows.push(await scrub(
        browser, variant, variants[variant], scenes[1], materialLocks['regional-411'],
        preflightViews[variant]['regional-411'][412].camera, run + 1,
      ));
    }
  }
  const cdp = await browser.newBrowserCDPSession();
  const system = await cdp.send('SystemInfo.getInfo');
  const result = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    comparator: {
      path: 'scripts/research/compare_production_performance.mjs',
      sha256: await sha256(comparatorPath),
    },
    stopRule,
    artifacts: { baseline: await artifact(baselineRoot), candidate: await artifact(candidateRoot) },
    machine: {
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length,
      totalMemoryBytes: os.totalmem(), freeMemoryBytes: os.freemem(), loadAverage: os.loadavg(),
    },
    browser: { version: browser.version(), mode: 'headed', gpu: system.gpu },
    preMeasurementAttempts,
    sceneDefinitions: scenes,
    materialLocks,
    lockDiscovery,
    preflightViews,
    regionalZoomProtocol,
    rows,
    scrubRows,
    summary: evaluate(rows, scrubRows),
  };
  await mkdir(dirname(resultPath), { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ resultPath, summary: result.summary }, null, 2));
  if (!result.summary.pass) process.exitCode = 1;
} finally {
  await browser.close();
}
