import type { TectonicFeature } from "./types";

export const tectonicFeatures: TectonicFeature[] = [
  {
    id: "andes-subduction",
    name: "Andean subduction margin",
    type: "subduction",
    coordinates: [[-78, 5], [-80, -5], [-78, -15], [-75, -25], [-73, -35], [-74, -45], [-76, -52]],
    widthKm: 180,
    heightKm: 0,
    sourceIds: ["usgs-andes-volcanism-2009"],
    ageStartMa: 23,
    ageEndMa: 0,
    evidence: "synthesis",
    activity: 0.95,
    polarity: 1,
    caveat: "Generalized editorial corridor for regional storytelling, not a digitized plate-boundary dataset.",
  },
  {
    id: "andes-northern-volcanic-zone",
    name: "Northern Andean volcanic zone",
    type: "volcano",
    coordinates: [[-77.8, 2], [-77.4, 0], [-78.2, -2], [-79, -4.5]],
    widthKm: 120,
    heightKm: 5.8,
    sourceIds: ["usgs-andes-volcanism-2009"],
    ageStartMa: 5,
    ageEndMa: 0,
    evidence: "synthesis",
    activity: 0.9,
    caveat: "Broad active arc corridor; individual volcanoes are not implied.",
  },
  {
    id: "andes-central-volcanic-zone",
    name: "Central Andean volcanic zone",
    type: "volcano",
    coordinates: [[-70.5, -15], [-69, -20], [-68, -25], [-68.5, -28]],
    widthKm: 140,
    heightKm: 6.5,
    sourceIds: ["usgs-andes-volcanism-2009"],
    ageStartMa: 5,
    ageEndMa: 0,
    evidence: "synthesis",
    activity: 1,
    caveat: "Separated from adjacent zones to preserve documented volcanic gaps.",
  },
  {
    id: "andes-southern-volcanic-zone",
    name: "Southern Andean volcanic zone",
    type: "volcano",
    coordinates: [[-70, -33], [-71.5, -38], [-72.5, -43], [-73.5, -46]],
    widthKm: 120,
    heightKm: 5.5,
    sourceIds: ["usgs-andes-volcanism-2009"],
    ageStartMa: 5,
    ageEndMa: 0,
    evidence: "synthesis",
    activity: 0.9,
    caveat: "Broad active arc corridor; individual volcanoes are not implied.",
  },
  {
    id: "east-african-rift",
    name: "East African Rift",
    type: "rift",
    coordinates: [[35, 12], [37, 7], [36, 2], [35, -4], [34, -9], [35, -14], [36, -20]],
    widthKm: 160,
    heightKm: -1.2,
    sourceIds: ["ebinger-east-african-rift-2005"],
    ageStartMa: 30,
    ageEndMa: 0,
    evidence: "synthesis",
    activity: 0.85,
    caveat: "Generalized system axis for an aerial story, not an individual-fault trace.",
  },
];

export function tectonicsAt(ageMa: number): TectonicFeature[] {
  // These editorial corridors are authored in present coordinates and do not
  // carry dated boundary topology. Historical boundary assets must use the
  // shared period-coordinate model rather than freezing or rigidly moving them.
  if (Math.abs(ageMa) > 1e-9) return [];
  return tectonicFeatures.filter(
    (feature) =>
      (feature.ageStartMa === undefined || ageMa <= feature.ageStartMa) &&
      (feature.ageEndMa === undefined || ageMa >= feature.ageEndMa),
  );
}
