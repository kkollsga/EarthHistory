import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { materialsReferenceAnyTexture } from "./GlobeScene";

describe("surface texture lifetime", () => {
  it("retains an old global albedo while a held cube still binds it", () => {
    const oldAlbedo = new THREE.Texture();
    const replacementAlbedo = new THREE.Texture();
    const heldCubeMaterial = new THREE.MeshPhysicalMaterial({ map: oldAlbedo });
    const retiredSet = new Set<THREE.Texture>([oldAlbedo]);

    expect(materialsReferenceAnyTexture([heldCubeMaterial], retiredSet)).toBe(true);

    heldCubeMaterial.map = replacementAlbedo;
    expect(materialsReferenceAnyTexture([heldCubeMaterial], retiredSet)).toBe(false);

    heldCubeMaterial.dispose();
    oldAlbedo.dispose();
    replacementAlbedo.dispose();
  });

  it("recognizes non-albedo bindings owned by the same surface set", () => {
    const oldClouds = new THREE.Texture();
    const cloudMaterial = new THREE.MeshStandardMaterial({
      map: oldClouds,
      alphaMap: oldClouds,
    });

    expect(materialsReferenceAnyTexture([cloudMaterial], new Set([oldClouds]))).toBe(true);

    cloudMaterial.dispose();
    oldClouds.dispose();
  });
});
