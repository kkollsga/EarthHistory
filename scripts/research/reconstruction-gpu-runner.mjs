import { chromium } from "@playwright/test";
import { build, preview } from "vite";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { cpus, freemem, loadavg, platform, release, totalmem } from "node:os";

const output = resolve("../EarthHistory-data/palaeomap-study/verification/reconstruction-machinery-v1/gpu-prototype/result.json");
const buildDir = resolve(dirname(output), "dist");
const childCap = 8 * 1024 * 1024; const captureCap = 2 * 1024 * 1024; const parentCap = 32 * 1024 * 1024;
async function treeBytes(path) { const { readdir } = await import("node:fs/promises"); let total=0;
  try { for (const entry of await readdir(path,{withFileTypes:true})) { const p=resolve(path,entry.name); total += entry.isDirectory()?await treeBytes(p):(await stat(p)).size; } } catch (error) { if (error.code !== "ENOENT") throw error; } return total; }
const parentBefore=await treeBytes(resolve(dirname(output),"..")); const childBefore=await treeBytes(dirname(output));
const ownedAdditionCap=2*1024*1024;
const projectedBuildBytes=4*1024*1024;
if(childBefore+projectedBuildBytes>childCap||parentBefore+projectedBuildBytes>parentCap) throw new Error("projected production build exceeds cap");
const labPlugin = { name: "reconstruction-gpu-lab", transformIndexHtml: { order: "pre", handler: () =>
  '<link rel="icon" href="data:,"><div id="status">gpu proof</div><script type="module" src="/scripts/research/reconstruction-gpu-lab.ts"></script>' } };
await build({ logLevel:"error", publicDir:false, plugins:[labPlugin], build:{outDir:buildDir,emptyOutDir:true} });
const server = await preview({ logLevel: "error", publicDir:false, build:{outDir:buildDir}, preview: { host: "127.0.0.1", port: 0 },
  plugins: [{ name: "reconstruction-gpu-lab", transformIndexHtml: { order: "pre", handler: () =>
    '<link rel="icon" href="data:,"><div id="status">gpu proof</div><script type="module" src="/scripts/research/reconstruction-gpu-lab.ts"></script>' } }] });
const address = server.httpServer.address();
if (!address || typeof address === "string") throw new Error("Vite lab address unavailable");
const browser = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"] });
const report = { schemaVersion: 2, recordedUtc: new Date().toISOString(), environment: {
  node: process.version, platform: platform(), release: release(), architecture: process.arch,
  logicalCpuCount: cpus().length, cpuModel: cpus()[0]?.model ?? "unknown", loadAverageBefore: loadavg(),
  freeMemoryBytesBefore: freemem(), totalMemoryBytes: totalmem(), browser: await browser.version(),
  build: "Vite production build served by static preview", headless: true },
  workloadScope: "synthetic representative material patch; not an accepted global reconstruction dataset or full-app performance result",
  ownedOutput: { childBytesBefore: childBefore, parentBytesBefore: parentBefore, additionCapBytes: ownedAdditionCap },
  cases: [], failures: [] };
const pendingShaders = [];
try {
  for (const [backend, mutation] of [["webgpu", ""], ["webgl2", ""], ["webgpu", "axis"], ["webgpu", "lifecycle"]]) {
    const page = await browser.newPage(); const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${address.port}/?backend=${backend}&mutate=${mutation}`);
    const result = await page.evaluate(() => window.runReconstructionGpuProof());
    const shaders = result.shaders; delete result.shaders;
    const shaderStem = `${backend}${mutation ? `-${mutation}-mutation` : ""}`;
    pendingShaders.push([resolve(dirname(output), `${shaderStem}.vertex.txt`), shaders.vertexShader],
      [resolve(dirname(output), `${shaderStem}.fragment.txt`), shaders.fragmentShader]);
    const angular = result.results.map(row => { const a = row.expected; const b = row.witness;
      const cross = [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
      return Math.atan2(Math.hypot(...cross), a[0]*b[0]+a[1]*b[1]+a[2]*b[2]); });
    const radial = result.results.map(row => Math.abs(Math.hypot(...row.witness)-Math.hypot(...row.expected)));
    const finitePrograms = Number.isFinite(result.programsBefore) && Number.isFinite(result.programsAfter);
    const witnessPass = result.fenceReadCount >= 4 && result.results.every(row => row.readCount >= 4 && row.alpha > 0.9 &&
      row.witness.every(Number.isFinite) && Math.hypot(...row.witness) > 0.5);
    const backendPass = backend === "webgpu" ? result.isWebGPUBackend === true : result.isWebGPUBackend === false;
    const numericalPass = witnessPass && angular.every(value => Number.isFinite(value) && value <= result.toleranceRad) &&
      radial.every(value => Number.isFinite(value) && value <= result.toleranceRad);
    const shaderPass = result.shaderWitness.vertexHasWitness && result.shaderWitness.fragmentHasWitness &&
      result.shaderWitness.vertexHasSphericalOps && !result.shaderWitness.fragmentHasSphericalOps;
    const expectedOutcomePass = mutation === "axis" ? (!numericalPass && result.representativePass)
      : mutation === "lifecycle" ? (numericalPass && !result.representativePass
        && result.representative.inactiveColoredPixelCount > 0)
        : (numericalPass && result.representativePass);
    const accepted = errors.length === 0 && result.digestMutationRejected && result.deviceValidationError === null &&
      result.webglError === 0 && backendPass && finitePrograms && result.programsBefore === result.programsAfter && shaderPass &&
      expectedOutcomePass;
    report.cases.push({ ...result, angularErrorRad: angular, radialError: radial, errors, accepted });
    if (!accepted) report.failures.push(`${backend}${mutation?" mutation":""} oracle, representative mesh, BVH/LOD/picking, retirement, shader-stage, or stable-program check failed`);
    await page.close();
  }
} finally { await browser.close(); await new Promise(resolveClose => server.httpServer.close(resolveClose)); }
const encoded = `${JSON.stringify(report, null, 2)}\n`; if (Buffer.byteLength(encoded) > captureCap) throw new Error("capture cap exceeded");
await mkdir(dirname(output), { recursive: true });
const replacementPaths = [output, ...pendingShaders.map(([path]) => path)];
let replacedBytes = 0; for (const path of replacementPaths) { try { replacedBytes += (await stat(path)).size; } catch {} }
const childBeforeEvidence = await treeBytes(dirname(output)); const parentBeforeEvidence = await treeBytes(resolve(dirname(output), ".."));
const evidenceBytes = Buffer.byteLength(encoded) + pendingShaders.reduce((sum, [, contents]) => sum + Buffer.byteLength(contents), 0);
if (childBeforeEvidence - replacedBytes + evidenceBytes > childCap || parentBeforeEvidence - replacedBytes + evidenceBytes > parentCap) {
  throw new Error("projected proof evidence exceeds cap");
}
await writeFile(output, encoded);
for (const [path, contents] of pendingShaders) await writeFile(path, contents);
const childBytes=await treeBytes(dirname(output)); const parentBytes=await treeBytes(resolve(dirname(output),".."));
if(childBytes>childCap||parentBytes>parentCap) throw new Error(`output cap exceeded child=${childBytes} parent=${parentBytes}`);
if (childBytes > childBefore + ownedAdditionCap) throw new Error(`owned output addition exceeded cap: ${childBytes-childBefore}`);
console.log(JSON.stringify({ output, childBytes, parentBytes, addedChildBytes:childBytes-childBefore,
  ownedFiles:replacementPaths, failures: report.failures,
  cases: report.cases.map(c=>({backend:c.backend,accepted:c.accepted,programs:[c.programsBefore,c.programsAfter],
    representative:c.representative})) },null,2));
process.exitCode = report.failures.length ? 1 : 0;
