#!/usr/bin/env node
import fs from "node:fs";
import { ShapeUtils, Vector2 } from "three";

const [metadataPath, directionsPath, outputPath] = process.argv.slice(2);
if (!metadataPath || !directionsPath || !outputPath) throw new Error("usage: metadata directions output");
const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
const bytes = fs.readFileSync(directionsPath);
const directions = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
const indices = [];
const patches = [];

function direction(index) {
  return [directions[index * 3], directions[index * 3 + 1], directions[index * 3 + 2]];
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function normalize(a) { const n = Math.hypot(...a); return a.map((v) => v / n); }

for (const patch of metadata.patches) {
  const centre = normalize(patch.interiorDirection);
  const trial = Math.abs(centre[2]) < 0.8 ? [0, 0, 1] : [1, 0, 0];
  const east = normalize(cross(trial, centre));
  const north = cross(centre, east);
  const projected = [];
  const projectedIds = [];
  let valid = true;
  for (const ring of patch.rings) {
    const values = [];
    const ids = [];
    for (let local = 0; local < ring.count; local += 1) {
      const point = direction(ring.offset + local);
      // Gnomonic projection maps each source great-circle edge to a straight
      // segment, so Earcut diagonals partition the same spherical polygon.
      const denominator = dot(point, centre);
      if (!(denominator > 1e-8) || !Number.isFinite(denominator)) { valid = false; break; }
      values.push(new Vector2(dot(point, east) / denominator, dot(point, north) / denominator));
      ids.push(ring.offset + local);
    }
    if (values.length > 3 && values[0].equals(values.at(-1))) { values.pop(); ids.pop(); }
    const shouldBeClockwise = projected.length === 0;
    if (ShapeUtils.isClockWise(values) !== shouldBeClockwise) { values.reverse(); ids.reverse(); }
    projected.push(values);
    projectedIds.push(ids);
    if (!valid) break;
  }
  if (!valid || projected[0].length < 3) {
    patches.push({ ...patch, status: "unsupported-gnomonic-domain", indexOffset: indices.length, indexCount: 0 });
    continue;
  }
  const localTriangles = ShapeUtils.triangulateShape(projected[0], projected.slice(1));
  const projectedVertices = projected.flat();
  const flattened = projectedIds.flat();
  const indexOffset = indices.length;
  for (const triangle of localTriangles) {
    const [a, b, c] = triangle.map((local) => projectedVertices[local]);
    const twiceArea = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(twiceArea) <= 1e-16) continue;
    const [da, db, dc] = triangle.map((local) => direction(flattened[local]));
    const determinant = Math.abs(dot(da, cross(db, dc)));
    const sphericalArea = 2 * Math.atan2(determinant, 1 + dot(da, db) + dot(db, dc) + dot(dc, da));
    if (!(sphericalArea > 1e-12)) continue;
    for (const local of triangle) indices.push(flattened[local]);
  }
  patches.push({ ...patch, status: localTriangles.length ? "candidate" : "unsupported-triangulation", indexOffset, indexCount: indices.length - indexOffset });
}
const array = new Uint32Array(indices);
fs.writeFileSync(outputPath, Buffer.from(array.buffer));
fs.writeFileSync(`${outputPath}.json`, `${JSON.stringify({ schemaVersion: 1, patches })}\n`);
console.log(JSON.stringify({ patches: patches.length, candidate: patches.filter((p) => p.status === "candidate").length, indices: indices.length }));
