import * as THREE from "three";

export function setInspectionLightPosition(
  target: THREE.Vector3,
  cameraPosition: THREE.Vector3,
): THREE.Vector3 {
  return target.copy(cameraPosition).normalize().multiplyScalar(5.7);
}
