import * as THREE from "three";

export interface InspectionLightScratch {
  view: THREE.Vector3;
  right: THREE.Vector3;
  upward: THREE.Vector3;
}

export function setInspectionLightPosition(
  target: THREE.Vector3,
  cameraPosition: THREE.Vector3,
  cameraQuaternion: THREE.Quaternion,
  scratch: InspectionLightScratch,
): THREE.Vector3 {
  scratch.view.copy(cameraPosition).normalize();
  scratch.right.set(-1, 0, 0).applyQuaternion(cameraQuaternion);
  scratch.upward.set(0, 1, 0).applyQuaternion(cameraQuaternion);
  return target
    .copy(scratch.view)
    .multiplyScalar(4.2)
    .addScaledVector(scratch.right, -3.4)
    .addScaledVector(scratch.upward, 1.8);
}
