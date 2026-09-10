export type SurfaceCell = 0 | 1 | 2; // unknown, sea, land

export interface ClimateEvidence {
  readonly sourceIds: readonly string[];
  readonly methodId: "schematic-geographic-climate-v1";
  readonly methodVersion: 1;
  readonly status: "procedural-synthesis";
  readonly limitations: readonly string[];
}

export interface WindBand {
  readonly minimumLatitude: number;
  readonly maximumLatitude: number;
  /** Positive is eastward. Values are directional controls, not measured speed. */
  readonly zonal: -1 | 0 | 1;
  readonly meridional: -1 | 0 | 1;
}

export interface ClimatePotentialControls {
  readonly globalMeanTemperatureC: number;
  readonly equatorToPoleTemperatureC: number;
  readonly lapseRateCPerKm: number;
  readonly windBands: readonly WindBand[];
  readonly maximumUpwindSteps: number;
  readonly landDryingPerStep: number;
  readonly orographicMoistureLossPerKm: number;
  readonly snowTemperatureThresholdC: number;
  readonly landBiologyEligible: boolean;
  readonly biologyCapacity: number;
  readonly maximumCells: number;
  readonly maximumOutputBytes: number;
  readonly evidence: ClimateEvidence;
}

export interface ClimateGeographyInput {
  readonly revisionIdentity: string;
  readonly requestedAgeMa: number;
  readonly width: number;
  readonly height: number;
  readonly surface: Uint8Array;
  readonly elevationMetres: Float32Array;
}

export interface ClimatePotentialField {
  readonly identity: string;
  readonly revisionIdentity: string;
  readonly requestedAgeMa: number;
  readonly width: number;
  readonly height: number;
  readonly status: Uint8Array;
  readonly temperatureC: Float32Array;
  readonly moisturePotential: Float32Array;
  readonly snowPotential: Float32Array;
  readonly biologyPotential: Float32Array;
  readonly evidence: ClimateEvidence;
  readonly byteLength: number;
}

export interface ClimateCancellation {
  readonly signal?: AbortSignal;
  readonly isCurrentRevision?: () => boolean;
}
