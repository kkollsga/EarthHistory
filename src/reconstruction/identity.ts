import type { FrameKey } from "./types";

export interface PackageAsset {
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
}

export function packageFrameIdentity(frame: FrameKey): string {
  return [frame.modelId, frame.modelVersion, frame.absoluteFrameId, frame.anchorPlateId, frame.axisConvention,
    frame.rotationSha256, frame.topologySha256].join("\u001f");
}
