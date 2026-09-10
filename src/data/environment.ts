import type { SurfaceStage, WorldSnapshot } from "./types";

/** Authored editorial context; rendered geography and climate remain Cao-package owned. */
export function environmentForAge(ageMa: number): WorldSnapshot["environment"] {
  let stage: SurfaceStage = "modern-biomes";
  let vegetation = 1;
  let biomeStage = 1;
  let oceanCoverage = 0.71;
  let cloudCover = 0.64;
  let atmosphereOpacity = 1;
  let haze = 0.05;
  let iceLatitude = 66;
  let iceIntensity = 0.12;
  let temperatureC = 14;

  if (ageMa > 4530) {
    stage = "accretion"; vegetation = 0; biomeStage = 0; oceanCoverage = 0; cloudCover = 0; atmosphereOpacity = 0.2; haze = 0.8; iceLatitude = 90; iceIntensity = 0; temperatureC = 2200;
  } else if (ageMa > 4500) {
    stage = "giant-impact"; vegetation = 0; biomeStage = 0; oceanCoverage = 0; cloudCover = 0.1; atmosphereOpacity = 0.7; haze = 1; iceLatitude = 90; iceIntensity = 0; temperatureC = 1800;
  } else if (ageMa > 4480) {
    stage = "magma-ocean"; vegetation = 0; biomeStage = 0; oceanCoverage = 0.05; cloudCover = 0.25; atmosphereOpacity = 0.9; haze = 0.9; iceLatitude = 90; iceIntensity = 0; temperatureC = 1100;
  } else if (ageMa > 4420) {
    stage = "cooling-crust"; vegetation = 0; biomeStage = 0; oceanCoverage = 0.18; cloudCover = 0.45; atmosphereOpacity = 0.9; haze = 0.7; iceLatitude = 90; iceIntensity = 0; temperatureC = 450;
  } else if (ageMa > 4000) {
    stage = "growing-oceans"; vegetation = 0; biomeStage = 0; oceanCoverage = 0.55; cloudCover = 0.8; atmosphereOpacity = 0.9; haze = 0.5; iceLatitude = 90; iceIntensity = 0; temperatureC = 70;
  } else if (ageMa > 600) {
    stage = "microbial-world"; vegetation = ageMa <= 3500 ? 0.025 : 0; biomeStage = 0.03; oceanCoverage = 0.68; cloudCover = 0.68; atmosphereOpacity = 0.9; haze = ageMa > 2400 ? 0.5 : 0.24; iceLatitude = 72; iceIntensity = 0.08; temperatureC = 24;
  } else if (ageMa > 475) {
    stage = "barren-continents"; vegetation = 0; biomeStage = 0; haze = 0.1; iceLatitude = 72; iceIntensity = 0.08; temperatureC = 20;
  } else if (ageMa > 390) {
    stage = "early-land-plants"; vegetation = 0.08; biomeStage = 0.12; haze = 0.08; iceLatitude = 67; iceIntensity = 0.12; temperatureC = 18;
  } else if (ageMa > 130) {
    stage = "forest-world"; vegetation = 0.58; biomeStage = 0.55; haze = 0.08; iceLatitude = 70; iceIntensity = 0.08; temperatureC = 19;
  } else if (ageMa > 5) {
    stage = "flowering-plants"; vegetation = 0.82; biomeStage = 0.82; haze = 0.06; iceLatitude = 69; iceIntensity = 0.1; temperatureC = 18;
  }

  if (ageMa >= 630 && ageMa <= 725) {
    iceLatitude = 8; iceIntensity = 0.95; cloudCover = 0.55; temperatureC = -15;
  } else if (ageMa >= 33 && ageMa <= 38) {
    iceLatitude = 58; iceIntensity = 0.55; temperatureC = 12;
  } else if (ageMa > 0 && ageMa < 0.03) {
    iceLatitude = 44; iceIntensity = 0.8; vegetation = 0.72; temperatureC = 9;
  }

  return { iceLatitude, vegetation, temperatureC, stage, oceanCoverage, cloudCover, atmosphereOpacity, haze, iceIntensity, biomeStage };
}
