import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RefObject } from "react";
import * as THREE from "three";
import {
  EffectComposer,
  FilmPass,
  RGBShiftShader,
  RenderPass,
  ShaderPass,
  UnrealBloomPass,
  VignetteShader,
} from "three-stdlib";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import type { Project } from "../data/projects";
import { CORE_DUST_TUNING } from "./coreDustTuning";

type Vector3 = [number, number, number];

type ConstellationSceneProps = {
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (projectId: string | null) => void;
  reducedMotion: boolean;
  onReady?: () => void;
  introUnlocked?: boolean;
};

type SceneContentProps = ConstellationSceneProps & {
  isMobileViewport: boolean;
};

type Connection = {
  id: string;
  points: [Vector3, Vector3];
  projects: [string, string];
};

type ConnectionVisual = Connection & {
  midpoint: Vector3;
  quaternion: [number, number, number, number];
  length: number;
};

type FocusSwapTracePath = {
  start: THREE.Vector3;
  direction: THREE.Vector3;
  quaternion: [number, number, number, number];
  length: number;
};

type FocusSwapTraceState = {
  renderedMidpoint: Vector3;
  renderedLength: number;
  tracerCenter: Vector3;
  tracerLength: number;
  baseOpacity: number;
  tracerOpacity: number;
};

type ProjectNodeProps = {
  project: Project;
  isActive: boolean;
  isHovered: boolean;
  mapVisibility: number;
  nodeDisplayMode: "neutral" | "background";
  neutralBlendOverride: number | null;
  introRevealRef: RefObject<number>;
  introRevealOffset: number;
  reducedMotion: boolean;
  onHover: (projectId: string | null) => void;
  onSelect: (projectId: string | null) => void;
};

type CameraRigProps = {
  projects: Project[];
  activeProject: Project | null;
  controlsRef: RefObject<OrbitControlsImpl | null>;
  reducedMotion: boolean;
  isMobileViewport: boolean;
  introUnlocked: boolean;
  onTransitionHalfway?: () => void;
  onTransitionProgress?: (progress: number) => void;
};

type IntroConnectionSegmentProps = {
  connection: ConnectionVisual;
  connectionIndex: number;
  lineColor: string;
  lineBaseOpacity: number;
  introSequenceActive: boolean;
  introRevealActive: boolean;
  introRevealProgressRef: RefObject<number>;
  reverseTracer: boolean;
};

type CameraTransitionMode =
  | "neutral-intro"
  | "neutral-to-focus"
  | "focus-to-neutral"
  | "focus-to-focus";

type HeroKind = "storm" | "harmonic" | "pulse";

type HeroStyle = {
  kind: HeroKind;
  accent: string;
  secondary: string;
  swarmCount: number;
  swarmSize: number;
  shellScale: number;
};

type HeroParticleField = {
  profile: "stream" | "dust";
  positions: Float32Array;
  velocities: Float32Array;
  basePositions: Float32Array;
  speeds: Float32Array;
  phases: Float32Array;
  radii: Float32Array;
  bands: Float32Array;
  lifts: Float32Array;
  sizes: Float32Array;
  flickers: Float32Array;
  count: number;
};

type EtherealFilamentConfig = {
  filamentCount: number;
  trailLength: number;
  orbitStrength: number;
  windStrength: number;
  drag: number;
  shellDistance: number;
  filamentWidth: number;
  emissionIntensity: number;
  noiseSpeed: number;
  radialDrift: number;
  containment: number;
  crossSectionSegments: number;
};

type CoreDustProfile = {
  radiusScale: number;
  density: number;
  detail: number;
  noiseScale: number;
  noiseSpeed: number;
  opacity: number;
  windTempo: number;
  feather: number;
  stepCount: number;
  phaseOffset: number;
};

type EtherealFilamentField = {
  config: EtherealFilamentConfig;
  ringCount: number;
  phases: Float32Array;
  orbitScales: Float32Array;
  radii: Float32Array;
  widthScales: Float32Array;
  axisVectors: Float32Array;
  headPositions: Float32Array;
  headVelocities: Float32Array;
  history: Float32Array;
  geometry: THREE.BufferGeometry;
  positionAttribute: THREE.BufferAttribute;
};

type WireTraceGraph = {
  nodes: THREE.Vector3[];
  adjacency: number[][];
};

type NeutralStarInstances = {
  positions: Float32Array;
  scales: Float32Array;
  count: number;
};

type HeroWorldProps = {
  project: Project;
  reducedMotion: boolean;
  isMobileViewport: boolean;
  presenceTarget: number;
  collapseParticlesOnFadeOut: boolean;
  prewarmActive: boolean;
};

type CinematicBloomProps = {
  project: Project | null;
  reducedMotion: boolean;
  isMobileViewport: boolean;
};

const CONNECTION_DISTANCE = 6.2;
const HERO_PRECOMPILE_IDLE_TIMEOUT_MS = 900;
const HERO_WORLD_MOUNT_DELAY_MS = 220;
const HERO_WORLD_MOUNT_IDLE_TIMEOUT_MS = 1200;
const INTRO_REVEAL_DURATION_S = 2.6;
const INTRO_WARMUP_FRAME_COUNT = 20;
const INTRO_WARMUP_MIN_TIME_MS = 480;
const INTRO_WARMUP_PROGRAM_STABLE_FRAMES = 8;
const INTRO_FONT_READY_TIMEOUT_MS = 1800;
const INTRO_CONNECTION_SPEED_MULTIPLIER = 0.92;
const HERO_SHELL_WIREFRAME_VISIBILITY = 1.1;
const ENABLE_SCENE_FOG = false;
const ENABLE_CORE_DUST_FOG = false;
const ENABLE_CORE_STAR_BLOCKER = false;
const MOBILE_BREAKPOINT_PX = 820;
const SCENE_EXPOSURE = 1.62;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const WHITE = new THREE.Color("#ffffff");
const BLACK = new THREE.Color("#000000");

function useMobileViewport(maxWidth = MOBILE_BREAKPOINT_PX) {
  const query = `(max-width: ${maxWidth}px)`;
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const media = window.matchMedia(query);
    const update = () => {
      setIsMobileViewport(media.matches);
    };

    update();

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      return () => {
        media.removeEventListener("change", update);
      };
    }

    media.addListener(update);
    return () => {
      media.removeListener(update);
    };
  }, [query]);

  return isMobileViewport;
}
const CORE_VERTEX_SHADER = `
varying vec3 vNormal;
varying vec3 vWorldPos;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPosition.xyz;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CORE_FRAGMENT_SHADER = `
uniform vec3 uColor;
uniform float uTime;
uniform float uIntensity;
uniform float uEnergy;

varying vec3 vNormal;
varying vec3 vWorldPos;

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float ndotV = max(dot(normal, viewDir), 0.001);

  vec3 keyLightDir = normalize(vec3(0.46, 0.78, 0.38));
  vec3 fillLightDir = normalize(vec3(-0.64, 0.2, -0.48));
  vec3 rimLightDir = normalize(vec3(-0.22, 0.58, -0.78));

  float keyNdotL = max(dot(normal, keyLightDir), 0.0);
  float fillNdotL = max(dot(normal, fillLightDir), 0.0);
  float rimNdotL = max(dot(normal, rimLightDir), 0.0);

  float wrappedKey = pow(clamp((keyNdotL + 0.24) / 1.24, 0.0, 1.0), 1.06);
  float wrappedFill = clamp((fillNdotL + 0.42) / 1.42, 0.0, 1.0);
  float rimMask = pow(1.0 - ndotV, 2.0);

  vec3 hemiGround = vec3(0.08, 0.09, 0.12);
  vec3 hemiSky = vec3(0.34, 0.39, 0.48);
  vec3 hemi = mix(hemiGround, hemiSky, clamp(normal.y * 0.5 + 0.5, 0.0, 1.0));

  float roughness = clamp(0.44 - uEnergy * 0.17, 0.24, 0.56);
  float a = roughness * roughness;
  float a2 = a * a;
  vec3 halfVector = normalize(keyLightDir + viewDir);
  float ndotH = max(dot(normal, halfVector), 0.0);
  float vdoth = max(dot(viewDir, halfVector), 0.0);
  float denom = ndotH * ndotH * (a2 - 1.0) + 1.0;
  float distribution = a2 / max(0.0001, 3.14159265 * denom * denom);
  float k = (roughness + 1.0);
  k = (k * k) / 8.0;
  float visibilityV = ndotV / (ndotV * (1.0 - k) + k);
  float visibilityL = keyNdotL / (keyNdotL * (1.0 - k) + k);
  float geometry = visibilityV * visibilityL;
  vec3 fresnelTerm = vec3(0.04) + (vec3(1.0) - vec3(0.04)) * pow(1.0 - vdoth, 5.0);
  vec3 specular = (distribution * geometry * fresnelTerm) /
    max(0.001, 4.0 * ndotV * keyNdotL);
  float fresnel = pow(1.0 - ndotV, 2.3);
  float pulse = 0.94 + sin(uTime * 1.35) * 0.06;
  vec3 baseColor = uColor;
  vec3 lightMix =
    hemi * 0.48 +
    vec3(1.0, 0.98, 0.96) * wrappedKey * 0.66 +
    vec3(0.66, 0.72, 0.8) * wrappedFill * 0.24;

  vec3 color = baseColor * lightMix;
  color += mix(uColor, vec3(1.0), 0.24) * rimNdotL * rimMask * 0.22;
  color += specular * (0.32 + uEnergy * 0.4);
  color += mix(uColor, vec3(1.0), 0.2) * fresnel * 0.1;
  color *= pulse * (0.74 + uIntensity * 0.34);
  float alpha = clamp(
    (0.42 + wrappedKey * 0.26 + wrappedFill * 0.12 + fresnel * 0.08) *
      uIntensity,
    0.0,
    0.95
  );

  gl_FragColor = vec4(color, alpha);
}
`;

const CORE_DUST_VERTEX_SHADER = `
varying vec3 vLocalPos;
varying vec3 vWorldPos;

void main() {
  vLocalPos = position;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPosition.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CORE_DUST_FRAGMENT_SHADER = `
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uSecondary;
uniform float uOpacity;
uniform float uIntensity;
uniform float uRadius;
uniform float uDensity;
uniform float uDetail;
uniform float uNoiseScale;
uniform float uNoiseSpeed;
uniform float uStepCount;
uniform float uFeather;
uniform vec3 uCameraLocal;
uniform vec3 uLightDirLocal;
uniform vec3 uWindPrimary;
uniform vec3 uWindSecondary;

varying vec3 vLocalPos;
varying vec3 vWorldPos;

float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float hash3(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}

float valueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);

  float n000 = hash3(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash3(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash3(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash3(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash3(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash3(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash3(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash3(i + vec3(1.0, 1.0, 1.0));

  float nx00 = mix(n000, n100, u.x);
  float nx10 = mix(n010, n110, u.x);
  float nx01 = mix(n001, n101, u.x);
  float nx11 = mix(n011, n111, u.x);
  float nxy0 = mix(nx00, nx10, u.y);
  float nxy1 = mix(nx01, nx11, u.y);
  return mix(nxy0, nxy1, u.z);
}

float fbm3(vec3 p) {
  float value = 0.0;
  float amplitude = 0.5;

  for (int i = 0; i < 3; i++) {
    value += amplitude * valueNoise(p);
    p = p * 2.01 + vec3(13.7, 7.1, 5.3);
    amplitude *= 0.5;
  }

  return value;
}

float fbm3Low(vec3 p) {
  float value = 0.0;
  float amplitude = 0.5;

  for (int i = 0; i < 2; i++) {
    value += amplitude * valueNoise(p);
    p = p * 2.03 + vec3(11.3, 6.1, 4.7);
    amplitude *= 0.5;
  }

  return value;
}

float sdIcosahedron(vec3 p, float r) {
  const float a = 0.850650808352;
  const float b = 0.525731112119;
  p = abs(p);
  float d1 = dot(p, normalize(vec3(a, b, 0.0)));
  float d2 = dot(p, normalize(vec3(b, 0.0, a)));
  float d3 = dot(p, normalize(vec3(0.0, a, b)));
  return max(max(d1, d2), d3) - r;
}

float phaseHG(float mu, float g) {
  float g2 = g * g;
  float denom = pow(max(0.001, 1.0 + g2 - 2.0 * g * mu), 1.5);
  return (1.0 - g2) / (4.0 * 3.14159265 * denom);
}

vec3 safeNormalize(vec3 v) {
  return v * inversesqrt(max(dot(v, v), 1e-8));
}

float densityField(
  vec3 p,
  float t,
  vec3 windPrimary,
  vec3 windSecondary,
  float radius,
  float noiseScale,
  float detailGain,
  float feather
) {
  vec3 q = p / max(radius, 0.0001);
  float boundary = sdIcosahedron(p, radius);
  float shellMask = smoothstep(
    feather * radius * ${CORE_DUST_TUNING.shader.shellMaskOuterScale},
    ${CORE_DUST_TUNING.shader.shellMaskInnerFactor} * radius,
    boundary
  );
  float shellDepth = clamp(-boundary / max(radius, 0.0001), 0.0, 1.0);
  float edgeSoft = pow(
    smoothstep(${CORE_DUST_TUNING.shader.edgeSoftStart}, ${CORE_DUST_TUNING.shader.edgeSoftEnd}, shellDepth),
    ${CORE_DUST_TUNING.shader.edgeSoftPower}
  );
  float nearShell = smoothstep(-0.52 * radius, 0.08 * radius, boundary);
  if (shellMask <= 0.0001) {
    return 0.0;
  }

  vec3 n = safeNormalize(p + vec3(1e-5, 0.0, 0.0));
  vec3 shearDir = windPrimary - n * dot(windPrimary, n);
  float shearLen = length(shearDir);
  if (shearLen > 0.0001) {
    shearDir /= shearLen;
  } else {
    shearDir = safeNormalize(cross(n, vec3(0.0, 1.0, 0.0)));
    if (length(shearDir) < 0.0001) {
      shearDir = vec3(1.0, 0.0, 0.0);
    }
  }

  vec3 faceDir = cross(shearDir, n);
  if (dot(faceDir, faceDir) < 1e-8) {
    faceDir = cross(shearDir, vec3(0.0, 0.0, 1.0));
  }
  if (dot(faceDir, faceDir) < 1e-8) {
    faceDir = vec3(0.0, 1.0, 0.0);
  }
  faceDir = safeNormalize(faceDir);

  float alongWind = dot(q, windPrimary);
  vec3 lateralToWind = q - windPrimary * alongWind;
  float jetWidth = 0.12;
  float jetCore = exp(-dot(lateralToWind, lateralToWind) / max(jetWidth * jetWidth, 1e-4));
  float radialLen = length(lateralToWind);
  vec3 tangential = cross(windPrimary, lateralToWind);
  float tangentialLen = length(tangential);
  if (tangentialLen > 0.0001) {
    tangential /= tangentialLen;
  } else {
    tangential = faceDir;
  }
  float swirlBand = sin(t * 0.28 + radialLen * 7.0 + alongWind * 3.6);
  float swirlShell = smoothstep(0.0, 0.76, radialLen) * (0.34 + nearShell * 0.66);
  float spiralBand = sin(t * 0.2 + radialLen * 5.2 - alongWind * 2.4);

  float gust = sin(t * 0.06 + alongWind * 0.8);
  float stretch = 1.02 + gust * 0.02;
  vec3 stretchedQ =
    windPrimary * (alongWind / max(stretch, 0.78)) +
    lateralToWind * (1.0 - gust * 0.012);

  vec3 flow = stretchedQ * noiseScale;
  flow += windPrimary * (t * (0.14 + jetCore * 0.12));
  flow -= windSecondary * (t * 0.105);
  flow += shearDir * (t * 0.44) * (0.5 + nearShell * 0.5);
  flow += shearDir * dot(q, shearDir) * (0.18 + nearShell * 0.28);
  flow += tangential * swirlBand * (0.36 + detailGain * 0.16) * (0.56 + swirlShell * 0.44);
  flow += faceDir * spiralBand * (0.12 + nearShell * 0.18);

  float warp = fbm3Low(flow * 1.25 + vec3(5.1, 2.3, 1.7)) - 0.5;
  flow += windSecondary * warp * (1.2 + detailGain * 0.36);
  flow += vec3(
    sin((q.y + warp) * 2.1 + t * 0.04),
    sin((q.z - warp) * 1.9 - t * 0.03),
    sin((q.x + warp) * 2.0 + t * 0.028)
  ) * 0.3;
  float vortexNoise = fbm3Low(flow * 0.92 + vec3(2.4, 7.9, 1.3)) - 0.5;
  flow += tangential * vortexNoise * (0.42 + nearShell * 0.32);

  float base = fbm3(flow * 1.12 + vec3(0.0, t * 0.03, 0.0));
  float detail = fbm3Low(flow * 2.35 + vec3(6.8, 3.3, 4.2));
  float erosion = fbm3Low(flow * 4.0 + vec3(12.1, 9.7, 5.6));

  float cloud = mix(base, detail, 0.42 + detailGain * 0.16) - erosion * (0.18 + detailGain * 0.1);
  cloud = smoothstep(0.24, 0.82, cloud);
  cloud = pow(cloud, 1.1);

  float radial = 1.0 - smoothstep(0.62, 1.04, length(q));
  radial = pow(clamp(radial, 0.0, 1.0), 1.18);
  float packed = smoothstep(-0.26, 0.94, dot(q, windPrimary));
  float wisp = 0.97 + 0.03 * sin(t * 0.12 + q.x * 1.2 + q.z * 1.1 + q.y * 0.9);
  float faceBand = exp(-abs(boundary) / max(radius * 0.14, 0.0001));
  float faceStreak = 0.9 + 0.1 * sin(dot(q, shearDir) * 8.0 + dot(q, faceDir) * 4.6 + t * 0.12);
  float ridge = smoothstep(0.2, 0.62, abs(base - detail));
  float jetPulse = 0.9 + 0.1 * sin(alongWind * 5.2 - t * 0.12 + warp * 1.2);
  float jet = jetCore * jetPulse;
  float jetEdge = smoothstep(0.12, 0.46, jetCore) * (1.0 - smoothstep(0.46, 0.82, jetCore));
  float cohesionNoise = fbm3Low(q * 0.55 + vec3(t * 0.018, -t * 0.014, t * 0.016));
  vec3 attractorA =
    windPrimary * (sin(t * 0.07) * 0.28) +
    windSecondary * (cos(t * 0.06 + 1.3) * 0.24);
  vec3 attractorB =
    faceDir * (sin(t * 0.08 + 0.9) * 0.26) -
    windSecondary * (sin(t * 0.05 + 2.1) * 0.18);
  float attractA = exp(-dot(q - attractorA, q - attractorA) / 0.28);
  float attractB = exp(-dot(q - attractorB, q - attractorB) / 0.24);
  float cohesion = smoothstep(0.18, 0.86, cohesionNoise * 0.86 + attractA * 1.25 + attractB * 1.05 + packed * 0.28);

  float density = cloud * radial * shellMask * wisp;
  density *= mix(0.7, 1.22, packed);
  density *= 0.9 + ridge * 0.55;
  density *= 1.0 + nearShell * (0.18 + packed * 0.34);
  density *= mix(0.86, 1.58, cohesion);
  density += cloud * nearShell * 0.08;
  density += faceBand * faceStreak * (0.08 + nearShell * 0.12);
  density += shellMask * (0.04 + nearShell * 0.08) * (0.4 + detail * 0.56);
  density += shellMask * cohesion * (0.02 + nearShell * 0.03);
  density *= 1.0 - jet * 0.1;
  density += jetEdge * 0.028 * (0.45 + ridge * 0.55);
  density = max(density, shellMask * radial * cohesion * 0.015);
  density *= edgeSoft;
  return max(density, 0.0);
}

float shadowDensityField(
  vec3 p,
  float t,
  vec3 windPrimary,
  float radius,
  float noiseScale,
  float feather
) {
  float boundary = sdIcosahedron(p, radius);
  float shellMask = smoothstep(
    feather * radius * ${CORE_DUST_TUNING.shader.shellMaskOuterScale},
    ${CORE_DUST_TUNING.shader.shadowShellMaskInnerFactor} * radius,
    boundary
  );
  float shellDepth = clamp(-boundary / max(radius, 0.0001), 0.0, 1.0);
  float edgeSoft = pow(
    smoothstep(${CORE_DUST_TUNING.shader.edgeSoftStart}, ${CORE_DUST_TUNING.shader.edgeSoftEnd}, shellDepth),
    ${CORE_DUST_TUNING.shader.edgeSoftPower}
  );
  if (shellMask <= 0.0001) {
    return 0.0;
  }

  vec3 q = p / max(radius, 0.0001);
  vec3 flow = q * (noiseScale * 0.92) + windPrimary * (t * 0.05);
  float n = fbm3Low(flow * 1.55 + vec3(4.7, 1.9, 3.1));
  return smoothstep(0.34, 0.82, n) * shellMask * edgeSoft;
}

void main() {
  float radius = max(uRadius, 0.0001);
  vec3 ro = uCameraLocal;
  vec3 rd = normalize(vLocalPos - ro);
  vec3 lightDir = normalize(uLightDirLocal);
  vec3 windPrimary = normalize(uWindPrimary);
  vec3 windSecondary = normalize(uWindSecondary);
  float t = uTime * uNoiseSpeed * ${CORE_DUST_TUNING.shader.timeScale};

  float b = dot(ro, rd);
  float c = dot(ro, ro) - radius * radius;
  float h = b * b - c;
  if (h <= 0.0) {
    discard;
  }

  h = sqrt(h);
  float tMin = max(0.0, -b - h);
  float tMax = -b + h;
  if (tMax <= tMin) {
    discard;
  }
  float silhouetteFade = smoothstep(0.0, radius * ${CORE_DUST_TUNING.shader.silhouetteFadeRadiusFactor}, h);

  const int STEPS = 32;
  float marchSteps = max(10.0, uStepCount);
  float stepLen = (tMax - tMin) / marchSteps;
  float jitter = hash3(vLocalPos * 57.0 + vec3(0.13, 0.71, 0.37));
  float travel = tMin + stepLen * jitter;

  float transmittance = 1.0;
  vec3 accumulated = vec3(0.0);

  for (int i = 0; i < STEPS; i++) {
    if (float(i) >= marchSteps || travel > tMax || transmittance < 0.055) {
      break;
    }

    vec3 samplePos = ro + rd * travel;
    if (sdIcosahedron(samplePos, radius) > 0.0) {
      travel += stepLen;
      continue;
    }

    float density = densityField(samplePos, t, windPrimary, windSecondary, radius, uNoiseScale, uDetail, uFeather);
    if (density < ${CORE_DUST_TUNING.shader.densityCutoff}) {
      travel += stepLen;
      continue;
    }

    float shadowA = shadowDensityField(samplePos + lightDir * (radius * 0.2), t, windPrimary, radius, uNoiseScale, uFeather);
    float shadow = exp(-(shadowA * 1.15) * 1.35);

    float mu = dot(-rd, lightDir);
    float phase = 0.45 + 0.55 * phaseHG(mu, 0.26);
    float powder = 1.0 - exp(-density * 2.1);
    vec3 albedo = mix(uSecondary, uColor, 0.24 + density * 0.62);

    vec3 ambient = albedo * (0.2 + powder * 0.16);
    vec3 direct = albedo * shadow * phase * (0.32 + uIntensity * 0.44);
    vec3 innerGlow = mix(mix(uSecondary, uColor, 0.72), vec3(1.0), 0.03) * pow(density, 1.14) * (0.04 + uIntensity * 0.08);

    float sigmaT = density * uDensity * (1.14 + uIntensity * 0.44);
    float sampleAlpha = (1.0 - exp(-sigmaT * stepLen)) * transmittance;
    sampleAlpha = min(sampleAlpha, ${CORE_DUST_TUNING.shader.sampleAlphaCap});
    accumulated += (ambient + direct + innerGlow) * sampleAlpha;
    transmittance *= exp(-sigmaT * stepLen);
    travel += stepLen;
  }

  float alpha = (1.0 - transmittance) * uOpacity * (0.84 + uIntensity * 0.22);
  vec3 color = accumulated * (0.78 + uIntensity * 0.2) * silhouetteFade;
  alpha *= silhouetteFade;

  if (alpha < 0.0006 && length(color) < 0.0006) {
    discard;
  }

  gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.58));
}
`;

const SHELL_VERTEX_SHADER = `
varying vec3 vNormal;
varying vec3 vWorldPos;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPosition.xyz;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SHELL_FRAGMENT_SHADER = `
uniform vec3 uColor;
uniform float uTime;
uniform float uIntensity;

varying vec3 vNormal;
varying vec3 vWorldPos;

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 1.55);
  float edge = pow(fresnel, 1.5);
  float flow = 0.5 + 0.5 * sin((vWorldPos.y * 6.2 + vWorldPos.x * 2.1) + uTime * 0.58);

  vec3 color = uColor * (0.8 + flow * 0.12 + edge * 0.06) * (0.92 + uIntensity * 0.18);
  float alpha = clamp((0.46 + flow * 0.06) * uIntensity, 0.0, 0.82);
  gl_FragColor = vec4(color, alpha);
}
`;

const ETHEREAL_FILAMENT_VERTEX_SHADER = `
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormal;

void main() {
  vUv = uv;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPosition.xyz;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ETHEREAL_FILAMENT_FRAGMENT_SHADER = `
uniform vec3 uColor;
uniform vec3 uSecondary;
uniform float uTime;
uniform float uOpacity;
uniform float uIntensity;
uniform float uEmission;
uniform float uNoiseSpeed;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormal;

void main() {
  float along = vUv.y;
  float head = smoothstep(0.0, 0.12, along);
  float tail = 1.0 - smoothstep(0.72, 1.0, along);
  float taper = head * tail;

  float worldFlow = dot(vWorldPos, vec3(0.52, 0.34, 0.47));
  float stream = sin(along * 11.0 - uTime * uNoiseSpeed + worldFlow * 0.42) * 0.5 + 0.5;
  float shimmer = sin(along * 24.0 + uTime * (uNoiseSpeed * 0.48) - worldFlow * 0.36) * 0.5 + 0.5;

  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 1.15);
  float mist = (0.42 + taper * 0.58) * (0.62 + fresnel * 0.38);
  float core = taper * (0.2 + stream * 0.2);
  float pulse = 0.64 + stream * 0.16 + shimmer * 0.12;

  vec3 color = mix(uSecondary, uColor, 0.22 + stream * 0.78);
  color *= pulse * (0.3 + uIntensity * 0.44) * (0.72 + (core + mist) * uEmission * 0.4);

  float alpha = uOpacity * (mist * 0.74 + core * 0.26) * (0.44 + uIntensity * 0.38);
  alpha = min(alpha * 0.78, 0.3);
  gl_FragColor = vec4(color, alpha);
}
`;

const STREAM_SWARM_VERTEX_SHADER = `
attribute float aSize;
attribute float aFlicker;

uniform float uTime;
uniform float uBaseSize;
uniform float uPixelRatio;
uniform float uIntensity;

varying float vPulse;
varying float vDepthFade;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float twinkle = sin(uTime * (1.2 + aFlicker * 2.4) + aFlicker * 23.0) * 0.5 + 0.5;
  vPulse = twinkle;
  vDepthFade = clamp(1.0 - (-mvPosition.z / 26.0), 0.0, 1.0);
  float size = (uBaseSize * aSize * (0.42 + twinkle * 0.78) * uPixelRatio * uIntensity) / max(0.08, -mvPosition.z);
  gl_PointSize = size;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const STREAM_SWARM_FRAGMENT_SHADER = `
uniform vec3 uColor;
uniform float uOpacity;

varying float vPulse;
varying float vDepthFade;

void main() {
  vec2 centered = gl_PointCoord * 2.0 - 1.0;
  float distanceSquared = dot(centered, centered);

  if (distanceSquared > 1.0) {
    discard;
  }

  float core = exp(-distanceSquared * 12.6);
  float halo = exp(-distanceSquared * 6.4);
  float edge = pow(smoothstep(1.0, 0.0, distanceSquared), 1.22);
  float glow = (core * 0.94 + halo * 0.06) * edge * (0.52 + vPulse * 0.48) * (0.62 + vDepthFade * 0.38);
  vec3 color = uColor * (0.74 + vPulse * 0.2);

  gl_FragColor = vec4(color, glow * uOpacity);
}
`;

const NEBULA_VERTEX_SHADER = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const NEBULA_FRAGMENT_SHADER = `
uniform float uTime;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uScale;

varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);

  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;

  for (int i = 0; i < 4; i++) {
    value += amplitude * noise(p);
    p = p * 2.03 + vec2(17.3, 9.2);
    amplitude *= 0.5;
  }

  return value;
}

void main() {
  vec2 centered = vUv * 2.0 - 1.0;
  float radial = 1.0 - smoothstep(0.18, 1.08, length(centered));
  vec2 flow = vUv * uScale + vec2(uTime * 0.007, -uTime * 0.005);
  float cloud = fbm(flow) * 0.65 + fbm(flow * 1.8 + vec2(4.0, 1.6)) * 0.35;
  float wisps = smoothstep(0.4, 0.9, cloud) * radial;
  float alpha = wisps * uOpacity * (0.28 + radial * 0.72);
  vec3 color = uColor * (0.3 + cloud * 0.7);

  gl_FragColor = vec4(color, alpha);
}
`;

const TRACER_VERTEX_SHADER = `
uniform float uHeadAtStart;
uniform float uTipScale;

varying vec2 vUv;

void main() {
  vUv = uv;
  float along = uHeadAtStart > 0.5 ? uv.y : (1.0 - uv.y);
  float taper = mix(uTipScale, 1.0, smoothstep(0.0, 1.0, along));
  vec3 transformed = position;
  transformed.xz *= taper;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}
`;

const TRACER_FRAGMENT_SHADER = `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uHeadAtStart;
uniform float uTailFalloff;

varying vec2 vUv;

void main() {
  float along = uHeadAtStart > 0.5 ? vUv.y : (1.0 - vUv.y);
  float alpha = uOpacity * exp(-along * uTailFalloff);
  gl_FragColor = vec4(uColor, alpha);
}
`;

const INTRO_TRACER_COLOR = new THREE.Color("#e8f2ff");
const INTRO_TRACER_CORONA_COLOR = new THREE.Color("#a3ccff");
const FOCUS_TRACER_COLOR = INTRO_TRACER_COLOR.clone();
const FOCUS_TRACER_CORONA_COLOR = INTRO_TRACER_CORONA_COLOR.clone();

function getHash(seed: string): number {
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

function createRandom(seed: number) {
  let state = seed;

  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createNeutralStarInstances(
  seed: string,
  count: number,
  radius: number,
  depthSpread: number,
  sizeRange: [number, number]
): NeutralStarInstances {
  const random = createRandom(getHash(seed) + count * 13);
  const positions = new Float32Array(count * 3);
  const scales = new Float32Array(count);

  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    const u = random();
    const v = random();
    const theta = u * Math.PI * 2;
    const phi = Math.acos(2 * v - 1);
    const shellRadius = radius + (random() - 0.5) * depthSpread;
    const sinPhi = Math.sin(phi);

    positions[offset] = shellRadius * sinPhi * Math.cos(theta);
    positions[offset + 1] = shellRadius * Math.cos(phi);
    positions[offset + 2] = shellRadius * sinPhi * Math.sin(theta);

    const [minScale, maxScale] = sizeRange;
    const sparkle = random();

    const scaleBase = minScale + random() * (maxScale - minScale);

    if (sparkle > 0.985) {
      scales[index] = scaleBase * (1.38 + random() * 0.58);
    } else {
      scales[index] = scaleBase;
    }
  }

  return {
    positions,
    scales,
    count,
  };
}

function clamp01(value: number) {
  return THREE.MathUtils.clamp(value, 0, 1);
}

function smoothstep(edge0: number, edge1: number, value: number) {
  if (edge0 === edge1) {
    return value < edge0 ? 0 : 1;
  }

  const normalized = clamp01((value - edge0) / (edge1 - edge0));
  return normalized * normalized * (3 - 2 * normalized);
}

function easeInOutCubic(value: number) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - (-2 * value + 2) ** 3 / 2;
}

function easeInOutSine(value: number) {
  return -(Math.cos(Math.PI * value) - 1) / 2;
}

function getCameraTransitionDuration(
  mode: CameraTransitionMode,
  viewportWidth: number,
  reducedMotion: boolean
) {
  if (reducedMotion) {
    return 0.01;
  }

  if (mode === "neutral-intro") {
    return viewportWidth < 900 ? 2.25 : 2.55;
  }

  if (mode === "neutral-to-focus" || mode === "focus-to-neutral") {
    return viewportWidth < 900 ? 1.52 : 1.84;
  }

  return viewportWidth < 900 ? 1.75 : 2.35;
}

function buildConnections(projects: Project[]): Connection[] {
  const connections: Connection[] = [];

  projects.forEach((project, index) => {
    projects.slice(index + 1).forEach((neighbor) => {
      const [ax, ay, az] = project.coordinates;
      const [bx, by, bz] = neighbor.coordinates;
      const distance = Math.sqrt(
        (ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2
      );

      if (distance <= CONNECTION_DISTANCE) {
        connections.push({
          id: `${project.id}-${neighbor.id}`,
          points: [project.coordinates, neighbor.coordinates],
          projects: [project.id, neighbor.id],
        });
      }
    });
  });

  return connections;
}

function getHeroStyle(project: Project): HeroStyle {
  const accent = new THREE.Color(project.color);
  const hsl = { h: 0, s: 0, l: 0 };
  accent.getHSL(hsl);

  const secondary = new THREE.Color().setHSL(
    hsl.h,
    Math.min(1, hsl.s * 0.88),
    Math.max(0.15, hsl.l * 0.42)
  );

  if (project.id === "gpgpu-particles") {
    return {
      kind: "storm",
      accent: `#${accent.getHexString()}`,
      secondary: `#${secondary.getHexString()}`,
      swarmCount: 920,
      swarmSize: 32,
      shellScale: 0.78,
    };
  }

  if (project.id === "voyce") {
    return {
      kind: "harmonic",
      accent: `#${accent.getHexString()}`,
      secondary: `#${secondary.getHexString()}`,
      swarmCount: 840,
      swarmSize: 30,
      shellScale: 0.83,
    };
  }

  return {
    kind: "pulse",
    accent: `#${accent.getHexString()}`,
    secondary: `#${secondary.getHexString()}`,
    swarmCount: 880,
    swarmSize: 34,
    shellScale: 0.8,
  };
}

function HeroCoreGeometry({ kind }: { kind: HeroKind }) {
  if (kind === "harmonic") {
    return <torusKnotGeometry args={[0.31, 0.11, 180, 28, 2, 3]} />;
  }

  if (kind === "pulse") {
    return <octahedronGeometry args={[0.56, 0]} />;
  }

  return <icosahedronGeometry args={[0.52, 0]} />;
}

const ETHEREAL_FILAMENT_PRESETS: Record<HeroKind, EtherealFilamentConfig> = {
  storm: {
    filamentCount: 10,
    trailLength: 56,
    orbitStrength: 3.1,
    windStrength: 2.2,
    drag: 1.7,
    shellDistance: 1.38,
    filamentWidth: 0.058,
    emissionIntensity: 0.98,
    noiseSpeed: 1.4,
    radialDrift: 0.2,
    containment: 2.8,
    crossSectionSegments: 14,
  },
  harmonic: {
    filamentCount: 10,
    trailLength: 62,
    orbitStrength: 2.7,
    windStrength: 1.8,
    drag: 1.55,
    shellDistance: 1.24,
    filamentWidth: 0.052,
    emissionIntensity: 0.92,
    noiseSpeed: 1.1,
    radialDrift: 0.16,
    containment: 2.45,
    crossSectionSegments: 14,
  },
  pulse: {
    filamentCount: 10,
    trailLength: 54,
    orbitStrength: 2.9,
    windStrength: 1.95,
    drag: 1.65,
    shellDistance: 1.3,
    filamentWidth: 0.055,
    emissionIntensity: 0.95,
    noiseSpeed: 1.28,
    radialDrift: 0.18,
    containment: 2.62,
    crossSectionSegments: 14,
  },
};

const CORE_DUST_PRESETS = CORE_DUST_TUNING.presets as unknown as Record<
  HeroKind,
  CoreDustProfile
>;

function createParticleField(
  style: HeroStyle,
  seed: string,
  profile: "stream" | "dust"
): HeroParticleField {
  const count =
    profile === "stream"
      ? style.swarmCount
      : Math.max(64, Math.round(style.swarmCount * 0.15));
  const shellSafeRadius =
    style.shellScale * (profile === "stream" ? 1.08 : 1.02);
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const basePositions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const phases = new Float32Array(count);
  const radii = new Float32Array(count);
  const bands = new Float32Array(count);
  const lifts = new Float32Array(count);
  const sizes = new Float32Array(count);
  const flickers = new Float32Array(count);
  const random = createRandom(
    getHash(seed) + count + (profile === "stream" ? 77 : 131)
  );

  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    const angle = random() * Math.PI * 2;
    const t = index / Math.max(count - 1, 1);

    phases[index] = random() * Math.PI * 2;
    speeds[index] = 0.35 + random() * 0.85;
    flickers[index] = random();
    sizes[index] = 0.78 + random() * 1.3;
    bands[index] = t;
    lifts[index] = random() * 2 - 1;

    if (style.kind === "storm") {
      const phi = Math.acos(1 - 2 * random());
      const minSpread = shellSafeRadius / 0.8 + 0.06;
      const spread = minSpread + Math.pow(random(), 1.1) * 1.68;
      basePositions[offset] = Math.sin(phi) * Math.cos(angle);
      basePositions[offset + 1] = Math.cos(phi);
      basePositions[offset + 2] = Math.sin(phi) * Math.sin(angle);
      radii[index] = spread;
    } else if (style.kind === "harmonic") {
      const turns = 8.2;
      const helixAngle = t * Math.PI * turns + random() * 0.35;
      const minRadius = shellSafeRadius + 0.1;
      const radius = minRadius + random() * 0.98;
      basePositions[offset] = Math.cos(helixAngle) * radius;
      basePositions[offset + 1] = (t - 0.5) * 3.85 + (random() - 0.5) * 0.18;
      basePositions[offset + 2] = Math.sin(helixAngle) * radius;
      radii[index] = radius;
    } else {
      const minSpread = shellSafeRadius / 0.84 + 0.05;
      const spread = minSpread + Math.pow(random(), 1.12) * 1.96;
      basePositions[offset] = Math.cos(angle) * spread;
      basePositions[offset + 1] = (random() - 0.5) * spread * 0.42;
      basePositions[offset + 2] = Math.sin(angle) * spread;
      radii[index] = spread;
    }
  }

  positions.set(basePositions);

  return {
    profile,
    positions,
    velocities,
    basePositions,
    speeds,
    phases,
    radii,
    bands,
    lifts,
    sizes,
    flickers,
    count,
  };
}

function createEtherealFilamentField(
  style: HeroStyle,
  seed: string
): EtherealFilamentField {
  const config = { ...ETHEREAL_FILAMENT_PRESETS[style.kind] };
  const random = createRandom(getHash(seed) + 8192);
  const ringCount = config.crossSectionSegments + 1;
  const vertexCount = config.filamentCount * config.trailLength * ringCount;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint16Array(
    config.filamentCount *
      (config.trailLength - 1) *
      config.crossSectionSegments *
      6
  );
  const phases = new Float32Array(config.filamentCount);
  const orbitScales = new Float32Array(config.filamentCount);
  const radii = new Float32Array(config.filamentCount);
  const widthScales = new Float32Array(config.filamentCount);
  const axisVectors = new Float32Array(config.filamentCount * 3);
  const headPositions = new Float32Array(config.filamentCount * 3);
  const headVelocities = new Float32Array(config.filamentCount * 3);
  const history = new Float32Array(
    config.filamentCount * config.trailLength * 3
  );
  const axis = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const tangent = new THREE.Vector3();

  let indexOffset = 0;

  for (let filament = 0; filament < config.filamentCount; filament += 1) {
    const phase = random() * Math.PI * 2;
    phases[filament] = phase;
    orbitScales[filament] = 0.78 + random() * 0.64;
    radii[filament] = config.shellDistance * (0.82 + random() * 0.42);
    widthScales[filament] = 0.82 + random() * 0.48;

    axis.set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1);
    if (axis.lengthSq() < 0.000001) {
      axis.set(0, 1, 0);
    } else {
      axis.normalize();
    }

    const axisOffset = filament * 3;
    axisVectors[axisOffset] = axis.x;
    axisVectors[axisOffset + 1] = axis.y;
    axisVectors[axisOffset + 2] = axis.z;

    const azimuth = random() * Math.PI * 2;
    const z = random() * 2 - 1;
    const radial = Math.sqrt(Math.max(0, 1 - z * z));
    direction.set(Math.cos(azimuth) * radial, z, Math.sin(azimuth) * radial);
    direction.multiplyScalar(radii[filament]);

    const headOffset = filament * 3;
    headPositions[headOffset] = direction.x;
    headPositions[headOffset + 1] = direction.y;
    headPositions[headOffset + 2] = direction.z;

    tangent.crossVectors(axis, direction);
    if (tangent.lengthSq() < 0.000001) {
      tangent.crossVectors(WORLD_UP, direction);
    }
    if (tangent.lengthSq() < 0.000001) {
      tangent.crossVectors(X_AXIS, direction);
    }
    tangent.normalize();
    tangent.multiplyScalar(config.orbitStrength * orbitScales[filament] * 0.32);
    headVelocities[headOffset] = tangent.x;
    headVelocities[headOffset + 1] = tangent.y;
    headVelocities[headOffset + 2] = tangent.z;

    const filamentVertexBase = filament * config.trailLength * ringCount;
    for (let segment = 0; segment < config.trailLength; segment += 1) {
      const along = segment / Math.max(1, config.trailLength - 1);
      const historyOffset = (filament * config.trailLength + segment) * 3;
      history[historyOffset] = direction.x;
      history[historyOffset + 1] = direction.y;
      history[historyOffset + 2] = direction.z;

      for (let ring = 0; ring < ringCount; ring += 1) {
        const vertex = filamentVertexBase + segment * ringCount + ring;
        uvs[vertex * 2] = ring / config.crossSectionSegments;
        uvs[vertex * 2 + 1] = along;
      }

      if (segment >= config.trailLength - 1) {
        continue;
      }

      for (let ring = 0; ring < config.crossSectionSegments; ring += 1) {
        const current = filamentVertexBase + segment * ringCount + ring;
        const currentNext = current + 1;
        const next = current + ringCount;
        const nextNext = next + 1;

        indices[indexOffset] = current;
        indices[indexOffset + 1] = next;
        indices[indexOffset + 2] = currentNext;
        indices[indexOffset + 3] = next;
        indices[indexOffset + 4] = nextNext;
        indices[indexOffset + 5] = currentNext;
        indexOffset += 6;
      }
    }
  }

  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();

  const field: EtherealFilamentField = {
    config,
    ringCount,
    phases,
    orbitScales,
    radii,
    widthScales,
    axisVectors,
    headPositions,
    headVelocities,
    history,
    geometry,
    positionAttribute,
  };

  updateEtherealFilamentGeometry(field);
  return field;
}

function createWireTraceGraph(shellScale: number): WireTraceGraph {
  const sourceGeometry = new THREE.IcosahedronGeometry(shellScale, 1);
  const edgesGeometry = new THREE.EdgesGeometry(sourceGeometry);
  sourceGeometry.dispose();

  const positions = edgesGeometry.attributes.position.array as Float32Array;
  const nodeMap = new Map<string, number>();
  const nodes: THREE.Vector3[] = [];
  const adjacency: number[][] = [];

  const getNodeIndex = (x: number, y: number, z: number) => {
    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    const existing = nodeMap.get(key);

    if (existing !== undefined) {
      return existing;
    }

    const index = nodes.length;
    nodes.push(new THREE.Vector3(x, y, z));
    adjacency.push([]);
    nodeMap.set(key, index);
    return index;
  };

  const linkNodes = (a: number, b: number) => {
    if (!adjacency[a].includes(b)) {
      adjacency[a].push(b);
    }

    if (!adjacency[b].includes(a)) {
      adjacency[b].push(a);
    }
  };

  for (let offset = 0; offset < positions.length; offset += 6) {
    const a = getNodeIndex(
      positions[offset],
      positions[offset + 1],
      positions[offset + 2]
    );
    const b = getNodeIndex(
      positions[offset + 3],
      positions[offset + 4],
      positions[offset + 5]
    );

    if (a !== b) {
      linkNodes(a, b);
    }
  }

  edgesGeometry.dispose();

  return {
    nodes,
    adjacency,
  };
}

function pickNextTraceNode(
  graph: WireTraceGraph,
  current: number,
  previous: number,
  random: () => number
): number {
  const neighbors = graph.adjacency[current];

  if (!neighbors || neighbors.length === 0) {
    return current;
  }

  const candidates = neighbors.filter((node) => node !== previous);

  if (candidates.length === 0) {
    return neighbors[Math.floor(random() * neighbors.length)];
  }

  return candidates[Math.floor(random() * candidates.length)];
}

function sampleFilamentWind(
  position: THREE.Vector3,
  time: number,
  phase: number,
  target: THREE.Vector3
) {
  const px = position.x;
  const py = position.y;
  const pz = position.z;

  target.set(
    Math.sin(py * 1.48 + pz * 1.08 + time * 0.9 + phase * 1.7) +
      Math.cos(px * 1.12 - time * 0.62 + phase * 0.8),
    Math.sin(pz * 1.22 + px * 0.96 - time * 0.84 + phase * 1.3) +
      Math.cos(py * 1.36 + time * 0.52 - phase * 0.7),
    Math.sin(px * 1.31 + py * 0.92 + time * 0.74 - phase * 1.2) +
      Math.cos(pz * 1.28 - time * 0.68 + phase * 0.6)
  );

  if (target.lengthSq() < 0.000001) {
    target.set(0, 0, 0);
  } else {
    target.normalize();
  }
}

function updateEtherealFilamentSimulation(
  field: EtherealFilamentField,
  elapsed: number,
  delta: number,
  spread: number,
  reducedMotion: boolean
) {
  const {
    config,
    headPositions,
    headVelocities,
    history,
    phases,
    orbitScales,
    radii,
    axisVectors,
  } = field;
  const clampedDelta = Math.min(delta, 1 / 24);
  const motionScale = reducedMotion ? 0.5 : 1;
  const head = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const orbitForce = new THREE.Vector3();
  const containment = new THREE.Vector3();
  const windForce = new THREE.Vector3();
  const acceleration = new THREE.Vector3();
  const damping = Math.exp(-config.drag * clampedDelta * motionScale);

  for (let filament = 0; filament < config.filamentCount; filament += 1) {
    const offset = filament * 3;
    head.set(
      headPositions[offset],
      headPositions[offset + 1],
      headPositions[offset + 2]
    );
    velocity.set(
      headVelocities[offset],
      headVelocities[offset + 1],
      headVelocities[offset + 2]
    );
    axis
      .set(
        axisVectors[offset],
        axisVectors[offset + 1],
        axisVectors[offset + 2]
      )
      .normalize();

    const radius = Math.max(head.length(), 0.0001);
    radial.copy(head).multiplyScalar(1 / radius);
    tangent.crossVectors(axis, radial);
    if (tangent.lengthSq() < 0.000001) {
      tangent.crossVectors(WORLD_UP, radial);
    }
    if (tangent.lengthSq() < 0.000001) {
      tangent.crossVectors(X_AXIS, radial);
    }
    tangent.normalize();

    const orbitGain =
      config.orbitStrength * orbitScales[filament] * motionScale;
    orbitForce.copy(tangent).multiplyScalar(orbitGain);

    const targetRadius = THREE.MathUtils.lerp(0.08, radii[filament], spread);
    const radialWave =
      Math.sin(
        elapsed * (0.56 + orbitScales[filament] * 0.2) + phases[filament] * 1.3
      ) * config.radialDrift;
    containment
      .copy(radial)
      .multiplyScalar(
        (targetRadius + radialWave - radius) * config.containment * motionScale
      );

    sampleFilamentWind(
      head,
      elapsed * config.noiseSpeed,
      phases[filament],
      windForce
    );
    windForce.multiplyScalar(config.windStrength * motionScale);

    acceleration.copy(orbitForce).add(containment).add(windForce);
    velocity.addScaledVector(acceleration, clampedDelta);
    velocity.multiplyScalar(damping);

    const maxSpeed =
      (config.orbitStrength * 2.2 + config.windStrength * 1.45) * motionScale;
    if (velocity.lengthSq() > maxSpeed * maxSpeed) {
      velocity.setLength(maxSpeed);
    }

    head.addScaledVector(velocity, clampedDelta);
    const collapsePull = (1 - spread) * (reducedMotion ? 0.9 : 1.4);
    if (collapsePull > 0.0001) {
      head.multiplyScalar(Math.max(0, 1 - collapsePull * clampedDelta));
    }

    headPositions[offset] = head.x;
    headPositions[offset + 1] = head.y;
    headPositions[offset + 2] = head.z;
    headVelocities[offset] = velocity.x;
    headVelocities[offset + 1] = velocity.y;
    headVelocities[offset + 2] = velocity.z;

    const baseHistoryOffset = filament * config.trailLength * 3;
    for (let segment = config.trailLength - 1; segment > 0; segment -= 1) {
      const currentOffset = baseHistoryOffset + segment * 3;
      const previousOffset = currentOffset - 3;
      history[currentOffset] = history[previousOffset];
      history[currentOffset + 1] = history[previousOffset + 1];
      history[currentOffset + 2] = history[previousOffset + 2];
    }

    history[baseHistoryOffset] = head.x;
    history[baseHistoryOffset + 1] = head.y;
    history[baseHistoryOffset + 2] = head.z;
  }
}

function updateEtherealFilamentGeometry(field: EtherealFilamentField) {
  const {
    config,
    ringCount,
    axisVectors,
    widthScales,
    history,
    positionAttribute,
  } = field;
  const positions = positionAttribute.array as Float32Array;
  const center = new THREE.Vector3();
  const next = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const prevTangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const prevNormal = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const transportAxis = new THREE.Vector3();
  const ringDirection = new THREE.Vector3();
  const fallback = new THREE.Vector3();
  const lastSegmentIndex = config.trailLength - 1;
  const twoPi = Math.PI * 2;
  let positionOffset = 0;

  for (let filament = 0; filament < config.filamentCount; filament += 1) {
    const axisOffset = filament * 3;
    axis
      .set(
        axisVectors[axisOffset],
        axisVectors[axisOffset + 1],
        axisVectors[axisOffset + 2]
      )
      .normalize();
    prevTangent.set(0, 0, 0);
    prevNormal.set(0, 0, 0);

    for (let segment = 0; segment < config.trailLength; segment += 1) {
      const historyOffset = (filament * config.trailLength + segment) * 3;
      center.set(
        history[historyOffset],
        history[historyOffset + 1],
        history[historyOffset + 2]
      );

      if (segment < lastSegmentIndex) {
        const nextOffset = historyOffset + 3;
        next.set(
          history[nextOffset],
          history[nextOffset + 1],
          history[nextOffset + 2]
        );
        tangent.subVectors(next, center);
      } else if (segment > 0) {
        const previousOffset = historyOffset - 3;
        next.set(
          history[previousOffset],
          history[previousOffset + 1],
          history[previousOffset + 2]
        );
        tangent.subVectors(center, next);
      } else {
        tangent.set(0, 1, 0);
      }

      if (tangent.lengthSq() < 0.000001) {
        tangent.copy(prevTangent.lengthSq() < 0.000001 ? axis : prevTangent);
      }
      tangent.normalize();

      if (
        segment === 0 ||
        prevNormal.lengthSq() < 0.000001 ||
        prevTangent.lengthSq() < 0.000001
      ) {
        normal.crossVectors(axis, tangent);
        if (normal.lengthSq() < 0.000001) {
          fallback.crossVectors(WORLD_UP, tangent);
          normal.copy(fallback);
        }
        if (normal.lengthSq() < 0.000001) {
          fallback.crossVectors(X_AXIS, tangent);
          normal.copy(fallback);
        }
        normal.normalize();
      } else {
        transportAxis.crossVectors(prevTangent, tangent);
        const axisLengthSq = transportAxis.lengthSq();
        if (axisLengthSq < 0.000001) {
          normal.copy(prevNormal);
        } else {
          const axisLength = Math.sqrt(axisLengthSq);
          const angle = Math.atan2(
            axisLength,
            THREE.MathUtils.clamp(prevTangent.dot(tangent), -1, 1)
          );
          transportAxis.multiplyScalar(1 / axisLength);
          normal.copy(prevNormal).applyAxisAngle(transportAxis, angle);
        }
        normal.addScaledVector(tangent, -normal.dot(tangent));
        if (normal.lengthSq() < 0.000001) {
          normal.copy(prevNormal);
        }
        normal.normalize();
      }

      binormal.crossVectors(tangent, normal).normalize();
      prevTangent.copy(tangent);
      prevNormal.copy(normal);

      const along = segment / Math.max(1, config.trailLength - 1);
      const headTaper = smoothstep(0.0, 0.1, along);
      const tailTaper = 1 - smoothstep(0.76, 1.0, along);
      const profile = headTaper * tailTaper;
      const width =
        config.filamentWidth * widthScales[filament] * (0.24 + profile * 0.76);

      for (let ring = 0; ring < ringCount; ring += 1) {
        const angle = (ring / config.crossSectionSegments) * twoPi;
        ringDirection
          .copy(normal)
          .multiplyScalar(Math.cos(angle))
          .addScaledVector(binormal, Math.sin(angle));
        positions[positionOffset] = center.x + ringDirection.x * width;
        positions[positionOffset + 1] = center.y + ringDirection.y * width;
        positions[positionOffset + 2] = center.z + ringDirection.z * width;
        positionOffset += 3;
      }
    }
  }

  positionAttribute.needsUpdate = true;
}

function updateParticleField(
  field: HeroParticleField,
  style: HeroStyle,
  elapsed: number,
  delta: number,
  intensity: number,
  collapseToCenter: boolean
) {
  const clampedDelta = Math.min(delta, 1 / 24);
  const spread = collapseToCenter ? smoothstep(0.08, 0.64, intensity) : 1;
  const collapse = 1 - spread;
  const smoothing =
    1 - Math.exp(-(5.4 + intensity * 3.6 + collapse * 2.2) * clampedDelta);
  const enforceInnerSafety = !collapseToCenter;
  const innerSafetyRadius =
    style.kind === "harmonic"
      ? style.shellScale * 1.06 + 0.05
      : style.shellScale * 1.08 + 0.06;

  for (let index = 0; index < field.count; index += 1) {
    const offset = index * 3;

    const bx = field.basePositions[offset];
    const by = field.basePositions[offset + 1];
    const bz = field.basePositions[offset + 2];

    const phase = field.phases[index];
    const speed = field.speeds[index];
    const radius = field.radii[index];

    if (style.kind === "storm") {
      const spin = elapsed * 0.2 * speed + phase;
      const pulse =
        0.8 +
        Math.abs(Math.sin(elapsed * 0.6 + phase)) * (0.42 + intensity * 0.5);
      const wave = Math.sin(elapsed * 0.85 + phase) * 0.1;
      const radial = radius * pulse;

      let targetX = Math.cos(spin) * radial + wave;
      let targetY = by * radial + Math.sin(elapsed * 0.8 + phase) * 0.16;
      let targetZ =
        Math.sin(spin) * radial + Math.cos(elapsed * 0.7 + phase) * 0.08;

      if (enforceInnerSafety) {
        const length = Math.sqrt(
          targetX * targetX + targetY * targetY + targetZ * targetZ
        );
        if (length < innerSafetyRadius) {
          const baseLength = Math.sqrt(bx * bx + by * by + bz * bz);
          const nx =
            length > 0.0001
              ? targetX / length
              : baseLength > 0.0001
              ? bx / baseLength
              : 1;
          const ny =
            length > 0.0001
              ? targetY / length
              : baseLength > 0.0001
              ? by / baseLength
              : 0;
          const nz =
            length > 0.0001
              ? targetZ / length
              : baseLength > 0.0001
              ? bz / baseLength
              : 0;
          const push = innerSafetyRadius - length;
          const swirl = Math.sin(elapsed * 0.72 + phase * 1.6) * push * 0.3;

          targetX = nx * (innerSafetyRadius + push * 0.22) - nz * swirl;
          targetY = ny * (innerSafetyRadius + push * 0.14);
          targetZ = nz * (innerSafetyRadius + push * 0.22) + nx * swirl;
        }
      }

      field.positions[offset] = THREE.MathUtils.lerp(
        field.positions[offset],
        targetX * spread,
        smoothing
      );
      field.positions[offset + 1] = THREE.MathUtils.lerp(
        field.positions[offset + 1],
        targetY * spread,
        smoothing
      );
      field.positions[offset + 2] = THREE.MathUtils.lerp(
        field.positions[offset + 2],
        targetZ * spread,
        smoothing
      );
      continue;
    }

    if (style.kind === "harmonic") {
      const spin = elapsed * 0.58 * speed + phase;
      const baseRadius = Math.max(Math.sqrt(bx * bx + bz * bz), 0.08);
      const wobble = Math.sin(elapsed * 1.0 + phase) * (0.12 + intensity * 0.1);
      const drift = 0.08 + Math.sin(elapsed * 0.7 + phase) * 0.1;

      let targetX = Math.cos(spin) * (baseRadius + drift);
      let targetY = by + wobble;
      let targetZ = Math.sin(spin) * (baseRadius + drift);

      if (enforceInnerSafety) {
        const length = Math.sqrt(
          targetX * targetX + targetY * targetY + targetZ * targetZ
        );
        if (length < innerSafetyRadius) {
          const baseLength = Math.sqrt(bx * bx + by * by + bz * bz);
          const nx =
            length > 0.0001
              ? targetX / length
              : baseLength > 0.0001
              ? bx / baseLength
              : 1;
          const ny =
            length > 0.0001
              ? targetY / length
              : baseLength > 0.0001
              ? by / baseLength
              : 0;
          const nz =
            length > 0.0001
              ? targetZ / length
              : baseLength > 0.0001
              ? bz / baseLength
              : 0;
          const push = innerSafetyRadius - length;
          const swirl = Math.sin(elapsed * 0.66 + phase * 1.45) * push * 0.24;

          targetX = nx * (innerSafetyRadius + push * 0.2) - nz * swirl;
          targetY = ny * (innerSafetyRadius + push * 0.12);
          targetZ = nz * (innerSafetyRadius + push * 0.2) + nx * swirl;
        }
      }

      field.positions[offset] = THREE.MathUtils.lerp(
        field.positions[offset],
        targetX * spread,
        smoothing
      );
      field.positions[offset + 1] = THREE.MathUtils.lerp(
        field.positions[offset + 1],
        targetY * spread,
        smoothing
      );
      field.positions[offset + 2] = THREE.MathUtils.lerp(
        field.positions[offset + 2],
        targetZ * spread,
        smoothing
      );
      continue;
    }

    const beat =
      0.84 +
      (Math.sin(elapsed * 0.95 + phase) * 0.5 + 0.5) *
        (0.42 + intensity * 0.36);
    const spin = elapsed * 0.18 * speed;
    const cos = Math.cos(spin);
    const sin = Math.sin(spin);
    const sx = bx * cos - bz * sin;
    const sz = bx * sin + bz * cos;

    let targetX = sx * beat;
    let targetY =
      by * (0.82 + beat * 0.34) + Math.sin(elapsed * 0.85 + phase) * 0.07;
    let targetZ = sz * beat;

    if (enforceInnerSafety) {
      const length = Math.sqrt(
        targetX * targetX + targetY * targetY + targetZ * targetZ
      );
      if (length < innerSafetyRadius) {
        const baseLength = Math.sqrt(bx * bx + by * by + bz * bz);
        const nx =
          length > 0.0001
            ? targetX / length
            : baseLength > 0.0001
            ? bx / baseLength
            : 1;
        const ny =
          length > 0.0001
            ? targetY / length
            : baseLength > 0.0001
            ? by / baseLength
            : 0;
        const nz =
          length > 0.0001
            ? targetZ / length
            : baseLength > 0.0001
            ? bz / baseLength
            : 0;
        const push = innerSafetyRadius - length;
        const swirl = Math.sin(elapsed * 0.74 + phase * 1.52) * push * 0.28;

        targetX = nx * (innerSafetyRadius + push * 0.2) - nz * swirl;
        targetY = ny * (innerSafetyRadius + push * 0.12);
        targetZ = nz * (innerSafetyRadius + push * 0.2) + nx * swirl;
      }
    }

    field.positions[offset] = THREE.MathUtils.lerp(
      field.positions[offset],
      targetX * spread,
      smoothing
    );
    field.positions[offset + 1] = THREE.MathUtils.lerp(
      field.positions[offset + 1],
      targetY * spread,
      smoothing
    );
    field.positions[offset + 2] = THREE.MathUtils.lerp(
      field.positions[offset + 2],
      targetZ * spread,
      smoothing
    );
  }
}

function getFocusRadius(project: Project) {
  const style = getHeroStyle(project);

  if (style.kind === "harmonic") {
    return 0.94;
  }

  if (style.kind === "pulse") {
    return 0.9;
  }

  return 0.96;
}

function ProjectNode({
  project,
  isActive,
  isHovered,
  mapVisibility,
  nodeDisplayMode,
  neutralBlendOverride,
  introRevealRef,
  introRevealOffset,
  reducedMotion,
  onHover,
  onSelect,
}: ProjectNodeProps) {
  const isNeutralNode = nodeDisplayMode === "neutral";
  const introVisibilityStatic = isNeutralNode
    ? smoothstep(
        0,
        1,
        clamp01((clamp01(introRevealRef.current) - introRevealOffset) / 0.36)
      )
    : 1;
  const neutralNeedsTransparency =
    !isNeutralNode ||
    neutralBlendOverride !== null ||
    introVisibilityStatic < 0.999;
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const outerRingRef = useRef<THREE.Mesh>(null);
  const nodeMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const ringMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const outerRingMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const scaleTargetRef = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const neutralBlendRef = useRef(nodeDisplayMode === "neutral" ? 1 : 0);
  const phaseOffset = useMemo(
    () => (getHash(project.id) % 628) / 100,
    [project.id]
  );
  const neutralLumaCompensation = useMemo(() => {
    const color = new THREE.Color(project.color);
    const luminance = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
    const compensation = 0.82 / Math.max(0.001, luminance);
    return THREE.MathUtils.clamp(compensation, 0.88, 1.06);
  }, [project.color]);

  useLayoutEffect(() => {
    if (!groupRef.current) {
      return;
    }

    if (isNeutralNode) {
      const introVisibility = smoothstep(
        0,
        1,
        clamp01((clamp01(introRevealRef.current) - introRevealOffset) / 0.36)
      );
      groupRef.current.scale.setScalar(Math.max(0.0001, introVisibility));
      return;
    }

    groupRef.current.scale.setScalar(1);
  }, [introRevealOffset, introRevealRef, isNeutralNode]);

  useLayoutEffect(() => {
    return () => {
      document.body.style.cursor = "default";
    };
  }, []);

  useFrame(({ clock }, delta) => {
    if (!groupRef.current) {
      return;
    }

    const elapsed = clock.getElapsedTime();
    const frameDelta = reducedMotion ? delta : Math.min(delta, 1 / 28);
    const blendLerp = 1 - Math.exp(-(reducedMotion ? 12 : 8.5) * frameDelta);
    const scaleLerp = 1 - Math.exp(-(reducedMotion ? 14 : 9.5) * frameDelta);
    const [x, y, z] = project.coordinates;
    const drift = reducedMotion
      ? 0
      : Math.sin(elapsed * 0.7 + phaseOffset) * 0.1;
    const neutralTarget =
      neutralBlendOverride ?? (nodeDisplayMode === "neutral" ? 1 : 0);
    const neutralBlendLerp =
      neutralBlendOverride === null
        ? blendLerp
        : 1 - Math.exp(-(reducedMotion ? 14 : 6.2) * frameDelta);
    neutralBlendRef.current = THREE.MathUtils.lerp(
      neutralBlendRef.current,
      isActive ? 0 : neutralTarget,
      neutralBlendLerp
    );
    const neutralBlend = neutralBlendRef.current;
    const neutralModeOpacity = neutralBlendOverride === null ? 1 : neutralBlend;
    const introVisibility = isNeutralNode
      ? smoothstep(
          0,
          1,
          clamp01((clamp01(introRevealRef.current) - introRevealOffset) / 0.36)
        )
      : 1;
    const introFlash = Math.exp(-Math.pow(introVisibility - 0.72, 2) / 0.014);
    const pulseAmplitude = THREE.MathUtils.lerp(0.024, 0.048, neutralBlend);
    const pulse = reducedMotion
      ? 0
      : Math.sin(elapsed * 2 + phaseOffset) * pulseAmplitude;

    groupRef.current.position.set(x, y + drift, z);

    const baseScale = THREE.MathUtils.lerp(0.88, 1.26, neutralBlend);
    const hoverScale = isHovered
      ? THREE.MathUtils.lerp(0.1, 0.16, neutralBlend)
      : 0;
    const introScale = isNeutralNode
      ? introVisibility * (0.95 + introFlash * 0.12)
      : 1;
    const targetScale = (baseScale + hoverScale) * introScale;
    scaleTargetRef.setScalar(targetScale + pulse);
    groupRef.current.scale.lerp(scaleTargetRef, scaleLerp);

    if (ringRef.current) {
      ringRef.current.rotation.z += reducedMotion
        ? 0
        : THREE.MathUtils.lerp(0.192, 0.288, neutralBlend) * frameDelta;
      const innerRingScale =
        THREE.MathUtils.lerp(0.82, 1.42, neutralBlend) + (isHovered ? 0.08 : 0);
      ringRef.current.scale.setScalar(innerRingScale);
    }

    if (outerRingRef.current) {
      outerRingRef.current.rotation.z -= reducedMotion
        ? 0
        : THREE.MathUtils.lerp(0.144, 0.228, neutralBlend) * frameDelta;
      const outerRingScale =
        THREE.MathUtils.lerp(0.8, 1.5, neutralBlend) + (isHovered ? 0.08 : 0);
      outerRingRef.current.scale.setScalar(outerRingScale);
    }

    if (nodeMaterialRef.current) {
      const baseOpacity = isHovered ? 0.54 : 0.4;
      const neutralOpacityBoost = isHovered ? 0.16 : 0.14;
      const baseEmissive = isHovered ? 0.42 : 0.3;
      const neutralEmissiveBoost = isHovered ? 0.32 : 0.24;

      if (isNeutralNode) {
        // Neutral nodes should not catch scene lighting differently by position.
        nodeMaterialRef.current.color.copy(BLACK);
        nodeMaterialRef.current.emissive.set(project.color);
        nodeMaterialRef.current.roughness = 1;
        nodeMaterialRef.current.metalness = 0;
      } else {
        nodeMaterialRef.current.color.set(project.color);
        nodeMaterialRef.current.emissive.set(project.color);
        nodeMaterialRef.current.roughness = 0.3;
        nodeMaterialRef.current.metalness = 0.2;
      }

      nodeMaterialRef.current.opacity = isNeutralNode
        ? neutralModeOpacity * introVisibility
        : mapVisibility * (baseOpacity + neutralBlend * neutralOpacityBoost);
      nodeMaterialRef.current.emissiveIntensity =
        mapVisibility *
        (baseEmissive + neutralBlend * neutralEmissiveBoost) *
        (isNeutralNode
          ? (0.24 + introVisibility * 0.76) * neutralLumaCompensation
          : 1);
    }

    if (ringMaterialRef.current) {
      const baseRingOpacity = isHovered ? 0.22 : 0.13;
      const neutralRingBoost = isHovered ? 0.34 : 0.3;
      ringMaterialRef.current.opacity = isNeutralNode
        ? neutralModeOpacity * introVisibility * 0.88 * neutralLumaCompensation
        : mapVisibility * (baseRingOpacity + neutralBlend * neutralRingBoost);
    }

    if (outerRingMaterialRef.current) {
      const outerOpacity = isHovered ? 0.28 : 0.18;
      outerRingMaterialRef.current.opacity = isNeutralNode
        ? neutralModeOpacity * introVisibility * 0.82 * neutralLumaCompensation
        : mapVisibility * outerOpacity * neutralBlend;
    }
  });

  const neutralModeOpacity =
    neutralBlendOverride === null ? 1 : neutralBlendOverride;

  return (
    <group ref={groupRef}>
      {!isActive && (
        <>
          <mesh ref={ringRef} renderOrder={-20}>
            <torusGeometry args={[0.31, 0.014, 12, 80]} />
            <meshBasicMaterial
              ref={ringMaterialRef}
              color={project.color}
              transparent={neutralNeedsTransparency}
              opacity={
                isNeutralNode
                  ? neutralModeOpacity *
                    introVisibilityStatic *
                    0.88 *
                    neutralLumaCompensation
                  : 0.28
              }
              depthWrite
              depthTest
              blending={
                isNeutralNode ? THREE.NormalBlending : THREE.AdditiveBlending
              }
              toneMapped={false}
            />
          </mesh>

          <mesh
            ref={outerRingRef}
            rotation={[Math.PI * 0.32, 0, 0]}
            renderOrder={-20}
          >
            <torusGeometry args={[0.43, 0.01, 12, 80]} />
            <meshBasicMaterial
              ref={outerRingMaterialRef}
              color={project.color}
              transparent={neutralNeedsTransparency}
              opacity={
                isNeutralNode
                  ? neutralModeOpacity *
                    introVisibilityStatic *
                    0.82 *
                    neutralLumaCompensation
                  : 0.22
              }
              depthWrite
              depthTest
              blending={
                isNeutralNode ? THREE.NormalBlending : THREE.AdditiveBlending
              }
              toneMapped={false}
            />
          </mesh>

          <mesh
            renderOrder={-19}
            onPointerOver={(event) => {
              event.stopPropagation();
              document.body.style.cursor = "pointer";
              onHover(project.id);
            }}
            onPointerOut={(event) => {
              event.stopPropagation();
              document.body.style.cursor = "default";
              onHover(null);
            }}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(project.id);
            }}
          >
            <sphereGeometry args={[0.44, 12, 12]} />
            <meshBasicMaterial
              transparent
              opacity={0}
              colorWrite={false}
              depthWrite={false}
              depthTest={false}
              toneMapped={false}
            />
          </mesh>

          <mesh renderOrder={-18}>
            <icosahedronGeometry args={[0.27, 1]} />
            <meshStandardMaterial
              ref={nodeMaterialRef}
              color={isNeutralNode ? BLACK : project.color}
              emissive={project.color}
              roughness={isNeutralNode ? 1 : 0.3}
              metalness={isNeutralNode ? 0 : 0.2}
              transparent={neutralNeedsTransparency}
              opacity={
                isNeutralNode
                  ? neutralModeOpacity * introVisibilityStatic
                  : 0.62
              }
              depthWrite
              depthTest
              blending={
                isNeutralNode ? THREE.NormalBlending : THREE.AdditiveBlending
              }
              toneMapped={false}
            />
          </mesh>
        </>
      )}

      {isHovered && mapVisibility > 0.2 && !isActive && (
        <Html
          position={[0, 0.8, 0]}
          center
          distanceFactor={12}
          zIndexRange={[30, 0]}
        >
          <div className="node-label">{project.title}</div>
        </Html>
      )}
    </group>
  );
}

function HeroWorld({
  project,
  reducedMotion,
  isMobileViewport,
  presenceTarget,
  collapseParticlesOnFadeOut,
  prewarmActive,
}: HeroWorldProps) {
  const { gl } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const coreRef = useRef<THREE.Object3D>(null);
  const coreMaskRef = useRef<THREE.Mesh>(null);
  const shellRef = useRef<THREE.Mesh>(null);
  const shellStarBlockerRef = useRef<THREE.Mesh>(null);
  const coreStarBlockerRef = useRef<THREE.Mesh>(null);
  const shellAccentRef = useRef<THREE.Object3D>(null);
  const shellOcclusionRef = useRef<THREE.Mesh>(null);
  const shellMaskRef = useRef<THREE.Mesh>(null);
  const shellAccentMaskRef = useRef<THREE.Object3D>(null);
  const coreDustGroupRef = useRef<THREE.Group>(null);
  const coreDustMeshRef = useRef<THREE.Mesh>(null);
  const shellTraceGroupRef = useRef<THREE.Group>(null);
  const shellTraceSegmentRef = useRef<THREE.Mesh>(null);
  const shellTraceCoreRef = useRef<THREE.Mesh>(null);
  const streamRibbonRef = useRef<THREE.Mesh>(null);
  const streamPointsRef = useRef<THREE.Points>(null);
  const coreMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const coreDustMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const shellMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const streamRibbonMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const streamSwarmMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const traceSegmentMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const traceCoreMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const accentPrimaryMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const accentSecondaryMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const accentScaleTargetRef = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const groupScaleTargetRef = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const traceStartRef = useMemo(() => new THREE.Vector3(), []);
  const traceEndRef = useMemo(() => new THREE.Vector3(), []);
  const traceDirRef = useMemo(() => new THREE.Vector3(), []);
  const traceCenterRef = useMemo(() => new THREE.Vector3(), []);
  const traceCoreColorRef = useMemo(() => new THREE.Color(), []);
  const coreDustCameraLocalRef = useMemo(() => new THREE.Vector3(), []);
  const coreDustWindPrimaryWorldRef = useMemo(() => new THREE.Vector3(), []);
  const coreDustWindSecondaryWorldRef = useMemo(() => new THREE.Vector3(), []);
  const coreDustWindPrimaryTargetWorldRef = useMemo(
    () => new THREE.Vector3(),
    []
  );
  const coreDustWindSecondaryTargetWorldRef = useMemo(
    () => new THREE.Vector3(),
    []
  );
  const coreDustWindPrimaryLocalRef = useMemo(() => new THREE.Vector3(), []);
  const coreDustWindSecondaryLocalRef = useMemo(() => new THREE.Vector3(), []);
  const coreDustWindSpinAxisRef = useMemo(() => new THREE.Vector3(), []);
  const coreDustLightWorldRef = useMemo(() => new THREE.Vector3(), []);
  const coreDustLightLocalRef = useMemo(() => new THREE.Vector3(), []);
  const coreDustWorldPosRef = useMemo(() => new THREE.Vector3(), []);
  const coreDustWorldQuatRef = useMemo(() => new THREE.Quaternion(), []);
  const coreDustWorldQuatInverseRef = useMemo(() => new THREE.Quaternion(), []);
  const presenceRef = useRef(clamp01(presenceTarget));
  const traceRandomRef = useRef<(() => number) | null>(null);
  const coreDustWindRandomRef = useRef<(() => number) | null>(null);
  const coreDustNextRetargetRef = useRef(0);
  const coreDustStepBudgetRef = useRef(16);
  const traceStateRef = useRef({
    from: 0,
    to: 0,
    previous: -1,
    progress: 0,
    speed: 0.9,
  });
  const simulationWarmupStepsRef = useRef(reducedMotion ? 4 : 12);
  const simulationWarmupTimeRef = useRef(0);
  const simulationWarmupDoneRef = useRef(false);

  const style = useMemo(() => getHeroStyle(project), [project]);
  const showLegacySwarmOnly = false;
  const showCoreDust = ENABLE_CORE_DUST_FOG && !showLegacySwarmOnly;
  const etherealFilaments = useMemo(
    () => createEtherealFilamentField(style, `${project.id}-hero-filaments`),
    [style, project.id]
  );
  const wireTraceGraph = useMemo(
    () => createWireTraceGraph(style.shellScale),
    [style.shellScale]
  );
  const streamParticles = useMemo(
    () => createParticleField(style, `${project.id}-hero-stream`, "stream"),
    [style, project.id]
  );
  const accentColor = useMemo(
    () => new THREE.Color(style.accent),
    [style.accent]
  );
  const secondaryColor = useMemo(
    () => new THREE.Color(style.secondary),
    [style.secondary]
  );
  const coreDustProfile = useMemo(
    () => CORE_DUST_PRESETS[style.kind],
    [style.kind]
  );
  const silhouetteProfile = useMemo(() => {
    if (style.kind === "storm") {
      return {
        core: 1.02,
        shell: 0.76,
        ringsPrimary: 1.0,
        ringsSecondary: 0.94,
        particles: 1.34,
      };
    }

    if (style.kind === "harmonic") {
      return {
        core: 1.04,
        shell: 0.88,
        ringsPrimary: 0.88,
        ringsSecondary: 0.82,
        particles: 1.08,
      };
    }

    return {
      core: 1.0,
      shell: 0.8,
      ringsPrimary: 1.08,
      ringsSecondary: 1.0,
      particles: 1.22,
    };
  }, [style.kind]);
  const coreDustRadius = useMemo(
    () => style.shellScale * Math.min(coreDustProfile.radiusScale, 1),
    [coreDustProfile.radiusScale, style.shellScale]
  );
  const coreDustUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: secondaryColor.clone() },
      uSecondary: { value: accentColor.clone() },
      uOpacity: { value: 1 },
      uIntensity: { value: 1 },
      uRadius: { value: coreDustRadius },
      uDensity: { value: coreDustProfile.density },
      uDetail: { value: coreDustProfile.detail },
      uNoiseScale: { value: coreDustProfile.noiseScale },
      uNoiseSpeed: { value: coreDustProfile.noiseSpeed },
      uStepCount: { value: coreDustProfile.stepCount },
      uFeather: { value: coreDustProfile.feather },
      uCameraLocal: { value: new THREE.Vector3(0, 0, 2.2) },
      uLightDirLocal: {
        value: new THREE.Vector3(0.46, 0.74, 0.36).normalize(),
      },
      uWindPrimary: { value: new THREE.Vector3(1, 0, 0) },
      uWindSecondary: { value: new THREE.Vector3(0, 0, 1) },
    }),
    [accentColor, coreDustProfile, coreDustRadius, secondaryColor]
  );

  const accentBaseOpacity = useMemo(() => {
    if (style.kind === "harmonic") {
      return { primary: 0.24, secondary: 0.23 };
    }

    if (style.kind === "pulse") {
      return { primary: 0.22, secondary: 0.21 };
    }

    return { primary: 0.22, secondary: 0.2 };
  }, [style.kind]);

  useLayoutEffect(() => {
    const initialIntensity = clamp01(presenceRef.current);
    const isVisible = initialIntensity > 0.008;
    const maskVisible = initialIntensity > 0.05;

    if (groupRef.current) {
      groupRef.current.visible = isVisible;
    }

    if (shellMaskRef.current) {
      shellMaskRef.current.visible = maskVisible;
    }

    if (shellOcclusionRef.current) {
      shellOcclusionRef.current.visible = maskVisible;
    }

    if (shellAccentMaskRef.current) {
      shellAccentMaskRef.current.visible = maskVisible;
    }

    if (coreMaskRef.current) {
      coreMaskRef.current.visible = maskVisible;
    }

    if (shellStarBlockerRef.current) {
      shellStarBlockerRef.current.visible = maskVisible;
    }

    if (coreStarBlockerRef.current) {
      coreStarBlockerRef.current.visible =
        ENABLE_CORE_STAR_BLOCKER && maskVisible;
    }
  }, []);

  useEffect(() => {
    if (prewarmActive || presenceTarget > 0.0001) {
      return;
    }

    presenceRef.current = 0;

    if (groupRef.current) {
      groupRef.current.visible = false;
    }
    if (shellMaskRef.current) {
      shellMaskRef.current.visible = false;
    }
    if (shellOcclusionRef.current) {
      shellOcclusionRef.current.visible = false;
    }
    if (shellAccentMaskRef.current) {
      shellAccentMaskRef.current.visible = false;
    }
    if (coreMaskRef.current) {
      coreMaskRef.current.visible = false;
    }
    if (shellStarBlockerRef.current) {
      shellStarBlockerRef.current.visible = false;
    }
    if (coreStarBlockerRef.current) {
      coreStarBlockerRef.current.visible = false;
    }
  }, [prewarmActive, presenceTarget]);

  useEffect(
    () => () => {
      etherealFilaments.geometry.dispose();
    },
    [etherealFilaments]
  );

  useLayoutEffect(() => {
    coreDustWindRandomRef.current = createRandom(
      getHash(`${project.id}-core-dust-wind`) + 341
    );
    coreDustNextRetargetRef.current = 0;
    coreDustStepBudgetRef.current = reducedMotion ? 12 : 16;
    coreDustWindPrimaryWorldRef.set(1, 0, 0);
    coreDustWindSecondaryWorldRef.set(0, 0, 1);
    coreDustWindPrimaryTargetWorldRef.set(1, 0, 0);
    coreDustWindSecondaryTargetWorldRef.set(0, 0, 1);
  }, [project.id, reducedMotion]);

  useLayoutEffect(() => {
    const random = createRandom(getHash(`${project.id}-wire-trace`) + 97);
    traceRandomRef.current = random;

    if (wireTraceGraph.nodes.length < 2) {
      traceStateRef.current = {
        from: 0,
        to: 0,
        previous: -1,
        progress: 0,
        speed: 0.8,
      };
      return;
    }

    const from = Math.floor(random() * wireTraceGraph.nodes.length);
    const to = pickNextTraceNode(wireTraceGraph, from, -1, random);
    traceStateRef.current = {
      from,
      to,
      previous: -1,
      progress: 0,
      speed:
        style.kind === "harmonic" ? 0.68 : style.kind === "pulse" ? 0.76 : 0.72,
    };
  }, [project.id, style.kind, wireTraceGraph]);

  useLayoutEffect(() => {
    simulationWarmupStepsRef.current = reducedMotion ? 4 : 12;
    simulationWarmupTimeRef.current = 0;
    simulationWarmupDoneRef.current = false;
  }, [project.id, reducedMotion]);

  const coreUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: accentColor.clone() },
      uIntensity: { value: 1 },
      uEnergy: { value: 1 },
    }),
    [accentColor]
  );

  const shellUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: secondaryColor.clone() },
      uIntensity: { value: 1 },
    }),
    [secondaryColor]
  );

  const streamRibbonUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: accentColor.clone() },
      uSecondary: { value: secondaryColor.clone() },
      uOpacity: { value: 0.44 },
      uIntensity: { value: 1 },
      uEmission: { value: 1 },
      uNoiseSpeed: { value: 1 },
    }),
    [accentColor, secondaryColor]
  );

  const streamSwarmUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: accentColor.clone().lerp(secondaryColor, 0.14) },
      uOpacity: { value: 0.46 },
      uBaseSize: { value: style.swarmSize * 0.84 },
      uPixelRatio: { value: Math.min(gl.getPixelRatio(), 2) },
      uIntensity: { value: 1 },
    }),
    [accentColor, secondaryColor, style.swarmSize, gl]
  );
  const mobileFilamentIntensityBoost = isMobileViewport ? 1.28 : 1;
  const mobileFilamentOpacityBoost = isMobileViewport ? 1.52 : 1;
  const mobileFilamentEmissionBoost = isMobileViewport ? 1.24 : 1;
  const mobileSwarmIntensityBoost = isMobileViewport ? 1.1 : 1;
  const mobileSwarmOpacityBoost = isMobileViewport ? 1.14 : 1;

  useFrame(({ clock, camera }, delta) => {
    const elapsed = clock.getElapsedTime();
    const frameDelta = reducedMotion ? delta : Math.min(delta, 1 / 28);
    const presenceLerp =
      1 - Math.exp(-(reducedMotion ? 18 : 10.5) * frameDelta);
    const warmedPresenceTarget = prewarmActive
      ? Math.max(presenceTarget, 0.18)
      : presenceTarget;
    presenceRef.current = THREE.MathUtils.lerp(
      presenceRef.current,
      clamp01(warmedPresenceTarget),
      presenceLerp
    );
    const intensity = clamp01(
      prewarmActive ? Math.max(presenceRef.current, 0.18) : presenceRef.current
    );
    const isVisible = intensity > 0.008;
    const maskVisible = intensity > 0.05;

    if (groupRef.current) {
      groupRef.current.visible = isVisible;
    }

    if (shellMaskRef.current) {
      shellMaskRef.current.visible = maskVisible;
    }

    if (shellOcclusionRef.current) {
      shellOcclusionRef.current.visible = maskVisible;
    }

    if (shellAccentMaskRef.current) {
      shellAccentMaskRef.current.visible = maskVisible;
    }

    if (coreMaskRef.current) {
      coreMaskRef.current.visible = maskVisible;
    }

    if (shellStarBlockerRef.current) {
      shellStarBlockerRef.current.visible = maskVisible;
    }

    if (coreStarBlockerRef.current) {
      coreStarBlockerRef.current.visible =
        ENABLE_CORE_STAR_BLOCKER && maskVisible;
    }

    if (
      !simulationWarmupDoneRef.current &&
      simulationWarmupStepsRef.current > 0
    ) {
      const warmupBatch = Math.min(
        simulationWarmupStepsRef.current,
        reducedMotion ? 1 : 2
      );
      const warmupDelta = 1 / 90;
      const warmupIntensity = reducedMotion ? 0.2 : 0.34;

      for (let step = 0; step < warmupBatch; step += 1) {
        simulationWarmupTimeRef.current += warmupDelta;
        const warmupElapsed = simulationWarmupTimeRef.current;
        updateParticleField(
          streamParticles,
          style,
          warmupElapsed,
          warmupDelta,
          warmupIntensity,
          false
        );
        if (!showLegacySwarmOnly) {
          updateEtherealFilamentSimulation(
            etherealFilaments,
            warmupElapsed,
            warmupDelta,
            1,
            reducedMotion
          );
          updateEtherealFilamentGeometry(etherealFilaments);
        }
      }

      if (streamPointsRef.current) {
        const streamPosition = streamPointsRef.current.geometry.attributes
          .position as THREE.BufferAttribute;
        streamPosition.needsUpdate = true;
      }

      simulationWarmupStepsRef.current -= warmupBatch;

      if (simulationWarmupStepsRef.current <= 0) {
        simulationWarmupDoneRef.current = true;
      }
    }

    if (!isVisible) {
      return;
    }

    const scaleLerp = 1 - Math.exp(-(reducedMotion ? 10 : 7.5) * frameDelta);
    const accentLerp = 1 - Math.exp(-(reducedMotion ? 12 : 8.5) * frameDelta);

    if (groupRef.current) {
      const targetScale = 0.44 + intensity * 0.66;
      groupScaleTargetRef.setScalar(targetScale);
      groupRef.current.scale.lerp(groupScaleTargetRef, scaleLerp);
      groupRef.current.rotation.y +=
        frameDelta * (reducedMotion ? 0.018 : 0.054);
    }

    if (coreRef.current) {
      coreRef.current.rotation.x += frameDelta * (reducedMotion ? 0.08 : 0.14);
      coreRef.current.rotation.y += frameDelta * (reducedMotion ? 0.14 : 0.24);
      if (style.kind === "harmonic") {
        coreRef.current.rotation.z +=
          frameDelta * (reducedMotion ? 0.06 : 0.12);
      }
    }

    if (coreRef.current && coreMaskRef.current) {
      coreMaskRef.current.rotation.copy(coreRef.current.rotation);
    }

    if (coreRef.current && coreStarBlockerRef.current) {
      coreStarBlockerRef.current.rotation.copy(coreRef.current.rotation);
    }

    if (shellRef.current) {
      shellRef.current.rotation.y +=
        frameDelta * (reducedMotion ? 0.024 : 0.108);
      shellRef.current.rotation.z +=
        frameDelta * (reducedMotion ? 0.021 : 0.066);
    }

    if (showCoreDust && coreDustGroupRef.current) {
      // Keep volumetric fog independent from shell spin.
      coreDustGroupRef.current.rotation.set(0, 0, 0);
      coreDustGroupRef.current.scale.setScalar(1);
    }

    if (shellAccentRef.current) {
      shellAccentRef.current.rotation.x +=
        frameDelta * (reducedMotion ? 0.024 : 0.108);
      shellAccentRef.current.rotation.y +=
        frameDelta * (reducedMotion ? 0.027 : 0.09);

      if (style.kind === "storm") {
        const pulse = 1 + Math.sin(elapsed * 0.7) * 0.12 * intensity;
        accentScaleTargetRef.setScalar(pulse);
        shellAccentRef.current.scale.lerp(accentScaleTargetRef, accentLerp);
      }

      if (style.kind === "pulse") {
        const beat = 0.98 + Math.sin(elapsed * 0.65) * 0.1 * intensity;
        accentScaleTargetRef.setScalar(beat);
        shellAccentRef.current.scale.lerp(accentScaleTargetRef, accentLerp);
      }
    }

    if (shellRef.current && shellMaskRef.current) {
      shellMaskRef.current.rotation.copy(shellRef.current.rotation);
    }

    if (shellRef.current && shellOcclusionRef.current) {
      shellOcclusionRef.current.rotation.copy(shellRef.current.rotation);
    }

    if (shellRef.current && shellStarBlockerRef.current) {
      shellStarBlockerRef.current.rotation.copy(shellRef.current.rotation);
    }

    if (shellAccentRef.current && shellAccentMaskRef.current) {
      shellAccentMaskRef.current.rotation.copy(shellAccentRef.current.rotation);
      shellAccentMaskRef.current.scale.copy(shellAccentRef.current.scale);
    }

    if (shellRef.current && shellTraceGroupRef.current) {
      shellTraceGroupRef.current.rotation.copy(shellRef.current.rotation);
    }

    if (
      shellTraceCoreRef.current &&
      shellTraceSegmentRef.current &&
      wireTraceGraph.nodes.length > 1
    ) {
      const random =
        traceRandomRef.current ??
        createRandom(getHash(`${project.id}-wire-trace-fallback`) + 131);
      traceRandomRef.current = random;
      const traceState = traceStateRef.current;
      const fromNode = wireTraceGraph.nodes[traceState.from];
      const toNode = wireTraceGraph.nodes[traceState.to];

      traceStartRef.copy(fromNode);
      traceEndRef.copy(toNode);
      traceDirRef.subVectors(traceEndRef, traceStartRef);
      const edgeLength = Math.max(traceDirRef.length(), 0.0001);
      traceDirRef.multiplyScalar(1 / edgeLength);

      traceState.progress +=
        ((reducedMotion ? 0.34 : 0.9) * traceState.speed * frameDelta) /
        edgeLength;

      while (traceState.progress >= 1) {
        traceState.progress -= 1;
        traceState.previous = traceState.from;
        traceState.from = traceState.to;
        traceState.to = pickNextTraceNode(
          wireTraceGraph,
          traceState.from,
          traceState.previous,
          random
        );

        traceStartRef.copy(wireTraceGraph.nodes[traceState.from]);
        traceEndRef.copy(wireTraceGraph.nodes[traceState.to]);
        traceDirRef.subVectors(traceEndRef, traceStartRef);
        const nextLength = Math.max(traceDirRef.length(), 0.0001);
        traceDirRef.multiplyScalar(1 / nextLength);
      }

      const currentLength = Math.max(
        traceStartRef.distanceTo(traceEndRef),
        0.0001
      );
      const pulseHalfLength = THREE.MathUtils.clamp(
        currentLength * 0.2,
        0.12,
        0.36
      );
      const pulseDistance = currentLength * traceState.progress;
      const pulseStart = Math.max(0, pulseDistance - pulseHalfLength);
      const pulseEnd = Math.min(currentLength, pulseDistance + pulseHalfLength);
      const tracedLength = Math.max(0.001, pulseEnd - pulseStart);
      traceCenterRef
        .copy(traceStartRef)
        .addScaledVector(traceDirRef, pulseStart + tracedLength * 0.5);
      const electricPulse =
        0.95 +
        Math.sin(elapsed * 4.2 + traceState.progress * Math.PI * 6) * 0.11;

      shellTraceSegmentRef.current.position.copy(traceCenterRef);
      shellTraceSegmentRef.current.quaternion.setFromUnitVectors(
        WORLD_UP,
        traceDirRef
      );
      shellTraceSegmentRef.current.scale.set(
        electricPulse,
        tracedLength,
        electricPulse
      );

      shellTraceCoreRef.current.position.copy(traceCenterRef);
      shellTraceCoreRef.current.quaternion.copy(
        shellTraceSegmentRef.current.quaternion
      );
      shellTraceCoreRef.current.scale.set(
        electricPulse * 0.54,
        tracedLength,
        electricPulse * 0.54
      );
    }

    updateParticleField(
      streamParticles,
      style,
      elapsed,
      frameDelta,
      intensity,
      collapseParticlesOnFadeOut
    );

    const collapseBlend = collapseParticlesOnFadeOut
      ? smoothstep(0.02, 0.8, intensity)
      : 1;

    if (streamRibbonRef.current && !showLegacySwarmOnly) {
      updateEtherealFilamentSimulation(
        etherealFilaments,
        elapsed,
        frameDelta,
        collapseBlend,
        reducedMotion
      );
      updateEtherealFilamentGeometry(etherealFilaments);
    }

    if (streamPointsRef.current) {
      const streamPosition = streamPointsRef.current.geometry.attributes
        .position as THREE.BufferAttribute;
      streamPosition.needsUpdate = true;
    }

    if (coreMaterialRef.current) {
      coreMaterialRef.current.uniforms.uTime.value = elapsed;
      coreMaterialRef.current.uniforms.uColor.value.copy(accentColor);
      if (style.kind === "pulse") {
        coreMaterialRef.current.uniforms.uIntensity.value =
          (0.17 + intensity * 0.38) * intensity * silhouetteProfile.core;
        coreMaterialRef.current.uniforms.uEnergy.value =
          (0.18 + intensity * 0.54) * intensity * silhouetteProfile.core;
      } else {
        coreMaterialRef.current.uniforms.uIntensity.value =
          (0.22 + intensity * 0.48) * intensity * silhouetteProfile.core;
        coreMaterialRef.current.uniforms.uEnergy.value =
          (0.2 + intensity * 0.7) * intensity * silhouetteProfile.core;
      }
    }

    if (shellMaterialRef.current) {
      shellMaterialRef.current.uniforms.uTime.value = elapsed;
      shellMaterialRef.current.uniforms.uColor.value
        .copy(secondaryColor)
        .lerp(accentColor, 0.18);
      shellMaterialRef.current.uniforms.uIntensity.value =
        (0.26 + intensity * 0.62) *
        intensity *
        silhouetteProfile.shell *
        HERO_SHELL_WIREFRAME_VISIBILITY;
    }

    if (streamRibbonMaterialRef.current) {
      streamRibbonMaterialRef.current.uniforms.uTime.value = elapsed;
      streamRibbonMaterialRef.current.uniforms.uColor.value.copy(accentColor);
      streamRibbonMaterialRef.current.uniforms.uSecondary.value
        .copy(secondaryColor)
        .lerp(accentColor, 0.2);
      streamRibbonMaterialRef.current.uniforms.uIntensity.value =
        showLegacySwarmOnly
          ? 0
          : intensity *
            silhouetteProfile.particles *
            mobileFilamentIntensityBoost;
      streamRibbonMaterialRef.current.uniforms.uOpacity.value =
        showLegacySwarmOnly
          ? 0
          : THREE.MathUtils.clamp(
              (0.055 + intensity * 0.2) *
                intensity *
                mobileFilamentOpacityBoost,
              0,
              0.58
            );
      streamRibbonMaterialRef.current.uniforms.uEmission.value =
        etherealFilaments.config.emissionIntensity *
        mobileFilamentEmissionBoost;
      streamRibbonMaterialRef.current.uniforms.uNoiseSpeed.value =
        etherealFilaments.config.noiseSpeed;
    }

    if (streamSwarmMaterialRef.current) {
      streamSwarmMaterialRef.current.uniforms.uTime.value = elapsed;
      streamSwarmMaterialRef.current.uniforms.uColor.value
        .copy(accentColor)
        .lerp(secondaryColor, 0.08);
      streamSwarmMaterialRef.current.uniforms.uIntensity.value =
        (0.28 + intensity * 0.86) * intensity * mobileSwarmIntensityBoost;
      streamSwarmMaterialRef.current.uniforms.uOpacity.value =
        (0.18 + intensity * 0.34) * intensity * mobileSwarmOpacityBoost;
      streamSwarmMaterialRef.current.uniforms.uPixelRatio.value = Math.min(
        gl.getPixelRatio(),
        2
      );
    }

    if (traceSegmentMaterialRef.current) {
      traceSegmentMaterialRef.current.color
        .copy(accentColor)
        .lerp(secondaryColor, 0.08);
      traceSegmentMaterialRef.current.opacity =
        (0.2 + intensity * 0.6) * intensity;
    }

    if (traceCoreMaterialRef.current) {
      traceCoreMaterialRef.current.color.copy(
        traceCoreColorRef.copy(accentColor).lerp(WHITE, 0.4)
      );
      traceCoreMaterialRef.current.opacity =
        (0.26 + intensity * 0.72) * intensity;
    }

    if (showCoreDust && coreDustMaterialRef.current) {
      const coreDustMaterial = coreDustMaterialRef.current;
      const fogUniformTuning = CORE_DUST_TUNING.uniforms;
      const fogWindTuning = CORE_DUST_TUNING.wind;
      let detailQuality: number = reducedMotion
        ? fogUniformTuning.detailQualityNearReduced
        : fogUniformTuning.detailQualityNear;
      const windTempoScale = THREE.MathUtils.clamp(
        coreDustProfile.windTempo / 0.034,
        fogWindTuning.tempoClampMin,
        fogWindTuning.tempoClampMax
      );

      if (coreDustWindPrimaryWorldRef.lengthSq() < 0.0001) {
        coreDustWindPrimaryWorldRef.set(1, 0, 0);
      }

      if (coreDustWindSecondaryWorldRef.lengthSq() < 0.0001) {
        coreDustWindSecondaryWorldRef.set(0, 0, 1);
      }

      // Constant-rate fast wind with slow axis precession to avoid fast/slow cycles.
      const phase = coreDustProfile.phaseOffset;
      coreDustWindPrimaryTargetWorldRef
        .set(Math.sin(phase * 1.7 + 1.1), 0.42, Math.cos(phase * 1.7 + 1.1))
        .normalize();
      coreDustWindSecondaryTargetWorldRef
        .set(Math.cos(phase * 1.3 + 0.4), 0.28, Math.sin(phase * 1.3 + 0.4))
        .normalize();
      coreDustWindSpinAxisRef
        .copy(coreDustWindPrimaryTargetWorldRef)
        .applyAxisAngle(
          coreDustWindSecondaryTargetWorldRef,
          elapsed *
            (reducedMotion
              ? fogWindTuning.precessionSpeedReduced
              : fogWindTuning.precessionSpeedNormal)
        )
        .normalize();

      const spinAngle =
        frameDelta *
        (reducedMotion
          ? fogWindTuning.spinSpeedReduced
          : fogWindTuning.spinSpeedNormal) *
        windTempoScale;
      const lateralSpinAngle =
        frameDelta *
        (reducedMotion
          ? fogWindTuning.lateralSpinSpeedReduced
          : fogWindTuning.lateralSpinSpeedNormal) *
        windTempoScale;
      coreDustWindPrimaryWorldRef
        .applyAxisAngle(coreDustWindSpinAxisRef, spinAngle)
        .normalize();
      coreDustWindSecondaryWorldRef.applyAxisAngle(
        coreDustWindSpinAxisRef,
        spinAngle * 0.98
      );
      coreDustWindSecondaryWorldRef.applyAxisAngle(
        coreDustWindPrimaryWorldRef,
        lateralSpinAngle
      );
      coreDustWindSecondaryWorldRef
        .addScaledVector(
          coreDustWindPrimaryWorldRef,
          -coreDustWindSecondaryWorldRef.dot(coreDustWindPrimaryWorldRef)
        )
        .normalize();

      const windAlignment = Math.abs(
        coreDustWindPrimaryWorldRef.dot(coreDustWindSecondaryWorldRef)
      );
      if (windAlignment > 0.96) {
        coreDustWindSecondaryWorldRef.addScaledVector(X_AXIS, 0.4).normalize();
      }

      coreDustLightWorldRef
        .set(0.46, 0.74, 0.36)
        .addScaledVector(coreDustWindSecondaryWorldRef, 0.28)
        .normalize();

      if (coreDustMeshRef.current) {
        coreDustMeshRef.current.getWorldPosition(coreDustWorldPosRef);
        const cameraDistance = camera.position.distanceTo(coreDustWorldPosRef);
        const nearDistance = coreDustRadius * 1.9;
        const farDistance = coreDustRadius * 7.2;
        const distanceBlend = smoothstep(
          nearDistance,
          farDistance,
          cameraDistance
        );
        const minSteps = reducedMotion ? 8 : 7;
        const maxSteps = reducedMotion ? 13 : 20;
        const targetStepBudget = THREE.MathUtils.lerp(
          minSteps,
          maxSteps,
          distanceBlend
        );
        const stepBudgetLerp =
          1 - Math.exp(-(reducedMotion ? 4.2 : 3.2) * frameDelta);
        coreDustStepBudgetRef.current = THREE.MathUtils.lerp(
          coreDustStepBudgetRef.current,
          targetStepBudget,
          stepBudgetLerp
        );
        detailQuality = THREE.MathUtils.lerp(
          reducedMotion
            ? fogUniformTuning.detailQualityNearReduced
            : fogUniformTuning.detailQualityNear,
          reducedMotion
            ? fogUniformTuning.detailQualityFarReduced
            : fogUniformTuning.detailQualityFar,
          distanceBlend
        );

        coreDustCameraLocalRef.copy(camera.position);
        coreDustMeshRef.current.worldToLocal(coreDustCameraLocalRef);

        coreDustMeshRef.current.getWorldQuaternion(coreDustWorldQuatRef);
        coreDustWorldQuatInverseRef.copy(coreDustWorldQuatRef).invert();
        coreDustWindPrimaryLocalRef
          .copy(coreDustWindPrimaryWorldRef)
          .applyQuaternion(coreDustWorldQuatInverseRef)
          .normalize();
        coreDustWindSecondaryLocalRef
          .copy(coreDustWindSecondaryWorldRef)
          .applyQuaternion(coreDustWorldQuatInverseRef)
          .normalize();
        coreDustLightLocalRef
          .copy(coreDustLightWorldRef)
          .applyQuaternion(coreDustWorldQuatInverseRef)
          .normalize();

        coreDustMaterial.uniforms.uCameraLocal.value.copy(
          coreDustCameraLocalRef
        );
        coreDustMaterial.uniforms.uLightDirLocal.value.copy(
          coreDustLightLocalRef
        );
        coreDustMaterial.uniforms.uWindPrimary.value.copy(
          coreDustWindPrimaryLocalRef
        );
        coreDustMaterial.uniforms.uWindSecondary.value.copy(
          coreDustWindSecondaryLocalRef
        );
      }

      coreDustMaterial.uniforms.uTime.value = elapsed;
      coreDustMaterial.uniforms.uColor.value
        .copy(secondaryColor)
        .lerp(accentColor, 0.42);
      coreDustMaterial.uniforms.uSecondary.value
        .copy(accentColor)
        .lerp(secondaryColor, 0.26);
      coreDustMaterial.uniforms.uIntensity.value =
        intensity * silhouetteProfile.core * fogUniformTuning.intensityScale;
      coreDustMaterial.uniforms.uRadius.value = coreDustRadius;
      coreDustMaterial.uniforms.uDensity.value =
        coreDustProfile.density *
        (0.98 + intensity * 1.24) *
        fogUniformTuning.densityScale;
      coreDustMaterial.uniforms.uDetail.value =
        coreDustProfile.detail * detailQuality;
      coreDustMaterial.uniforms.uNoiseScale.value =
        coreDustProfile.noiseScale *
        (fogUniformTuning.noiseScaleBase +
          detailQuality * fogUniformTuning.noiseScaleDetailGain);
      coreDustMaterial.uniforms.uNoiseSpeed.value =
        coreDustProfile.noiseSpeed *
        (reducedMotion ? 0.5 : fogUniformTuning.noiseSpeedScale);
      coreDustMaterial.uniforms.uStepCount.value =
        coreDustStepBudgetRef.current;
      coreDustMaterial.uniforms.uFeather.value = coreDustProfile.feather;
      coreDustMaterial.uniforms.uOpacity.value =
        coreDustProfile.opacity *
        (0.42 + intensity * 0.78) *
        fogUniformTuning.opacityScale *
        silhouetteProfile.core *
        (reducedMotion ? 0.9 : 1);
    }

    if (accentPrimaryMaterialRef.current) {
      accentPrimaryMaterialRef.current.opacity =
        accentBaseOpacity.primary * silhouetteProfile.ringsPrimary * intensity;
    }

    if (accentSecondaryMaterialRef.current) {
      accentSecondaryMaterialRef.current.opacity =
        accentBaseOpacity.secondary *
        silhouetteProfile.ringsSecondary *
        intensity;
    }
  }, -2);

  return (
    <group ref={groupRef} position={project.coordinates}>
      <mesh
        ref={shellOcclusionRef}
        renderOrder={-10}
        frustumCulled={false}
        rotation={
          style.kind === "pulse" ? [Math.PI / 4, Math.PI / 3, 0] : [0, 0, 0]
        }
      >
        <icosahedronGeometry args={[style.shellScale, 1]} />
        <meshBasicMaterial
          colorWrite={false}
          transparent
          opacity={0}
          depthWrite
          depthTest
          side={THREE.FrontSide}
          toneMapped={false}
        />
      </mesh>

      <mesh
        ref={shellMaskRef}
        renderOrder={-40}
        frustumCulled={false}
        rotation={
          style.kind === "pulse" ? [Math.PI / 4, Math.PI / 3, 0] : [0, 0, 0]
        }
      >
        <icosahedronGeometry args={[style.shellScale, 1]} />
        <meshBasicMaterial
          colorWrite={false}
          depthWrite={false}
          depthTest={false}
          side={THREE.DoubleSide}
          stencilWrite
          stencilRef={1}
          stencilFunc={THREE.AlwaysStencilFunc}
          stencilFail={THREE.KeepStencilOp}
          stencilZFail={THREE.KeepStencilOp}
          stencilZPass={THREE.ReplaceStencilOp}
          toneMapped={false}
        />
      </mesh>

      {style.kind === "storm" && (
        <group ref={shellAccentMaskRef} renderOrder={-40}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.65, 0.018, 16, 120]} />
            <meshBasicMaterial
              colorWrite={false}
              depthWrite={false}
              depthTest={false}
              side={THREE.DoubleSide}
              stencilWrite
              stencilRef={1}
              stencilFunc={THREE.AlwaysStencilFunc}
              stencilFail={THREE.KeepStencilOp}
              stencilZFail={THREE.KeepStencilOp}
              stencilZPass={THREE.ReplaceStencilOp}
              toneMapped={false}
            />
          </mesh>
          <mesh rotation={[Math.PI / 2, Math.PI / 5, 0]}>
            <torusGeometry args={[1.37, 0.015, 16, 120]} />
            <meshBasicMaterial
              colorWrite={false}
              depthWrite={false}
              depthTest={false}
              side={THREE.DoubleSide}
              stencilWrite
              stencilRef={1}
              stencilFunc={THREE.AlwaysStencilFunc}
              stencilFail={THREE.KeepStencilOp}
              stencilZFail={THREE.KeepStencilOp}
              stencilZPass={THREE.ReplaceStencilOp}
              toneMapped={false}
            />
          </mesh>
        </group>
      )}

      {style.kind === "harmonic" && (
        <group ref={shellAccentMaskRef} renderOrder={-40}>
          <mesh rotation={[Math.PI / 2, 0.06, 0]}>
            <torusGeometry args={[1.65, 0.018, 12, 120]} />
            <meshBasicMaterial
              colorWrite={false}
              depthWrite={false}
              depthTest={false}
              side={THREE.DoubleSide}
              stencilWrite
              stencilRef={1}
              stencilFunc={THREE.AlwaysStencilFunc}
              stencilFail={THREE.KeepStencilOp}
              stencilZFail={THREE.KeepStencilOp}
              stencilZPass={THREE.ReplaceStencilOp}
              toneMapped={false}
            />
          </mesh>
          <mesh rotation={[Math.PI / 2, Math.PI / 5, 0]}>
            <torusGeometry args={[1.37, 0.015, 12, 120]} />
            <meshBasicMaterial
              colorWrite={false}
              depthWrite={false}
              depthTest={false}
              side={THREE.DoubleSide}
              stencilWrite
              stencilRef={1}
              stencilFunc={THREE.AlwaysStencilFunc}
              stencilFail={THREE.KeepStencilOp}
              stencilZFail={THREE.KeepStencilOp}
              stencilZPass={THREE.ReplaceStencilOp}
              toneMapped={false}
            />
          </mesh>
        </group>
      )}

      {style.kind === "pulse" && (
        <group ref={shellAccentMaskRef} renderOrder={-40}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.37, 0.018, 10, 90]} />
            <meshBasicMaterial
              colorWrite={false}
              depthWrite={false}
              depthTest={false}
              side={THREE.DoubleSide}
              stencilWrite
              stencilRef={1}
              stencilFunc={THREE.AlwaysStencilFunc}
              stencilFail={THREE.KeepStencilOp}
              stencilZFail={THREE.KeepStencilOp}
              stencilZPass={THREE.ReplaceStencilOp}
              toneMapped={false}
            />
          </mesh>
          <mesh rotation={[Math.PI / 2, Math.PI / 5, 0]}>
            <torusGeometry args={[1.65, 0.014, 10, 90]} />
            <meshBasicMaterial
              colorWrite={false}
              depthWrite={false}
              depthTest={false}
              side={THREE.DoubleSide}
              stencilWrite
              stencilRef={1}
              stencilFunc={THREE.AlwaysStencilFunc}
              stencilFail={THREE.KeepStencilOp}
              stencilZFail={THREE.KeepStencilOp}
              stencilZPass={THREE.ReplaceStencilOp}
              toneMapped={false}
            />
          </mesh>
        </group>
      )}

      <mesh ref={coreMaskRef} renderOrder={-39} frustumCulled={false}>
        <HeroCoreGeometry kind={style.kind} />
        <meshBasicMaterial
          colorWrite={false}
          depthWrite={false}
          depthTest={false}
          side={THREE.DoubleSide}
          stencilWrite
          stencilRef={1}
          stencilFunc={THREE.AlwaysStencilFunc}
          stencilFail={THREE.KeepStencilOp}
          stencilZFail={THREE.KeepStencilOp}
          stencilZPass={THREE.ReplaceStencilOp}
          toneMapped={false}
        />
      </mesh>

      <mesh
        ref={shellStarBlockerRef}
        renderOrder={-28}
        frustumCulled={false}
        rotation={
          style.kind === "pulse" ? [Math.PI / 4, Math.PI / 3, 0] : [0, 0, 0]
        }
      >
        <icosahedronGeometry args={[style.shellScale * 1.02, 1]} />
        <meshBasicMaterial
          color="#020407"
          transparent
          opacity={0.96}
          depthWrite={false}
          depthTest={false}
          toneMapped={false}
        />
      </mesh>

      <mesh
        ref={coreStarBlockerRef}
        renderOrder={-27}
        frustumCulled={false}
        visible={false}
      >
        <HeroCoreGeometry kind={style.kind} />
        <meshBasicMaterial
          color="#020407"
          transparent
          opacity={0.94}
          depthWrite={false}
          depthTest={false}
          toneMapped={false}
        />
      </mesh>

      <group ref={coreRef} scale={style.shellScale * 0.45}>
        <mesh renderOrder={-12}>
          <HeroCoreGeometry kind={style.kind} />
          <shaderMaterial
            ref={coreMaterialRef}
            uniforms={coreUniforms}
            vertexShader={CORE_VERTEX_SHADER}
            fragmentShader={CORE_FRAGMENT_SHADER}
            transparent
            depthTest
            depthWrite
            blending={THREE.NormalBlending}
          />
        </mesh>
      </group>

      <mesh
        ref={shellRef}
        renderOrder={-12}
        rotation={
          style.kind === "pulse" ? [Math.PI / 4, Math.PI / 3, 0] : [0, 0, 0]
        }
      >
        <icosahedronGeometry args={[style.shellScale, 1]} />
        <shaderMaterial
          ref={shellMaterialRef}
          uniforms={shellUniforms}
          vertexShader={SHELL_VERTEX_SHADER}
          fragmentShader={SHELL_FRAGMENT_SHADER}
          transparent
          depthTest
          depthWrite={false}
          blending={THREE.NormalBlending}
          wireframe
          toneMapped={false}
        />
      </mesh>

      <group ref={shellTraceGroupRef} visible={false}>
        <mesh ref={shellTraceSegmentRef} renderOrder={1}>
          <cylinderGeometry args={[0.028, 0.028, 1, 12, 1, true]} />
          <meshBasicMaterial
            ref={traceSegmentMaterialRef}
            color={style.accent}
            transparent
            opacity={0.46}
            depthWrite={false}
            depthTest={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>

        <mesh ref={shellTraceCoreRef} renderOrder={2}>
          <cylinderGeometry args={[0.013, 0.013, 1, 12, 1, true]} />
          <meshBasicMaterial
            ref={traceCoreMaterialRef}
            color={WHITE}
            transparent
            opacity={0.66}
            depthWrite={false}
            depthTest={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      </group>

      {style.kind === "storm" && (
        <group ref={shellAccentRef}>
          <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={-9}>
            <torusGeometry args={[1.65, 0.018, 16, 120]} />
            <meshBasicMaterial
              ref={accentPrimaryMaterialRef}
              color={style.accent}
              transparent
              opacity={0.22}
              depthTest
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
          <mesh rotation={[Math.PI / 2, Math.PI / 5, 0]} renderOrder={-9}>
            <torusGeometry args={[1.37, 0.015, 16, 120]} />
            <meshBasicMaterial
              ref={accentSecondaryMaterialRef}
              color={style.secondary}
              transparent
              opacity={0.18}
              depthTest
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        </group>
      )}

      {style.kind === "harmonic" && (
        <group ref={shellAccentRef}>
          <mesh rotation={[Math.PI / 2, 0.06, 0]} renderOrder={-9}>
            <torusGeometry args={[1.65, 0.018, 12, 120]} />
            <meshBasicMaterial
              ref={accentPrimaryMaterialRef}
              color={style.accent}
              transparent
              opacity={0.24}
              depthTest
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
          <mesh rotation={[Math.PI / 2, Math.PI / 5, 0]} renderOrder={-9}>
            <torusGeometry args={[1.37, 0.015, 12, 120]} />
            <meshBasicMaterial
              ref={accentSecondaryMaterialRef}
              color={style.secondary}
              transparent
              opacity={0.2}
              depthTest
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        </group>
      )}

      {style.kind === "pulse" && (
        <group ref={shellAccentRef}>
          <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={-9}>
            <torusGeometry args={[1.37, 0.018, 10, 90]} />
            <meshBasicMaterial
              ref={accentPrimaryMaterialRef}
              color={style.accent}
              transparent
              opacity={0.22}
              depthTest
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
          <mesh rotation={[Math.PI / 2, Math.PI / 5, 0]} renderOrder={-9}>
            <torusGeometry args={[1.65, 0.014, 10, 90]} />
            <meshBasicMaterial
              ref={accentSecondaryMaterialRef}
              color={style.secondary}
              transparent
              opacity={0.18}
              depthTest
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        </group>
      )}

      <group ref={coreDustGroupRef} visible={showCoreDust}>
        <mesh ref={coreDustMeshRef} renderOrder={-13} frustumCulled={false}>
          <icosahedronGeometry args={[coreDustRadius, 2]} />
          <shaderMaterial
            ref={coreDustMaterialRef}
            uniforms={coreDustUniforms}
            vertexShader={CORE_DUST_VERTEX_SHADER}
            fragmentShader={CORE_DUST_FRAGMENT_SHADER}
            transparent
            depthTest={false}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.BackSide}
            stencilWrite
            stencilRef={1}
            stencilFunc={THREE.EqualStencilFunc}
            stencilFail={THREE.KeepStencilOp}
            stencilZFail={THREE.KeepStencilOp}
            stencilZPass={THREE.KeepStencilOp}
            toneMapped={false}
          />
        </mesh>
      </group>

      <mesh
        ref={streamRibbonRef}
        geometry={etherealFilaments.geometry}
        renderOrder={-9}
        frustumCulled={false}
        visible={!showLegacySwarmOnly}
      >
        <shaderMaterial
          ref={streamRibbonMaterialRef}
          uniforms={streamRibbonUniforms}
          vertexShader={ETHEREAL_FILAMENT_VERTEX_SHADER}
          fragmentShader={ETHEREAL_FILAMENT_FRAGMENT_SHADER}
          transparent
          depthTest
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.FrontSide}
          toneMapped={false}
        />
      </mesh>

      <points ref={streamPointsRef} renderOrder={-8} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[streamParticles.positions, 3]}
          />
          <bufferAttribute
            attach="attributes-aSize"
            args={[streamParticles.sizes, 1]}
          />
          <bufferAttribute
            attach="attributes-aFlicker"
            args={[streamParticles.flickers, 1]}
          />
        </bufferGeometry>
        <shaderMaterial
          ref={streamSwarmMaterialRef}
          uniforms={streamSwarmUniforms}
          vertexShader={STREAM_SWARM_VERTEX_SHADER}
          fragmentShader={STREAM_SWARM_FRAGMENT_SHADER}
          transparent
          depthTest
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </points>
    </group>
  );
}

function CinematicBloom({
  project,
  reducedMotion,
  isMobileViewport,
}: CinematicBloomProps) {
  const { gl, scene, camera, size } = useThree();
  const composerRef = useRef<EffectComposer | null>(null);
  const bloomRef = useRef<UnrealBloomPass | null>(null);
  const rgbShiftRef = useRef<ShaderPass | null>(null);
  const vignetteRef = useRef<ShaderPass | null>(null);
  const filmRef = useRef<FilmPass | null>(null);

  useLayoutEffect(() => {
    const postFxScale = isMobileViewport ? 0.96 : 1;
    const targetWidth = Math.max(1, Math.floor(size.width * postFxScale));
    const targetHeight = Math.max(1, Math.floor(size.height * postFxScale));
    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(targetWidth, targetHeight),
      0.66,
      0.5,
      0.41
    );
    const rgbShiftPass = new ShaderPass(RGBShiftShader);
    const vignettePass = new ShaderPass(VignetteShader);
    const filmPass = new FilmPass(0.008, 0, 0, false);
    const composerTarget = new THREE.WebGLRenderTarget(
      targetWidth,
      targetHeight,
      {
        depthBuffer: true,
        stencilBuffer: true,
      }
    );
    if ("samples" in composerTarget) {
      composerTarget.samples = Math.min(
        isMobileViewport ? 2 : 4,
        gl.capabilities.maxSamples
      );
    }

    const rgbUniforms = rgbShiftPass.uniforms as Record<
      string,
      THREE.IUniform<number>
    >;
    rgbUniforms.amount.value = 0.00012;
    rgbUniforms.angle.value = 0.22;

    const vignetteUniforms = vignettePass.uniforms as Record<
      string,
      THREE.IUniform<number>
    >;
    vignetteUniforms.offset.value = 1.04;
    vignetteUniforms.darkness.value = 1.08;

    const filmUniforms = filmPass.uniforms as Record<
      string,
      THREE.IUniform<number>
    >;
    filmUniforms.nIntensity.value = 0.004;
    filmUniforms.sIntensity.value = 0;
    filmUniforms.sCount.value = 0;

    const composer = new EffectComposer(gl, composerTarget);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    if (!isMobileViewport) {
      composer.addPass(rgbShiftPass);
    }
    composer.addPass(vignettePass);
    if (!isMobileViewport) {
      composer.addPass(filmPass);
    }

    composerRef.current = composer;
    bloomRef.current = bloomPass;
    rgbShiftRef.current = rgbShiftPass;
    vignetteRef.current = vignettePass;
    filmRef.current = filmPass;

    return () => {
      composer.dispose();
      composerTarget.dispose();
      composerRef.current = null;
      bloomRef.current = null;
      rgbShiftRef.current = null;
      vignetteRef.current = null;
      filmRef.current = null;
    };
  }, [camera, gl, isMobileViewport, scene, size.height, size.width]);

  useLayoutEffect(() => {
    const bloomPass = bloomRef.current;
    const rgbShiftPass = rgbShiftRef.current;
    const vignettePass = vignetteRef.current;
    const filmPass = filmRef.current;

    if (!bloomPass || !rgbShiftPass || !vignettePass || !filmPass) {
      return;
    }

    const bloomStrengthScale = isMobileViewport ? 0.94 : 1;
    const bloomRadiusScale = isMobileViewport ? 0.76 : 1;
    const bloomThresholdLift = isMobileViewport ? 0.03 : 0;
    const rgbIntensityScale = isMobileViewport ? 0.72 : 1;
    const filmNoiseScale = isMobileViewport ? 0.5 : 1;
    const vignetteDarknessOffset = isMobileViewport ? -0.2 : 0;

    const rgbUniforms = rgbShiftPass.uniforms as Record<
      string,
      THREE.IUniform<number>
    >;
    const vignetteUniforms = vignettePass.uniforms as Record<
      string,
      THREE.IUniform<number>
    >;
    const filmUniforms = filmPass.uniforms as Record<
      string,
      THREE.IUniform<number>
    >;

    if (!project) {
      bloomPass.strength = (reducedMotion ? 0.46 : 0.58) * bloomStrengthScale;
      bloomPass.radius = 0.4 * bloomRadiusScale;
      bloomPass.threshold = 0.48 + bloomThresholdLift;
      rgbUniforms.amount.value = 0.00008 * rgbIntensityScale;
      vignetteUniforms.darkness.value = 0.9 + vignetteDarknessOffset;
      filmUniforms.nIntensity.value =
        (reducedMotion ? 0.0006 : 0.0016) * filmNoiseScale;
    } else if (project.id === "gpgpu-particles") {
      bloomPass.strength = (reducedMotion ? 0.54 : 0.68) * bloomStrengthScale;
      bloomPass.radius = 0.52 * bloomRadiusScale;
      bloomPass.threshold = 0.41 + bloomThresholdLift;
      rgbUniforms.amount.value = 0.00014 * rgbIntensityScale;
      vignetteUniforms.darkness.value = 1.04 + vignetteDarknessOffset;
      filmUniforms.nIntensity.value =
        (reducedMotion ? 0.0015 : 0.0038) * filmNoiseScale;
    } else if (project.id === "voyce") {
      bloomPass.strength = (reducedMotion ? 0.48 : 0.6) * bloomStrengthScale;
      bloomPass.radius = 0.48 * bloomRadiusScale;
      bloomPass.threshold = 0.43 + bloomThresholdLift;
      rgbUniforms.amount.value = 0.00012 * rgbIntensityScale;
      vignetteUniforms.darkness.value = 1.04 + vignetteDarknessOffset;
      filmUniforms.nIntensity.value =
        (reducedMotion ? 0.0014 : 0.0034) * filmNoiseScale;
    } else {
      bloomPass.strength = (reducedMotion ? 0.52 : 0.64) * bloomStrengthScale;
      bloomPass.radius = 0.5 * bloomRadiusScale;
      bloomPass.threshold = 0.42 + bloomThresholdLift;
      rgbUniforms.amount.value = 0.00013 * rgbIntensityScale;
      vignetteUniforms.darkness.value = 1.05 + vignetteDarknessOffset;
      filmUniforms.nIntensity.value =
        (reducedMotion ? 0.0015 : 0.0036) * filmNoiseScale;
    }
  }, [isMobileViewport, project, reducedMotion]);

  useFrame(({ clock }, delta) => {
    const elapsed = clock.getElapsedTime();
    const rgbShiftPass = rgbShiftRef.current;
    const vignettePass = vignetteRef.current;

    if (rgbShiftPass) {
      const rgbUniforms = rgbShiftPass.uniforms as Record<
        string,
        THREE.IUniform<number>
      >;
      rgbUniforms.angle.value = 0.2 + Math.sin(elapsed * 0.09) * 0.03;
    }

    if (vignettePass) {
      const vignetteUniforms = vignettePass.uniforms as Record<
        string,
        THREE.IUniform<number>
      >;
      vignetteUniforms.offset.value = 1.03 + Math.sin(elapsed * 0.06) * 0.015;
    }

    if (composerRef.current) {
      composerRef.current.render(delta);
    } else {
      gl.render(scene, camera);
    }
  }, 1);

  return null;
}

function CameraRig({
  projects,
  activeProject,
  controlsRef,
  reducedMotion,
  isMobileViewport,
  introUnlocked,
  onTransitionHalfway,
  onTransitionProgress,
}: CameraRigProps) {
  const { camera, size } = useThree();

  const startTargetRef = useRef(new THREE.Vector3());
  const startCameraRef = useRef(new THREE.Vector3());
  const endTargetRef = useRef(new THREE.Vector3());
  const endCameraRef = useRef(new THREE.Vector3());

  const startOffsetDirectionRef = useRef(new THREE.Vector3(0, 0, 1));
  const endOffsetDirectionRef = useRef(new THREE.Vector3(0, 0, 1));
  const startOffsetRadiusRef = useRef(1);
  const endOffsetRadiusRef = useRef(1);

  const activeAnchorRef = useRef(new THREE.Vector3());
  const transitionTargetRef = useRef(new THREE.Vector3());
  const transitionDirectionRef = useRef(new THREE.Vector3());
  const fallbackAxisRef = useRef(new THREE.Vector3(1, 0, 0));
  const introSwayAxisRef = useRef(new THREE.Vector3(1, 0, 0));

  const orbitCameraOffsetRef = useRef(new THREE.Vector3());
  const orbitTargetOffsetRef = useRef(new THREE.Vector3());

  const progressRef = useRef(1);
  const transitionStartTimeRef = useRef(0);
  const transitionDurationRef = useRef(0.01);
  const isTransitioningRef = useRef(true);
  const isInitialNeutralTransitionRef = useRef(false);
  const hasInitializedRef = useRef(false);
  const transitionModeRef = useRef<CameraTransitionMode>("focus-to-focus");
  const previousActiveProjectIdRef = useRef<string | null>(
    activeProject?.id ?? null
  );
  const isUserInteractingRef = useRef(false);
  const halfwayNotifiedRef = useRef(false);
  const wasDampingEnabledRef = useRef(true);
  const orbitResumeRef = useRef(1);
  const arrivalHoldRef = useRef(0);

  useEffect(() => {
    const controls = controlsRef.current;

    if (!controls) {
      return;
    }

    wasDampingEnabledRef.current = controls.enableDamping;

    const onStart = () => {
      isUserInteractingRef.current = true;
    };

    const onEnd = () => {
      isUserInteractingRef.current = false;
    };

    controls.addEventListener("start", onStart);
    controls.addEventListener("end", onEnd);

    return () => {
      controls.removeEventListener("start", onStart);
      controls.removeEventListener("end", onEnd);
    };
  }, [controlsRef]);

  useLayoutEffect(() => {
    const controls = controlsRef.current;

    if (projects.length === 0) {
      return;
    }

    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    const isNeutral = activeProject === null;
    const overallCentroid = new THREE.Vector3();
    projects.forEach((project) => {
      overallCentroid.add(new THREE.Vector3(...project.coordinates));
    });
    overallCentroid.multiplyScalar(1 / projects.length);

    const active = isNeutral
      ? overallCentroid.clone()
      : new THREE.Vector3(...activeProject.coordinates);

    const selectedProjectId = activeProject?.id ?? null;
    let focusRadius = 1;

    if (activeProject) {
      focusRadius = getFocusRadius(activeProject);
    }

    const sameSelectionWhileTransitioning =
      hasInitializedRef.current &&
      isTransitioningRef.current &&
      previousActiveProjectIdRef.current === selectedProjectId;

    if (sameSelectionWhileTransitioning) {
      return;
    }

    if (isNeutral) {
      let maxDistanceFromCentroid = 0;
      projects.forEach((project) => {
        maxDistanceFromCentroid = Math.max(
          maxDistanceFromCentroid,
          new THREE.Vector3(...project.coordinates).distanceTo(active)
        );
      });
      focusRadius = Math.max(2.2, maxDistanceFromCentroid + 0.8);
    }

    const fovRad = THREE.MathUtils.degToRad(perspectiveCamera.fov);

    const others =
      isNeutral || !selectedProjectId
        ? projects
        : projects.filter((project) => project.id !== selectedProjectId);
    const centroid = new THREE.Vector3();
    let maxDistanceToOthers = 0;

    if (others.length > 0) {
      others.forEach((project) => {
        const point = new THREE.Vector3(...project.coordinates);
        centroid.add(point);
        maxDistanceToOthers = Math.max(
          maxDistanceToOthers,
          point.distanceTo(active)
        );
      });
      centroid.multiplyScalar(1 / others.length);
    } else {
      centroid.copy(active).add(new THREE.Vector3(1, 0.2, 0.5));
    }

    const towardOthers = centroid.clone().sub(active);

    if (isNeutral) {
      towardOthers
        .set(
          isMobileViewport ? 0.04 : 0.18,
          isMobileViewport ? -0.03 : -0.08,
          -0.98
        )
        .normalize();
    } else {
      if (towardOthers.lengthSq() < 0.0001) {
        towardOthers.set(1, 0.2, 0.6);
      }
      towardOthers.normalize();
    }

    let yawOffset = 0;
    let distanceScale = 1;
    let verticalBoost = 0;

    if (isNeutral) {
      distanceScale = isMobileViewport ? 1.44 : 1.22;
      verticalBoost = isMobileViewport ? 0.2 : 0.14;
    } else if (selectedProjectId === "voyce") {
      yawOffset = 0.46;
      distanceScale = 0.9;
      verticalBoost = 0.1;
    } else if (selectedProjectId === "gpgpu-particles") {
      yawOffset = 0.14;
      distanceScale = 0.88;
    } else {
      yawOffset = 0.2;
      distanceScale = 0.86;
      verticalBoost = 0.05;
    }

    if (!isNeutral) {
      towardOthers.applyAxisAngle(WORLD_UP, yawOffset).normalize();
    }

    const side = new THREE.Vector3().crossVectors(WORLD_UP, towardOthers);

    if (side.lengthSq() < 0.0001) {
      side.copy(X_AXIS);
    }

    side.normalize();

    const desiredFill = isNeutral
      ? isMobileViewport
        ? 0.5
        : size.width < 900
        ? 0.66
        : 0.72
      : size.width < 900
      ? 0.78
      : 0.92;
    const fillDistance =
      (2 * focusRadius) / (desiredFill * Math.tan(fovRad / 2));
    const spreadAllowance = Math.min(1.2, maxDistanceToOthers * 0.18);
    const distance = THREE.MathUtils.clamp(
      (fillDistance + spreadAllowance) * distanceScale,
      isNeutral
        ? isMobileViewport
          ? 8.8
          : size.width < 900
          ? 5.0
          : 5.8
        : size.width < 900
        ? 3.8
        : 4.5,
      isNeutral
        ? isMobileViewport
          ? 13.4
          : size.width < 900
          ? 7.4
          : 8.6
        : size.width < 900
        ? 5.8
        : 6.8
    );

    const sideAmount = isNeutral
      ? isMobileViewport
        ? 0.04
        : size.width < 900
        ? 0.22
        : 0.28
      : size.width < 900
      ? 0.4
      : 0.52 + maxDistanceToOthers * 0.12;
    const verticalLift =
      (isMobileViewport ? 0.56 : size.width < 900 ? 0.42 : 0.6) + verticalBoost;

    const target = active.clone();
    const baseCameraPosition = active
      .clone()
      .sub(towardOthers.clone().multiplyScalar(distance));
    const plusSide = baseCameraPosition
      .clone()
      .add(side.clone().multiplyScalar(sideAmount))
      .add(new THREE.Vector3(0, verticalLift, 0));
    const minusSide = baseCameraPosition
      .clone()
      .add(side.clone().multiplyScalar(-sideAmount))
      .add(new THREE.Vector3(0, verticalLift, 0));

    const currentOffsetFromActive = camera.position.clone().sub(active);

    if (currentOffsetFromActive.lengthSq() < 0.0001) {
      currentOffsetFromActive.set(0, 0, 1);
    }

    const plusAngle = currentOffsetFromActive.angleTo(
      plusSide.clone().sub(active)
    );
    const minusAngle = currentOffsetFromActive.angleTo(
      minusSide.clone().sub(active)
    );
    const cameraPosition = isNeutral
      ? plusSide
      : plusAngle <= minusAngle
      ? plusSide
      : minusSide;

    const viewDirection = target.clone().sub(cameraPosition).normalize();
    const cameraRight = new THREE.Vector3()
      .crossVectors(viewDirection, WORLD_UP)
      .normalize();
    const cameraUp = new THREE.Vector3()
      .crossVectors(cameraRight, viewDirection)
      .normalize();

    let desiredNdcX = isNeutral
      ? isMobileViewport
        ? 0
        : -0.01
      : isMobileViewport
      ? -0.004
      : -0.03;
    let desiredNdcY = isNeutral
      ? isMobileViewport
        ? 0.24
        : size.width < 900
        ? 0
        : 0.04
      : isMobileViewport
      ? 0.28
      : size.width < 900
      ? -0.02
      : 0.02;

    if (isMobileViewport) {
      const panelElement = document.querySelector(
        ".hud-panel"
      ) as HTMLElement | null;

      if (panelElement) {
        const panelRect = panelElement.getBoundingClientRect();
        const topInset = Math.max(56, size.height * 0.07);
        const freeBottom = Math.max(topInset + 120, panelRect.top - 16);
        const freeCenterY = (topInset + freeBottom) * 0.5;
        const freeCenterNdcY = 1 - (freeCenterY / Math.max(size.height, 1)) * 2;

        desiredNdcY = isNeutral
          ? THREE.MathUtils.clamp(freeCenterNdcY - 0.04, 0.16, 0.42)
          : THREE.MathUtils.clamp(freeCenterNdcY + 0.04, 0.2, 0.5);
      }
    }

    if (size.width >= 900) {
      const panelElement = document.querySelector(
        ".hud-panel"
      ) as HTMLElement | null;

      if (panelElement) {
        const panelRect = panelElement.getBoundingClientRect();
        const safeRightEdge = Math.max(220, panelRect.left - 24);
        const remainderCenterX = Math.min(
          safeRightEdge - 24,
          safeRightEdge * 0.5 + 96
        );
        desiredNdcX = (remainderCenterX / Math.max(size.width, 1)) * 2 - 1;
      }
    }

    const verticalHalf = distance * Math.tan(fovRad / 2);
    const horizontalHalf = verticalHalf * perspectiveCamera.aspect;

    const lookOffset = new THREE.Vector3()
      .addScaledVector(cameraRight, -desiredNdcX * horizontalHalf)
      .addScaledVector(cameraUp, -desiredNdcY * verticalHalf);

    target.add(lookOffset);

    const shouldUseInitialNeutralTransition =
      !hasInitializedRef.current && isNeutral && !reducedMotion;

    const nextActiveProjectId = activeProject?.id ?? null;
    const previousActiveProjectId = previousActiveProjectIdRef.current;

    if (shouldUseInitialNeutralTransition) {
      const finalViewDirection = cameraPosition.clone().sub(target).normalize();
      const introSide = new THREE.Vector3().crossVectors(
        finalViewDirection,
        WORLD_UP
      );

      if (introSide.lengthSq() < 0.0001) {
        introSide.copy(X_AXIS);
      }

      introSide.normalize();
      introSwayAxisRef.current.copy(introSide);

      const introDistance = isMobileViewport ? 1.6 : size.width < 900 ? 1.9 : 2.6;
      const introSideOffset = isMobileViewport
        ? -0.16
        : size.width < 900
        ? -0.26
        : -0.44;
      const introLift = isMobileViewport ? 0.24 : size.width < 900 ? 0.3 : 0.44;

      startCameraRef.current
        .copy(cameraPosition)
        .addScaledVector(finalViewDirection, introDistance)
        .addScaledVector(introSide, introSideOffset)
        .addScaledVector(WORLD_UP, introLift);

      startTargetRef.current
        .copy(target)
        .addScaledVector(introSide, introSideOffset * 0.7)
        .addScaledVector(WORLD_UP, introLift * 0.44);

      isInitialNeutralTransitionRef.current = true;
      transitionModeRef.current = "neutral-intro";
    } else {
      startTargetRef.current.copy(controls?.target ?? active);
      startCameraRef.current.copy(camera.position);
      isInitialNeutralTransitionRef.current = false;

      if (previousActiveProjectId === null && nextActiveProjectId !== null) {
        transitionModeRef.current = "neutral-to-focus";
      } else if (
        previousActiveProjectId !== null &&
        nextActiveProjectId === null
      ) {
        transitionModeRef.current = "focus-to-neutral";
      } else {
        transitionModeRef.current = "focus-to-focus";
      }
    }

    endTargetRef.current.copy(target);
    endCameraRef.current.copy(cameraPosition);
    activeAnchorRef.current.copy(active);
    hasInitializedRef.current = true;
    previousActiveProjectIdRef.current = nextActiveProjectId;

    const startOffset = startCameraRef.current
      .clone()
      .sub(startTargetRef.current);
    const endOffset = endCameraRef.current.clone().sub(endTargetRef.current);

    if (startOffset.lengthSq() < 0.0001) {
      startOffset.copy(
        endOffset.lengthSq() < 0.0001 ? new THREE.Vector3(0, 0, 1) : endOffset
      );
    }

    if (endOffset.lengthSq() < 0.0001) {
      endOffset.copy(startOffset);
    }

    startOffsetRadiusRef.current = Math.max(startOffset.length(), 0.001);
    endOffsetRadiusRef.current = Math.max(endOffset.length(), 0.001);
    startOffsetDirectionRef.current.copy(startOffset.normalize());
    endOffsetDirectionRef.current.copy(endOffset.normalize());

    camera.position.copy(startCameraRef.current);
    if (isInitialNeutralTransitionRef.current) {
      const introSwayAtStart = isMobileViewport
        ? -0.012
        : size.width < 900
        ? -0.022
        : -0.036;
      camera.position.addScaledVector(
        introSwayAxisRef.current,
        introSwayAtStart
      );
    }
    if (controls) {
      controls.target.copy(startTargetRef.current);
      controls.update();
    }
    camera.lookAt(startTargetRef.current);
    camera.updateMatrixWorld();

    progressRef.current = 0;
    transitionDurationRef.current = getCameraTransitionDuration(
      transitionModeRef.current,
      size.width,
      reducedMotion
    );
    transitionStartTimeRef.current = performance.now() * 0.001;
    isTransitioningRef.current = true;
    isUserInteractingRef.current = false;
    halfwayNotifiedRef.current = false;
    orbitResumeRef.current = 0;
    arrivalHoldRef.current = 0;
    onTransitionProgress?.(0);
  }, [
    activeProject,
    projects,
    size.width,
    size.height,
    isMobileViewport,
    camera,
    controlsRef,
    onTransitionProgress,
  ]);

  useFrame((_state, delta) => {
    const controls = controlsRef.current;

    if (!controls) {
      return;
    }

    if (!isTransitioningRef.current) {
      controls.enabled = true;
      controls.enableDamping = wasDampingEnabledRef.current;
      const frameDelta = reducedMotion ? delta : Math.min(delta, 1 / 30);

      if (arrivalHoldRef.current > 0) {
        arrivalHoldRef.current = Math.max(
          0,
          arrivalHoldRef.current - frameDelta
        );
        controls.update();
        return;
      }

      if (!reducedMotion && !isUserInteractingRef.current && activeProject) {
        orbitResumeRef.current = THREE.MathUtils.clamp(
          orbitResumeRef.current + frameDelta * 1.6,
          0,
          1
        );
        const orbitBlend = easeInOutCubic(orbitResumeRef.current);
        const orbitSpeed = isMobileViewport
          ? 0.062
          : size.width < 900
          ? 0.08
          : 0.055;
        const theta = frameDelta * orbitSpeed * orbitBlend;

        orbitCameraOffsetRef.current
          .copy(camera.position)
          .sub(activeAnchorRef.current);
        orbitTargetOffsetRef.current
          .copy(controls.target)
          .sub(activeAnchorRef.current);

        orbitCameraOffsetRef.current.applyAxisAngle(WORLD_UP, theta);
        orbitTargetOffsetRef.current.applyAxisAngle(WORLD_UP, theta);

        camera.position
          .copy(activeAnchorRef.current)
          .add(orbitCameraOffsetRef.current);
        controls.target
          .copy(activeAnchorRef.current)
          .add(orbitTargetOffsetRef.current);
      } else {
        orbitResumeRef.current = THREE.MathUtils.clamp(
          orbitResumeRef.current - frameDelta * 2.2,
          0,
          1
        );
      }

      controls.update();
      return;
    }

    controls.enabled = false;
    controls.enableDamping = false;

    const transitionMode = transitionModeRef.current;
    if (transitionMode === "neutral-intro" && !introUnlocked) {
      transitionStartTimeRef.current = performance.now() * 0.001;
      progressRef.current = 0;
      onTransitionProgress?.(0);
      controls.target.copy(startTargetRef.current);
      camera.position.copy(startCameraRef.current);
      const introSwayAtStart = isMobileViewport
        ? -0.012
        : size.width < 900
        ? -0.022
        : -0.036;
      camera.position.addScaledVector(
        introSwayAxisRef.current,
        introSwayAtStart
      );
      camera.lookAt(startTargetRef.current);
      camera.updateMatrixWorld();
      return;
    }

    const transitionDuration = Math.max(0.01, transitionDurationRef.current);
    const elapsed = Math.max(
      0,
      performance.now() * 0.001 - transitionStartTimeRef.current
    );
    const nextProgress = Math.min(1, elapsed / transitionDuration);
    progressRef.current = nextProgress;
    onTransitionProgress?.(nextProgress);

    if (!halfwayNotifiedRef.current && nextProgress >= 0.5) {
      halfwayNotifiedRef.current = true;
      onTransitionHalfway?.();
    }

    let eased = easeInOutSine(nextProgress);

    if (transitionMode === "neutral-intro") {
      eased = smoothstep(0, 1, nextProgress);
    } else if (transitionMode === "focus-to-focus") {
      eased = easeInOutCubic(nextProgress);
    }
    const arcLift = reducedMotion
      ? 0
      : transitionMode === "neutral-intro"
      ? Math.sin(Math.PI * eased) *
        (isMobileViewport ? 0.048 : size.width < 900 ? 0.075 : 0.15)
      : transitionMode === "neutral-to-focus"
      ? Math.sin(Math.PI * eased) *
        (isMobileViewport ? 0.062 : size.width < 900 ? 0.085 : 0.21)
      : transitionMode === "focus-to-neutral"
      ? Math.sin(Math.PI * eased) *
        (isMobileViewport ? 0.046 : size.width < 900 ? 0.06 : 0.15)
      : Math.sin(Math.PI * eased) *
        (isMobileViewport ? 0.07 : size.width < 900 ? 0.1 : 0.3);

    transitionTargetRef.current.lerpVectors(
      startTargetRef.current,
      endTargetRef.current,
      eased
    );
    controls.target.copy(transitionTargetRef.current);

    const startDirection = startOffsetDirectionRef.current;
    const endDirection = endOffsetDirectionRef.current;
    const dot = THREE.MathUtils.clamp(startDirection.dot(endDirection), -1, 1);

    if (dot > 0.9995) {
      transitionDirectionRef.current
        .lerpVectors(startDirection, endDirection, eased)
        .normalize();
    } else if (dot < -0.9995) {
      fallbackAxisRef.current.crossVectors(WORLD_UP, startDirection);

      if (fallbackAxisRef.current.lengthSq() < 0.0001) {
        fallbackAxisRef.current.crossVectors(X_AXIS, startDirection);
      }

      fallbackAxisRef.current.normalize();
      transitionDirectionRef.current
        .copy(startDirection)
        .applyAxisAngle(fallbackAxisRef.current, Math.PI * eased)
        .normalize();
    } else {
      const theta = Math.acos(dot);
      const sinTheta = Math.sin(theta);
      const startWeight = Math.sin((1 - eased) * theta) / sinTheta;
      const endWeight = Math.sin(eased * theta) / sinTheta;

      transitionDirectionRef.current
        .copy(startDirection)
        .multiplyScalar(startWeight)
        .addScaledVector(endDirection, endWeight)
        .normalize();
    }

    const radius = THREE.MathUtils.lerp(
      startOffsetRadiusRef.current,
      endOffsetRadiusRef.current,
      eased
    );
    const cinematicDolly = reducedMotion
      ? 0
      : transitionMode === "neutral-intro"
      ? Math.sin(Math.PI * eased) *
        (isMobileViewport ? 0.1 : size.width < 900 ? 0.18 : 0.32)
      : transitionMode === "neutral-to-focus"
      ? Math.sin(Math.PI * eased) *
        (isMobileViewport ? 0.22 : size.width < 900 ? 0.36 : 0.82)
      : transitionMode === "focus-to-neutral"
      ? Math.sin(Math.PI * eased) *
        (isMobileViewport ? 0.18 : size.width < 900 ? 0.28 : 0.64)
      : Math.sin(Math.PI * eased) *
        (isMobileViewport ? 0.3 : size.width < 900 ? 0.54 : 1.14);

    camera.position
      .copy(transitionTargetRef.current)
      .addScaledVector(transitionDirectionRef.current, radius + cinematicDolly);
    if (transitionMode === "neutral-intro") {
      const introSway = (1 - eased) *
        (isMobileViewport ? -0.012 : size.width < 900 ? -0.022 : -0.036);
      camera.position.addScaledVector(introSwayAxisRef.current, introSway);
    }
    camera.position.addScaledVector(WORLD_UP, arcLift);
    camera.lookAt(transitionTargetRef.current);
    camera.updateMatrixWorld();

    if (nextProgress >= 1) {
      if (!halfwayNotifiedRef.current) {
        halfwayNotifiedRef.current = true;
        onTransitionHalfway?.();
      }

      isTransitioningRef.current = false;
      onTransitionProgress?.(1);
      orbitResumeRef.current = 0;
      arrivalHoldRef.current = reducedMotion
        ? 0
        : transitionMode === "neutral-intro"
        ? 0.08
        : 0.22;
      isInitialNeutralTransitionRef.current = false;
      controls.enabled = true;
      controls.enableDamping = wasDampingEnabledRef.current;
      controls.target.copy(transitionTargetRef.current);
      camera.lookAt(transitionTargetRef.current);
      camera.updateMatrixWorld();
      controls.update();
    }
  }, -1);

  return null;
}

function CinematicLights({
  project,
  reducedMotion,
}: {
  project: Project | null;
  reducedMotion: boolean;
}) {
  const keyRef = useRef<THREE.PointLight>(null);
  const rimRef = useRef<THREE.PointLight>(null);
  const fillRef = useRef<THREE.PointLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);

  const palette = useMemo(() => {
    if (!project) {
      return {
        key: "#8fb9ef",
        rim: "#6a8bc5",
        fill: "#9db1d0",
        hemiSky: "#a8c6ee",
        hemiGround: "#091321",
        keyIntensity: 1.1,
        rimIntensity: 0.52,
        fillIntensity: 0.42,
      };
    }

    if (project.id === "gpgpu-particles") {
      return {
        key: "#88c9ff",
        rim: "#5a86ff",
        fill: "#9ebce3",
        hemiSky: "#b2d8ff",
        hemiGround: "#091324",
        keyIntensity: 1.36,
        rimIntensity: 0.72,
        fillIntensity: 0.58,
      };
    }

    if (project.id === "voyce") {
      return {
        key: "#8cf5d8",
        rim: "#4fbf98",
        fill: "#9dd9c9",
        hemiSky: "#b0ffea",
        hemiGround: "#081a1c",
        keyIntensity: 1.28,
        rimIntensity: 0.68,
        fillIntensity: 0.54,
      };
    }

    if (project.id === "tone-tap") {
      return {
        key: "#ffd29f",
        rim: "#eba15c",
        fill: "#ffd9b8",
        hemiSky: "#ffe8cc",
        hemiGround: "#2a1b12",
        keyIntensity: 1.44,
        rimIntensity: 0.78,
        fillIntensity: 0.64,
      };
    }

    return {
      key: "#ffc58f",
      rim: "#dd8f50",
      fill: "#e6bb94",
      hemiSky: "#ffe0bf",
      hemiGround: "#1a1009",
      keyIntensity: 1.34,
      rimIntensity: 0.7,
      fillIntensity: 0.55,
    };
  }, [project]);

  useEffect(() => {
    if (keyRef.current) {
      keyRef.current.color.set(palette.key);
    }

    if (rimRef.current) {
      rimRef.current.color.set(palette.rim);
    }

    if (fillRef.current) {
      fillRef.current.color.set(palette.fill);
    }

    if (hemiRef.current) {
      hemiRef.current.color.set(palette.hemiSky);
      hemiRef.current.groundColor.set(palette.hemiGround);
    }
  }, [palette]);

  useFrame(({ clock }) => {
    const pulse = reducedMotion
      ? 0
      : (Math.sin(clock.getElapsedTime() * 1.2) + 1) * 0.5;

    if (keyRef.current) {
      keyRef.current.intensity = THREE.MathUtils.lerp(
        keyRef.current.intensity,
        palette.keyIntensity * (0.92 + pulse * 0.12),
        0.08
      );
    }

    if (rimRef.current) {
      rimRef.current.intensity = THREE.MathUtils.lerp(
        rimRef.current.intensity,
        palette.rimIntensity * (0.9 + pulse * 0.12),
        0.08
      );
    }

    if (fillRef.current) {
      fillRef.current.intensity = THREE.MathUtils.lerp(
        fillRef.current.intensity,
        palette.fillIntensity * (0.9 + pulse * 0.1),
        0.08
      );
    }
  });

  return (
    <>
      <ambientLight intensity={0.34} />
      <hemisphereLight
        ref={hemiRef}
        args={[palette.hemiSky, palette.hemiGround, 0.4]}
      />
      <pointLight
        ref={keyRef}
        position={[6, 5, 4]}
        intensity={palette.keyIntensity}
        color={palette.key}
      />
      <pointLight
        ref={fillRef}
        position={[-6, -2.5, -3]}
        intensity={palette.fillIntensity}
        color={palette.fill}
      />
      <pointLight
        ref={rimRef}
        position={[0, 3, -7]}
        intensity={palette.rimIntensity}
        color={palette.rim}
      />
    </>
  );
}

function NeutralStarField({
  reducedMotion,
  isMobileViewport,
  bootstrapProgressRef,
}: {
  reducedMotion: boolean;
  isMobileViewport: boolean;
  bootstrapProgressRef?: RefObject<number>;
}) {
  const baseGroupRef = useRef<THREE.Group>(null);
  const midGroupRef = useRef<THREE.Group>(null);
  const overlayGroupRef = useRef<THREE.Group>(null);
  const baseMeshRef = useRef<THREE.InstancedMesh>(null);
  const midMeshRef = useRef<THREE.InstancedMesh>(null);
  const overlayMeshRef = useRef<THREE.InstancedMesh>(null);
  const nebulaNearRef = useRef<THREE.Mesh>(null);
  const nebulaFarRef = useRef<THREE.Mesh>(null);
  const nebulaNearMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const nebulaFarMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const scratchObject = useMemo(() => new THREE.Object3D(), []);
  const starDensity = isMobileViewport ? 0.58 : 1;
  const starSegments = isMobileViewport ? 8 : 10;

  const neutralBaseStars = useMemo(
    () =>
      createNeutralStarInstances(
        "neutral-stars-base",
        Math.round(2200 * starDensity),
        122,
        28,
        [0.026, 0.062]
      ),
    [starDensity]
  );
  const neutralMidStars = useMemo(
    () =>
      createNeutralStarInstances(
        "neutral-stars-mid",
        Math.round(1340 * starDensity),
        108,
        22,
        [0.022, 0.052]
      ),
    [starDensity]
  );
  const neutralOverlayStars = useMemo(
    () =>
      createNeutralStarInstances(
        "neutral-stars-overlay",
        Math.round(890 * starDensity),
        94,
        18,
        [0.038, 0.085]
      ),
    [starDensity]
  );
  const nebulaNearUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: new THREE.Color("#294a64") },
      uOpacity: { value: 0.08 },
      uScale: { value: 3.5 },
    }),
    []
  );
  const nebulaFarUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: new THREE.Color("#3a4d73") },
      uOpacity: { value: 0.06 },
      uScale: { value: 2.9 },
    }),
    []
  );

  const applyInstances = useCallback(
    (mesh: THREE.InstancedMesh | null, stars: NeutralStarInstances) => {
      if (!mesh) {
        return;
      }

      for (let index = 0; index < stars.count; index += 1) {
        const offset = index * 3;
        scratchObject.position.set(
          stars.positions[offset],
          stars.positions[offset + 1],
          stars.positions[offset + 2]
        );
        scratchObject.scale.setScalar(stars.scales[index]);
        scratchObject.updateMatrix();
        mesh.setMatrixAt(index, scratchObject.matrix);
      }

      mesh.instanceMatrix.needsUpdate = true;
    },
    [scratchObject]
  );

  useLayoutEffect(() => {
    applyInstances(baseMeshRef.current, neutralBaseStars);
    applyInstances(midMeshRef.current, neutralMidStars);
    applyInstances(overlayMeshRef.current, neutralOverlayStars);
  }, [applyInstances, neutralBaseStars, neutralMidStars, neutralOverlayStars]);

  useFrame(({ clock }) => {
    const elapsed = clock.getElapsedTime();
    const bootstrapReveal = clamp01(bootstrapProgressRef?.current ?? 1);
    const revealBlend = smoothstep(0, 1, bootstrapReveal);

    if (baseMeshRef.current) {
      baseMeshRef.current.count = Math.floor(
        neutralBaseStars.count * revealBlend
      );
    }

    if (midMeshRef.current) {
      midMeshRef.current.count = Math.floor(
        neutralMidStars.count * revealBlend
      );
    }

    if (overlayMeshRef.current) {
      overlayMeshRef.current.count = Math.floor(
        neutralOverlayStars.count * revealBlend
      );
    }

    if (baseGroupRef.current) {
      baseGroupRef.current.visible = revealBlend > 0.001;
      baseGroupRef.current.rotation.y = reducedMotion ? 0 : elapsed * 0.006;
      baseGroupRef.current.rotation.x = reducedMotion
        ? 0
        : Math.sin(elapsed * 0.03) * 0.012;
    }

    if (midGroupRef.current) {
      midGroupRef.current.visible = revealBlend > 0.001;
      midGroupRef.current.rotation.y = reducedMotion
        ? 0
        : elapsed * 0.0054 + 0.22;
      midGroupRef.current.rotation.x = reducedMotion
        ? 0
        : Math.sin(elapsed * 0.022) * 0.014;
    }

    if (overlayGroupRef.current) {
      overlayGroupRef.current.visible = revealBlend > 0.001;
      overlayGroupRef.current.rotation.y = reducedMotion
        ? 0
        : elapsed * 0.0048 + 0.4;
      overlayGroupRef.current.rotation.x = reducedMotion
        ? 0
        : Math.cos(elapsed * 0.028) * 0.01;
    }

    if (nebulaNearRef.current) {
      nebulaNearRef.current.rotation.z = reducedMotion
        ? -0.34
        : -0.34 + Math.sin(elapsed * 0.045) * 0.04;
      nebulaNearRef.current.rotation.y = reducedMotion
        ? 0.22
        : 0.22 + Math.cos(elapsed * 0.032) * 0.05;
    }

    if (nebulaFarRef.current) {
      nebulaFarRef.current.rotation.z = reducedMotion
        ? 0.2
        : 0.2 + Math.sin(elapsed * 0.034) * 0.035;
      nebulaFarRef.current.rotation.y = reducedMotion
        ? -0.18
        : -0.18 + Math.cos(elapsed * 0.028) * 0.038;
    }

    if (nebulaNearMaterialRef.current) {
      nebulaNearMaterialRef.current.uniforms.uTime.value = elapsed;
      nebulaNearMaterialRef.current.uniforms.uOpacity.value =
        (0.07 + Math.sin(elapsed * 0.14) * 0.008) * revealBlend;
    }

    if (nebulaFarMaterialRef.current) {
      nebulaFarMaterialRef.current.uniforms.uTime.value = elapsed + 11;
      nebulaFarMaterialRef.current.uniforms.uOpacity.value =
        (0.055 + Math.cos(elapsed * 0.11) * 0.007) * revealBlend;
    }
  });

  return (
    <>
      <mesh
        ref={nebulaFarRef}
        position={[6, 8, -118]}
        rotation={[-0.32, -0.18, 0.2]}
        renderOrder={-36}
      >
        <planeGeometry args={[236, 144, 1, 1]} />
        <shaderMaterial
          ref={nebulaFarMaterialRef}
          uniforms={nebulaFarUniforms}
          vertexShader={NEBULA_VERTEX_SHADER}
          fragmentShader={NEBULA_FRAGMENT_SHADER}
          transparent
          depthWrite={false}
          depthTest
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <group
        ref={baseGroupRef}
        position={[0, 0, -32]}
        renderOrder={-30}
        frustumCulled={false}
      >
        <instancedMesh
          ref={baseMeshRef}
          args={[undefined, undefined, neutralBaseStars.count]}
          renderOrder={-30}
          frustumCulled={false}
        >
          <sphereGeometry args={[2, starSegments, starSegments]} />
          <meshBasicMaterial
            color="#d7e4f4"
            transparent={false}
            depthWrite={false}
            depthTest
            stencilWrite
            stencilRef={1}
            stencilFunc={THREE.NotEqualStencilFunc}
            stencilFail={THREE.KeepStencilOp}
            stencilZFail={THREE.KeepStencilOp}
            stencilZPass={THREE.KeepStencilOp}
            blending={THREE.NormalBlending}
            fog={false}
            toneMapped={false}
          />
        </instancedMesh>
      </group>

      <group
        ref={midGroupRef}
        position={[0, 0, -32]}
        renderOrder={-31}
        frustumCulled={false}
      >
        <instancedMesh
          ref={midMeshRef}
          args={[undefined, undefined, neutralMidStars.count]}
          renderOrder={-31}
          frustumCulled={false}
        >
          <sphereGeometry args={[2, starSegments, starSegments]} />
          <meshBasicMaterial
            color="#d9e5f5"
            transparent={false}
            depthWrite={false}
            depthTest
            stencilWrite
            stencilRef={1}
            stencilFunc={THREE.NotEqualStencilFunc}
            stencilFail={THREE.KeepStencilOp}
            stencilZFail={THREE.KeepStencilOp}
            stencilZPass={THREE.KeepStencilOp}
            blending={THREE.NormalBlending}
            fog={false}
            toneMapped={false}
          />
        </instancedMesh>
      </group>

      <group
        ref={overlayGroupRef}
        position={[0, 0, -32]}
        renderOrder={-29}
        frustumCulled={false}
      >
        <instancedMesh
          ref={overlayMeshRef}
          args={[undefined, undefined, neutralOverlayStars.count]}
          renderOrder={-29}
          frustumCulled={false}
        >
          <sphereGeometry args={[2, starSegments, starSegments]} />
          <meshBasicMaterial
            color="#e5eefb"
            transparent={false}
            depthWrite={false}
            depthTest
            stencilWrite
            stencilRef={1}
            stencilFunc={THREE.NotEqualStencilFunc}
            stencilFail={THREE.KeepStencilOp}
            stencilZFail={THREE.KeepStencilOp}
            stencilZPass={THREE.KeepStencilOp}
            blending={THREE.NormalBlending}
            fog={false}
            toneMapped={false}
          />
        </instancedMesh>
      </group>

      <mesh
        ref={nebulaNearRef}
        position={[-8, -6, -90]}
        rotation={[0.2, 0.22, -0.34]}
        renderOrder={-33}
      >
        <planeGeometry args={[178, 110, 1, 1]} />
        <shaderMaterial
          ref={nebulaNearMaterialRef}
          uniforms={nebulaNearUniforms}
          vertexShader={NEBULA_VERTEX_SHADER}
          fragmentShader={NEBULA_FRAGMENT_SHADER}
          transparent
          depthWrite={false}
          depthTest
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </>
  );
}

function IntroConnectionSegment({
  connection,
  connectionIndex,
  lineColor,
  lineBaseOpacity,
  introSequenceActive,
  introRevealActive,
  introRevealProgressRef,
  reverseTracer,
}: IntroConnectionSegmentProps) {
  const lineMeshRef = useRef<THREE.Mesh>(null);
  const lineMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const tracerCoreMeshRef = useRef<THREE.Mesh>(null);
  const tracerCoreMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const tracerCoronaMeshRef = useRef<THREE.Mesh>(null);
  const tracerCoronaMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const tracerCoreUniforms = useMemo(
    () => ({
      uColor: { value: INTRO_TRACER_COLOR.clone() },
      uOpacity: { value: 0 },
      uHeadAtStart: { value: reverseTracer ? 1 : 0 },
      uTailFalloff: { value: 4.9 },
      uTipScale: { value: 0.2 },
    }),
    [reverseTracer]
  );
  const tracerCoronaUniforms = useMemo(
    () => ({
      uColor: { value: INTRO_TRACER_CORONA_COLOR.clone() },
      uOpacity: { value: 0 },
      uHeadAtStart: { value: reverseTracer ? 1 : 0 },
      uTailFalloff: { value: 3.2 },
      uTipScale: { value: 0.18 },
    }),
    [reverseTracer]
  );
  const lineCenterRef = useMemo(() => new THREE.Vector3(), []);
  const tracerCenterRef = useMemo(() => new THREE.Vector3(), []);

  const start = useMemo(
    () =>
      new THREE.Vector3(
        connection.points[0][0],
        connection.points[0][1],
        connection.points[0][2]
      ),
    [connection.points]
  );
  const direction = useMemo(
    () =>
      new THREE.Vector3(
        connection.points[1][0] - connection.points[0][0],
        connection.points[1][1] - connection.points[0][1],
        connection.points[1][2] - connection.points[0][2]
      ).normalize(),
    [connection.points]
  );
  const midpoint = useMemo(
    () =>
      new THREE.Vector3(
        connection.midpoint[0],
        connection.midpoint[1],
        connection.midpoint[2]
      ),
    [connection.midpoint]
  );

  useEffect(() => {
    if (lineMaterialRef.current) {
      lineMaterialRef.current.color.set(lineColor);
    }
  }, [lineColor]);

  useFrame(() => {
    const lineMesh = lineMeshRef.current;
    const tracerCoreMesh = tracerCoreMeshRef.current;
    const tracerCoronaMesh = tracerCoronaMeshRef.current;
    const lineMaterial = lineMaterialRef.current;
    const tracerCoreMaterial = tracerCoreMaterialRef.current;
    const tracerCoronaMaterial = tracerCoronaMaterialRef.current;

    if (
      !lineMesh ||
      !tracerCoreMesh ||
      !tracerCoronaMesh ||
      !lineMaterial ||
      !tracerCoreMaterial ||
      !tracerCoronaMaterial
    ) {
      return;
    }

    const introProgress = introSequenceActive
      ? introRevealProgressRef.current
      : 1;
    const lineRevealLinear = introSequenceActive
      ? clamp01(
          (introProgress -
            connectionIndex * (0.045 / INTRO_CONNECTION_SPEED_MULTIPLIER)) /
            (0.42 / INTRO_CONNECTION_SPEED_MULTIPLIER)
        )
      : 1;
    const lineReveal = introSequenceActive
      ? easeInOutCubic(lineRevealLinear)
      : 1;
    const renderedLength = Math.max(0.001, connection.length * lineReveal);

    if (introSequenceActive) {
      const lineCenterDistance = reverseTracer
        ? connection.length - renderedLength * 0.5
        : renderedLength * 0.5;
      lineCenterRef.copy(start).addScaledVector(direction, lineCenterDistance);
      lineMesh.position.copy(lineCenterRef);
    } else {
      lineMesh.position.copy(midpoint);
    }

    lineMesh.scale.set(1, renderedLength, 1);
    lineMaterial.opacity =
      lineBaseOpacity * (introSequenceActive ? lineReveal : 1);

    if (!introSequenceActive) {
      tracerCoreMesh.position.copy(midpoint);
      tracerCoreMesh.scale.set(1, 0.001, 1);
      tracerCoreMaterial.uniforms.uOpacity.value = 0;
      tracerCoronaMesh.position.copy(midpoint);
      tracerCoronaMesh.scale.set(2.2, 0.001, 2.2);
      tracerCoronaMaterial.uniforms.uOpacity.value = 0;
      return;
    }

    const tracerProgressLinear = introRevealActive
      ? clamp01(
          (introProgress -
            0.08 -
            connectionIndex * (0.05 / INTRO_CONNECTION_SPEED_MULTIPLIER)) /
            (0.52 / INTRO_CONNECTION_SPEED_MULTIPLIER)
        )
      : 0;
    const tracerDistance = THREE.MathUtils.lerp(
      0,
      connection.length,
      tracerProgressLinear
    );
    const tracerMaxLength = Math.min(
      0.82,
      Math.max(0.3, connection.length * 0.25)
    );
    const halfMax = tracerMaxLength * 0.5;
    const halfBoundary = Math.max(
      0,
      Math.min(tracerDistance, connection.length - tracerDistance)
    );
    const tracerHalf = Math.min(halfMax, halfBoundary);

    if (tracerHalf <= 0.0005) {
      tracerCoreMesh.position.copy(midpoint);
      tracerCoreMesh.scale.set(1, 0.001, 1);
      tracerCoreMaterial.uniforms.uOpacity.value = 0;
      tracerCoronaMesh.position.copy(midpoint);
      tracerCoronaMesh.scale.set(2.2, 0.001, 2.2);
      tracerCoronaMaterial.uniforms.uOpacity.value = 0;
      return;
    }

    const tracerLength = Math.max(0.002, tracerHalf * 2);
    const tracerHeadDistanceDirected = reverseTracer
      ? connection.length - tracerDistance
      : tracerDistance;
    const tracerCenterDistanceDirected = reverseTracer
      ? tracerHeadDistanceDirected + tracerLength * 0.5
      : tracerHeadDistanceDirected - tracerLength * 0.5;
    const tracerCenterDistance = THREE.MathUtils.clamp(
      tracerCenterDistanceDirected,
      0,
      connection.length
    );
    const tracerEnvelope =
      halfMax <= 0 ? 0 : smoothstep(0, 1, tracerHalf / halfMax);
    const tracerOpacity = tracerEnvelope;

    tracerCenterRef
      .copy(start)
      .addScaledVector(direction, tracerCenterDistance);
    tracerCoreMesh.position.copy(tracerCenterRef);
    tracerCoreMesh.scale.set(1, tracerLength, 1);
    tracerCoreMaterial.uniforms.uOpacity.value = tracerOpacity;
    tracerCoronaMesh.position.copy(tracerCenterRef);
    tracerCoronaMesh.scale.set(2.9, tracerLength, 2.9);
    tracerCoronaMaterial.uniforms.uOpacity.value = tracerOpacity * 0.2;
  });

  return (
    <group>
      <mesh
        ref={lineMeshRef}
        position={connection.midpoint}
        quaternion={connection.quaternion}
        renderOrder={-20}
      >
        <cylinderGeometry args={[0.012, 0.012, 1, 8, 1, true]} />
        <meshBasicMaterial
          ref={lineMaterialRef}
          color={lineColor}
          transparent
          opacity={lineBaseOpacity}
          depthWrite
          depthTest
          blending={THREE.NormalBlending}
          toneMapped={false}
        />
      </mesh>

      <mesh
        ref={tracerCoronaMeshRef}
        position={connection.midpoint}
        quaternion={connection.quaternion}
        renderOrder={-18}
      >
        <cylinderGeometry args={[0.05, 0.05, 1, 12, 1, true]} />
        <shaderMaterial
          ref={tracerCoronaMaterialRef}
          uniforms={tracerCoronaUniforms}
          vertexShader={TRACER_VERTEX_SHADER}
          fragmentShader={TRACER_FRAGMENT_SHADER}
          transparent
          depthWrite={false}
          depthTest
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>

      <mesh
        ref={tracerCoreMeshRef}
        position={connection.midpoint}
        quaternion={connection.quaternion}
        renderOrder={-17}
      >
        <cylinderGeometry args={[0.05, 0.05, 1, 12, 1, true]} />
        <shaderMaterial
          ref={tracerCoreMaterialRef}
          uniforms={tracerCoreUniforms}
          vertexShader={TRACER_VERTEX_SHADER}
          fragmentShader={TRACER_FRAGMENT_SHADER}
          transparent
          depthWrite={false}
          depthTest
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function SceneContent({
  projects,
  activeProjectId,
  onSelectProject,
  reducedMotion,
  isMobileViewport,
  onReady,
  introUnlocked = true,
}: SceneContentProps) {
  const { gl, scene, camera } = useThree();
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null);
  const [visualActiveProjectId, setVisualActiveProjectId] = useState<
    string | null
  >(activeProjectId);
  const [outgoingHeroProjectId, setOutgoingHeroProjectId] = useState<
    string | null
  >(null);
  const [transitionProgress, setTransitionProgress] = useState(1);
  const [introComplete, setIntroComplete] = useState(
    reducedMotion || activeProjectId !== null
  );
  const [heroWorldsMounted, setHeroWorldsMounted] = useState(
    reducedMotion || activeProjectId !== null || !introUnlocked
  );
  const [fontsReady, setFontsReady] = useState(reducedMotion);

  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const heroCompileGroupRef = useRef<THREE.Group>(null);
  const hasCompiledHeroRef = useRef(false);
  const heroCompileRequestedRef = useRef(false);
  const heroWarmupTargetRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const outgoingHeroProjectIdRef = useRef<string | null>(outgoingHeroProjectId);
  const visualProjectIdRef = useRef<string | null>(activeProjectId);
  const initialRevealRef = useRef(reducedMotion ? 1 : 0);
  const introRevealStartTimeRef = useRef<number | null>(null);
  const heroWorldMountTimeoutRef = useRef<number | null>(null);
  const heroWorldMountIdleRef = useRef<number | null>(null);
  const pendingNeutralSelectionRef = useRef<string | null>(null);
  const warmupFrameCountRef = useRef(0);
  const warmupStartTimeRef = useRef(0);
  const warmupLastProgramCountRef = useRef<number>(-1);
  const warmupProgramStableFramesRef = useRef(0);
  const bootstrapProgressRef = useRef(
    reducedMotion || activeProjectId !== null ? 1 : 0
  );
  const onReadyCalledRef = useRef(false);

  const connections = useMemo(() => buildConnections(projects), [projects]);
  const connectionVisuals = useMemo<ConnectionVisual[]>(
    () =>
      connections.map((connection) => {
        const start = new THREE.Vector3(...connection.points[0]);
        const end = new THREE.Vector3(...connection.points[1]);
        const segment = end.clone().sub(start);
        const length = Math.max(segment.length(), 0.001);
        const direction = segment.clone().normalize();
        const midpoint = start.clone().addScaledVector(segment, 0.5);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(
          WORLD_UP,
          direction
        );

        return {
          ...connection,
          midpoint: [midpoint.x, midpoint.y, midpoint.z],
          quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
          length,
        };
      }),
    [connections]
  );
  const topmostConnectionId = useMemo(() => {
    if (connectionVisuals.length === 0) {
      return null;
    }

    let topmost = connectionVisuals[0];
    let topY = topmost.midpoint[1];

    for (let index = 1; index < connectionVisuals.length; index += 1) {
      const candidate = connectionVisuals[index];
      if (candidate.midpoint[1] > topY) {
        topmost = candidate;
        topY = candidate.midpoint[1];
      }
    }

    return topmost.id;
  }, [connectionVisuals]);
  const focusTracerCoreUniforms = useMemo(
    () => ({
      uColor: { value: FOCUS_TRACER_COLOR.clone() },
      uOpacity: { value: 0 },
      uHeadAtStart: { value: 0 },
      uTailFalloff: { value: 4.9 },
      uTipScale: { value: 0.2 },
    }),
    []
  );
  const focusTracerCoronaUniforms = useMemo(
    () => ({
      uColor: { value: FOCUS_TRACER_CORONA_COLOR.clone() },
      uOpacity: { value: 0 },
      uHeadAtStart: { value: 0 },
      uTailFalloff: { value: 3.2 },
      uTipScale: { value: 0.18 },
    }),
    []
  );
  const focusTraceLineUniforms = useMemo(
    () => ({
      uColor: { value: FOCUS_TRACER_COLOR.clone() },
      uOpacity: { value: 0 },
      uHeadAtStart: { value: 0 },
      uTailFalloff: { value: 3.6 },
      uTipScale: { value: 1 },
    }),
    []
  );

  const activeProject = useMemo(
    () =>
      activeProjectId
        ? projects.find((project) => project.id === activeProjectId) ?? null
        : null,
    [projects, activeProjectId]
  );

  const visualActiveProject = useMemo(() => {
    if (!visualActiveProjectId) {
      return null;
    }

    return (
      projects.find((project) => project.id === visualActiveProjectId) ??
      activeProject
    );
  }, [projects, visualActiveProjectId, activeProject]);

  const outgoingHeroProject = useMemo(
    () =>
      outgoingHeroProjectId
        ? projects.find((project) => project.id === outgoingHeroProjectId) ??
          null
        : null,
    [projects, outgoingHeroProjectId]
  );

  const heroBlend = useMemo(
    () => (reducedMotion ? 1 : smoothstep(0.04, 0.96, transitionProgress)),
    [reducedMotion, transitionProgress]
  );

  const incomingHeroPresence = useMemo(() => {
    if (!visualActiveProjectId) {
      return 0;
    }

    if (reducedMotion) {
      return 1;
    }

    const isInboundTransition = Boolean(
      transitionProgress < 0.999 &&
        !outgoingHeroProjectId &&
        visualActiveProjectId
    );

    if (isInboundTransition) {
      return heroBlend;
    }

    const isFocusSwap = Boolean(
      transitionProgress < 0.999 &&
        outgoingHeroProjectId &&
        visualActiveProjectId &&
        outgoingHeroProjectId !== visualActiveProjectId
    );

    if (isFocusSwap) {
      const transferProgress = clamp01((transitionProgress - 0.02) / 0.48);
      const arrivalLinkedReveal = smoothstep(0.66, 0.94, transferProgress);
      const settle = smoothstep(0.38, 0.66, transitionProgress);
      return Math.max(arrivalLinkedReveal, settle);
    }

    return transitionProgress < 0.999 ? heroBlend : 1;
  }, [
    heroBlend,
    outgoingHeroProjectId,
    reducedMotion,
    transitionProgress,
    visualActiveProjectId,
  ]);

  const outgoingHeroPresence = useMemo(() => {
    if (!outgoingHeroProjectId) {
      return 0;
    }

    if (reducedMotion) {
      return 0;
    }

    const isFocusSwap = Boolean(
      transitionProgress < 0.999 &&
        outgoingHeroProjectId &&
        visualActiveProjectId &&
        outgoingHeroProjectId !== visualActiveProjectId
    );

    if (isFocusSwap) {
      return 1 - smoothstep(0.3, 0.62, transitionProgress);
    }

    return 1 - heroBlend;
  }, [
    heroBlend,
    outgoingHeroProjectId,
    reducedMotion,
    transitionProgress,
    visualActiveProjectId,
  ]);

  const isNeutralToFocusedTransition = useMemo(
    () =>
      Boolean(
        transitionProgress < 0.999 &&
          !outgoingHeroProjectId &&
          visualActiveProjectId
      ),
    [outgoingHeroProjectId, transitionProgress, visualActiveProjectId]
  );

  const isFocusedToNeutralTransition = useMemo(
    () =>
      Boolean(
        transitionProgress < 0.999 &&
          outgoingHeroProjectId &&
          !visualActiveProjectId
      ),
    [outgoingHeroProjectId, transitionProgress, visualActiveProjectId]
  );

  const isFocusToFocusTransition = useMemo(
    () =>
      Boolean(
        transitionProgress < 0.999 &&
          outgoingHeroProjectId &&
          visualActiveProjectId &&
          outgoingHeroProjectId !== visualActiveProjectId
      ),
    [outgoingHeroProjectId, transitionProgress, visualActiveProjectId]
  );

  const lowFiNeutralBlendOverride = useMemo(() => {
    if (reducedMotion) {
      return null;
    }

    if (isNeutralToFocusedTransition) {
      return 1 - smoothstep(0.0, 0.5, transitionProgress);
    }

    if (isFocusedToNeutralTransition) {
      return smoothstep(0.0, 0.5, transitionProgress);
    }

    return null;
  }, [
    isFocusedToNeutralTransition,
    isNeutralToFocusedTransition,
    reducedMotion,
    transitionProgress,
  ]);

  const nodeActiveProjectId = useMemo(() => {
    if (isNeutralToFocusedTransition && transitionProgress < 0.5) {
      return null;
    }

    if (isFocusedToNeutralTransition && transitionProgress < 0.5) {
      return outgoingHeroProjectId;
    }

    return visualActiveProjectId;
  }, [
    isFocusedToNeutralTransition,
    isNeutralToFocusedTransition,
    outgoingHeroProjectId,
    transitionProgress,
    visualActiveProjectId,
  ]);

  const mapVisibility = useMemo(() => {
    if (!visualActiveProjectId) {
      return 0.96;
    }

    if (reducedMotion) {
      return 0.42;
    }

    if (isFocusToFocusTransition) {
      // Keep background nodes at steady focused-state visibility during star->star swaps.
      return 0.36;
    }

    return 0.36 + (1 - smoothstep(0.08, 0.62, transitionProgress)) * 0.48;
  }, [
    isFocusToFocusTransition,
    visualActiveProjectId,
    reducedMotion,
    transitionProgress,
  ]);

  const fogFar = visualActiveProjectId ? 44 : 128;

  const activeConnectionColor = useMemo(() => {
    if (!visualActiveProject) {
      return "#7489a8";
    }

    const color = new THREE.Color(visualActiveProject.color);
    color.offsetHSL(0, -0.08, 0.14);
    return `#${color.getHexString()}`;
  }, [visualActiveProject]);
  const focusSwapLineColor = useMemo(
    () => new THREE.Color(activeConnectionColor),
    [activeConnectionColor]
  );
  const neutralConnectionColor = "#5f7ba1";
  const focusSwapTracePath = useMemo<FocusSwapTracePath | null>(() => {
    if (
      !outgoingHeroProject ||
      !visualActiveProject ||
      outgoingHeroProject.id === visualActiveProject.id
    ) {
      return null;
    }

    const start = new THREE.Vector3(...outgoingHeroProject.coordinates);
    const end = new THREE.Vector3(...visualActiveProject.coordinates);
    const segment = end.clone().sub(start);
    const length = Math.max(segment.length(), 0.001);
    const direction = segment.clone().normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      WORLD_UP,
      direction
    );

    return {
      start,
      direction,
      quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
      length,
    };
  }, [outgoingHeroProject, visualActiveProject]);
  const focusSwapTraceState = useMemo<FocusSwapTraceState | null>(() => {
    if (!focusSwapTracePath || !isFocusToFocusTransition) {
      return null;
    }

    const lineReveal = smoothstep(0.0, 0.42, transitionProgress);
    const transferProgress = clamp01((transitionProgress - 0.02) / 0.48);
    const tracerProgress = smoothstep(0, 1, transferProgress);
    const tracerDistance = THREE.MathUtils.lerp(
      0,
      focusSwapTracePath.length,
      tracerProgress
    );
    const tracerMaxLength = Math.min(
      0.56,
      Math.max(0.2, focusSwapTracePath.length * 0.18)
    );
    const halfMax = tracerMaxLength * 0.5;
    const halfBoundary = Math.max(
      0,
      Math.min(tracerDistance, focusSwapTracePath.length - tracerDistance)
    );
    const tracerHalf = Math.min(halfMax, halfBoundary);
    const tracerLength = Math.max(0.002, tracerHalf * 2);
    const tracerCenter = focusSwapTracePath.start
      .clone()
      .addScaledVector(focusSwapTracePath.direction, tracerDistance);
    const lineRevealDistance = focusSwapTracePath.length * lineReveal;
    const lineHeadDistance = Math.min(
      lineRevealDistance,
      tracerDistance + tracerLength * 0.45 + 0.08
    );
    const lineTrailWindow = Math.min(
      1.9,
      Math.max(0.62, focusSwapTracePath.length * 0.38)
    );
    const lineTailDistance = Math.max(0, lineHeadDistance - lineTrailWindow);
    const renderedLength = Math.max(0.001, lineHeadDistance - lineTailDistance);
    const renderedMidpoint = focusSwapTracePath.start
      .clone()
      .addScaledVector(
        focusSwapTracePath.direction,
        lineTailDistance + renderedLength * 0.5
      );
    const lineFade = 1 - smoothstep(0.66, 0.9, transitionProgress);
    const tracerEnvelope =
      halfMax <= 0 ? 0 : smoothstep(0.0, 0.9, tracerHalf / halfMax);
    const tracerBirth = smoothstep(0.0, 0.08, transitionProgress);
    const tracerSink = 1 - smoothstep(0.9, 1.0, tracerProgress);
    const baseTrailFade = 1 - smoothstep(0.74, 1.0, tracerProgress);

    return {
      renderedMidpoint: [
        renderedMidpoint.x,
        renderedMidpoint.y,
        renderedMidpoint.z,
      ],
      renderedLength,
      tracerCenter: [tracerCenter.x, tracerCenter.y, tracerCenter.z],
      tracerLength,
      baseOpacity: 0.44 * lineFade * baseTrailFade,
      tracerOpacity: 0.98 * tracerEnvelope * tracerBirth * tracerSink,
    };
  }, [focusSwapTracePath, isFocusToFocusTransition, transitionProgress]);
  const introSequenceActive =
    !reducedMotion && !visualActiveProjectId && !introComplete;
  const introRevealActive = introSequenceActive && introUnlocked;
  const heroPrewarmActive =
    !introUnlocked && !reducedMotion && activeProjectId === null;
  const shouldMountHeroWorlds =
    heroWorldsMounted ||
    visualActiveProjectId !== null ||
    outgoingHeroProjectId !== null;

  useEffect(() => {
    if (reducedMotion) {
      setFontsReady(true);
      return;
    }

    const supportsFontLoading = "fonts" in document;

    if (!supportsFontLoading) {
      setFontsReady(true);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      if (!cancelled) {
        setFontsReady(true);
      }
    }, INTRO_FONT_READY_TIMEOUT_MS);

    void document.fonts.ready
      .then(() => {
        if (!cancelled) {
          setFontsReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFontsReady(true);
        }
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [reducedMotion]);

  useFrame(() => {
    if (onReadyCalledRef.current) {
      bootstrapProgressRef.current = 1;
      return;
    }

    if (warmupFrameCountRef.current === 0) {
      warmupStartTimeRef.current = performance.now();
    }

    const elapsedMs = performance.now() - warmupStartTimeRef.current;
    const frameProgress = clamp01(
      warmupFrameCountRef.current / Math.max(1, INTRO_WARMUP_FRAME_COUNT)
    );
    const timeProgress = clamp01(elapsedMs / INTRO_WARMUP_MIN_TIME_MS);
    bootstrapProgressRef.current = Math.min(frameProgress, timeProgress);

    const renderer = gl as THREE.WebGLRenderer;
    const programList = (renderer.info as { programs?: unknown[] }).programs;
    const programCount = Array.isArray(programList) ? programList.length : 0;

    if (programCount === warmupLastProgramCountRef.current) {
      warmupProgramStableFramesRef.current += 1;
    } else {
      warmupProgramStableFramesRef.current = 0;
      warmupLastProgramCountRef.current = programCount;
    }

    warmupFrameCountRef.current += 1;

    const requiresHeroPrewarm = !reducedMotion && activeProjectId === null;
    const heroPrewarmDone = !requiresHeroPrewarm || hasCompiledHeroRef.current;
    const warmupDone =
      warmupFrameCountRef.current >= INTRO_WARMUP_FRAME_COUNT &&
      elapsedMs >= INTRO_WARMUP_MIN_TIME_MS &&
      warmupProgramStableFramesRef.current >=
        INTRO_WARMUP_PROGRAM_STABLE_FRAMES &&
      fontsReady &&
      heroPrewarmDone;

    if (warmupDone) {
      onReadyCalledRef.current = true;
      bootstrapProgressRef.current = 1;
      initialRevealRef.current = 0;
      introRevealStartTimeRef.current = null;
      onReady?.();
    }
  }, -4);

  useFrame(() => {
    if (!introRevealActive || initialRevealRef.current >= 1) {
      return;
    }

    if (introRevealStartTimeRef.current === null) {
      introRevealStartTimeRef.current =
        performance.now() * 0.001 -
        initialRevealRef.current * INTRO_REVEAL_DURATION_S;
    }

    const elapsed = Math.max(
      0,
      performance.now() * 0.001 - introRevealStartTimeRef.current
    );
    const next = clamp01(elapsed / INTRO_REVEAL_DURATION_S);
    initialRevealRef.current = next;

    if (next >= 1 && !introComplete) {
      startTransition(() => {
        setIntroComplete(true);
      });
    }
  }, -2);

  useEffect(() => {
    const previousVisualId = visualProjectIdRef.current;

    if (previousVisualId === activeProjectId) {
      return;
    }

    if (reducedMotion) {
      setOutgoingHeroProjectId(null);
      setVisualActiveProjectId(activeProjectId);
      setTransitionProgress(1);
      visualProjectIdRef.current = activeProjectId;
      return;
    }

    setOutgoingHeroProjectId(previousVisualId);
    setVisualActiveProjectId(activeProjectId);
    setTransitionProgress(0);
    visualProjectIdRef.current = activeProjectId;
  }, [activeProjectId, reducedMotion]);

  useEffect(() => {
    outgoingHeroProjectIdRef.current = outgoingHeroProjectId;
  }, [outgoingHeroProjectId]);

  useEffect(() => {
    if (reducedMotion || visualActiveProjectId) {
      bootstrapProgressRef.current = 1;
      initialRevealRef.current = 1;
      introRevealStartTimeRef.current = null;
      setIntroComplete(true);
      if (!onReadyCalledRef.current) {
        onReadyCalledRef.current = true;
        onReady?.();
      }
    }
  }, [onReady, reducedMotion, visualActiveProjectId]);

  useEffect(() => {
    if (!introRevealActive || initialRevealRef.current >= 1) {
      introRevealStartTimeRef.current = null;
      return;
    }

    introRevealStartTimeRef.current =
      performance.now() * 0.001 -
      initialRevealRef.current * INTRO_REVEAL_DURATION_S;
  }, [introRevealActive]);

  useEffect(() => {
    const clearPendingMount = () => {
      if (heroWorldMountTimeoutRef.current !== null) {
        window.clearTimeout(heroWorldMountTimeoutRef.current);
        heroWorldMountTimeoutRef.current = null;
      }

      if (heroWorldMountIdleRef.current !== null) {
        if ("cancelIdleCallback" in window) {
          window.cancelIdleCallback(heroWorldMountIdleRef.current);
        }
        heroWorldMountIdleRef.current = null;
      }
    };

    const mustMountImmediately =
      reducedMotion ||
      visualActiveProjectId !== null ||
      outgoingHeroProjectId !== null;

    if (mustMountImmediately) {
      clearPendingMount();
      if (!heroWorldsMounted) {
        setHeroWorldsMounted(true);
      }
      return clearPendingMount;
    }

    if (!introComplete || heroWorldsMounted) {
      clearPendingMount();
      return clearPendingMount;
    }

    heroWorldMountTimeoutRef.current = window.setTimeout(() => {
      const mountHeroWorlds = () => {
        heroWorldMountIdleRef.current = null;
        startTransition(() => {
          setHeroWorldsMounted(true);
        });
      };

      if ("requestIdleCallback" in window) {
        heroWorldMountIdleRef.current = window.requestIdleCallback(
          mountHeroWorlds,
          {
            timeout: HERO_WORLD_MOUNT_IDLE_TIMEOUT_MS,
          }
        );
        return;
      }

      mountHeroWorlds();
    }, HERO_WORLD_MOUNT_DELAY_MS);

    return clearPendingMount;
  }, [
    heroWorldsMounted,
    introComplete,
    outgoingHeroProjectId,
    reducedMotion,
    visualActiveProjectId,
  ]);

  const handleTransitionProgress = useCallback(
    (progress: number) => {
      const isNeutralIntroProgress =
        progress > 0 &&
        progress < 1 &&
        visualProjectIdRef.current === null &&
        outgoingHeroProjectIdRef.current === null;

      if (isNeutralIntroProgress) {
        return;
      }

      startTransition(() => {
        setTransitionProgress((previous) => {
          if (progress === 0 || progress === 1) {
            return progress;
          }

          return Math.abs(previous - progress) > (reducedMotion ? 0.05 : 0.01)
            ? progress
            : previous;
        });

        if (progress >= 1) {
          setOutgoingHeroProjectId(null);
        }
      });
    },
    [reducedMotion]
  );

  const handleNodeSelect = useCallback(
    (projectId: string | null) => {
      setHoveredProjectId(null);

      if (
        projectId &&
        activeProjectId === null &&
        !reducedMotion &&
        !hasCompiledHeroRef.current
      ) {
        setHeroWorldsMounted(true);
        pendingNeutralSelectionRef.current = projectId;
        return;
      }

      onSelectProject(projectId);
    },
    [activeProjectId, onSelectProject, reducedMotion]
  );

  useEffect(() => {
    setHoveredProjectId(null);
  }, [activeProjectId]);

  useEffect(
    () => () => {
      if (heroWorldMountTimeoutRef.current !== null) {
        window.clearTimeout(heroWorldMountTimeoutRef.current);
        heroWorldMountTimeoutRef.current = null;
      }
      if (
        heroWorldMountIdleRef.current !== null &&
        "cancelIdleCallback" in window
      ) {
        window.cancelIdleCallback(heroWorldMountIdleRef.current);
        heroWorldMountIdleRef.current = null;
      }
      heroWarmupTargetRef.current?.dispose();
      heroWarmupTargetRef.current = null;
    },
    []
  );

  useFrame(() => {
    if (hasCompiledHeroRef.current || heroCompileRequestedRef.current) {
      return;
    }

    const heroCompileGroup = heroCompileGroupRef.current;

    if (!heroCompileGroup) {
      return;
    }

    const canPrecompile =
      reducedMotion ||
      !introUnlocked ||
      introComplete ||
      (visualActiveProjectId !== null && transitionProgress >= 1);

    if (!canPrecompile) {
      return;
    }

    const hasPendingSelection = Boolean(pendingNeutralSelectionRef.current);
    const shouldWaitForIdle =
      introUnlocked && introComplete && !hasPendingSelection;

    heroCompileRequestedRef.current = true;
    const renderer = gl as THREE.WebGLRenderer;
    const visibilityStates: Array<[THREE.Object3D, boolean]> = [];
    heroCompileGroup.traverse((object) => {
      visibilityStates.push([object, object.visible]);
      object.visible = true;
    });
    const restoreVisibility = () => {
      visibilityStates.forEach(([object, wasVisible]) => {
        object.visible = wasVisible;
      });
    };
    const flushPendingSelection = () => {
      const pendingSelection = pendingNeutralSelectionRef.current;
      if (!pendingSelection) {
        return;
      }
      pendingNeutralSelectionRef.current = null;
      onSelectProject(pendingSelection);
    };
    const renderWarmupFrame = () => {
      let warmupTarget = heroWarmupTargetRef.current;

      if (!warmupTarget) {
        warmupTarget = new THREE.WebGLRenderTarget(2, 2, {
          depthBuffer: true,
          stencilBuffer: true,
        });
        heroWarmupTargetRef.current = warmupTarget;
      }

      const previousTarget = renderer.getRenderTarget();
      const previousAutoClear = renderer.autoClear;
      const previousShadowAutoUpdate = renderer.shadowMap.autoUpdate;
      const previousXrEnabled = renderer.xr.enabled;

      try {
        renderer.xr.enabled = false;
        renderer.autoClear = true;
        renderer.shadowMap.autoUpdate = false;
        renderer.setRenderTarget(warmupTarget);
        renderer.clear(true, true, true);
        renderer.render(scene, camera);
      } finally {
        renderer.setRenderTarget(previousTarget);
        renderer.autoClear = previousAutoClear;
        renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
        renderer.xr.enabled = previousXrEnabled;
      }
    };

    void (async () => {
      try {
        if (shouldWaitForIdle) {
          await new Promise<void>((resolve) => {
            let settled = false;

            const finish = () => {
              if (settled) {
                return;
              }

              settled = true;
              resolve();
            };

            const timeoutId = window.setTimeout(
              finish,
              HERO_PRECOMPILE_IDLE_TIMEOUT_MS
            );

            if ("requestIdleCallback" in window) {
              window.requestIdleCallback(
                () => {
                  window.clearTimeout(timeoutId);
                  finish();
                },
                { timeout: HERO_PRECOMPILE_IDLE_TIMEOUT_MS }
              );
            }
          });
        }

        if (typeof renderer.compileAsync === "function") {
          await renderer.compileAsync(heroCompileGroup, camera, scene);
        } else {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 0);
          });
          renderer.compile(heroCompileGroup, camera, scene);
        }
        renderWarmupFrame();
      } catch {
        // Fallback to sync compile so first focus transition is never the first shader compile.
        try {
          renderer.compile(heroCompileGroup, camera, scene);
          renderWarmupFrame();
        } catch {
          // If fallback compile also fails, runtime compile remains the final safety net.
        }
      } finally {
        restoreVisibility();
        hasCompiledHeroRef.current = true;
        flushPendingSelection();
      }
    })();
  }, -3);

  return (
    <>
      <color attach="background" args={["#070708"]} />
      {ENABLE_SCENE_FOG && <fog attach="fog" args={["#070708", 10, fogFar]} />}

      <CinematicLights
        project={visualActiveProject}
        reducedMotion={reducedMotion}
      />

      {connectionVisuals.map((connection, connectionIndex) => {
        const showAllConnections = !visualActiveProjectId && !hoveredProjectId;
        const linkedToActive =
          Boolean(visualActiveProjectId) &&
          (connection.projects[0] === visualActiveProjectId ||
            connection.projects[1] === visualActiveProjectId);
        const linkedToHover =
          Boolean(hoveredProjectId) &&
          (connection.projects[0] === hoveredProjectId ||
            connection.projects[1] === hoveredProjectId);
        const focusedHoverConnection = Boolean(
          visualActiveProjectId &&
            hoveredProjectId &&
            linkedToActive &&
            linkedToHover
        );
        const linkedToSelection =
          visualActiveProjectId === null
            ? showAllConnections || linkedToHover
            : focusedHoverConnection;

        if (!linkedToSelection) {
          return null;
        }

        return (
          <IntroConnectionSegment
            key={connection.id}
            connection={connection}
            connectionIndex={connectionIndex}
            lineColor={
              visualActiveProjectId
                ? activeConnectionColor
                : neutralConnectionColor
            }
            lineBaseOpacity={visualActiveProjectId ? mapVisibility * 0.52 : 1}
            introSequenceActive={introSequenceActive}
            introRevealActive={introRevealActive}
            introRevealProgressRef={initialRevealRef}
            reverseTracer={
              introSequenceActive && connection.id === topmostConnectionId
            }
          />
        );
      })}

      {focusSwapTracePath && focusSwapTraceState && (
        <group
          key={`focus-trace-${outgoingHeroProjectId ?? "none"}-${
            visualActiveProjectId ?? "none"
          }`}
        >
          {focusSwapTraceState.baseOpacity > 0.003 && (
            <mesh
              position={focusSwapTraceState.renderedMidpoint}
              quaternion={focusSwapTracePath.quaternion}
              renderOrder={-19}
            >
              <cylinderGeometry
                args={[
                  0.014,
                  0.014,
                  focusSwapTraceState.renderedLength,
                  10,
                  1,
                  true,
                ]}
              />
              <shaderMaterial
                uniforms={focusTraceLineUniforms}
                uniforms-uColor-value={focusSwapLineColor}
                uniforms-uOpacity-value={focusSwapTraceState.baseOpacity}
                vertexShader={TRACER_VERTEX_SHADER}
                fragmentShader={TRACER_FRAGMENT_SHADER}
                transparent
                depthWrite={false}
                depthTest
                blending={THREE.NormalBlending}
                toneMapped={false}
              />
            </mesh>
          )}

          {focusSwapTraceState.tracerOpacity > 0.003 && (
            <>
              <mesh
                position={focusSwapTraceState.tracerCenter}
                quaternion={focusSwapTracePath.quaternion}
                scale={[2.9, 1, 2.9]}
                renderOrder={-18}
              >
                <cylinderGeometry
                  args={[
                    0.05,
                    0.05,
                    focusSwapTraceState.tracerLength,
                    12,
                    1,
                    true,
                  ]}
                />
                <shaderMaterial
                  uniforms={focusTracerCoronaUniforms}
                  uniforms-uOpacity-value={
                    focusSwapTraceState.tracerOpacity * 0.2
                  }
                  vertexShader={TRACER_VERTEX_SHADER}
                  fragmentShader={TRACER_FRAGMENT_SHADER}
                  transparent
                  depthWrite={false}
                  depthTest
                  blending={THREE.AdditiveBlending}
                  toneMapped={false}
                />
              </mesh>

              <mesh
                position={focusSwapTraceState.tracerCenter}
                quaternion={focusSwapTracePath.quaternion}
                renderOrder={-17}
              >
                <cylinderGeometry
                  args={[
                    0.05,
                    0.05,
                    focusSwapTraceState.tracerLength,
                    12,
                    1,
                    true,
                  ]}
                />
                <shaderMaterial
                  uniforms={focusTracerCoreUniforms}
                  uniforms-uOpacity-value={focusSwapTraceState.tracerOpacity}
                  vertexShader={TRACER_VERTEX_SHADER}
                  fragmentShader={TRACER_FRAGMENT_SHADER}
                  transparent
                  depthWrite={false}
                  depthTest
                  blending={THREE.AdditiveBlending}
                  toneMapped={false}
                />
              </mesh>
            </>
          )}
        </group>
      )}

      {projects.map((project, projectIndex) => {
        const suppressOutgoingLowFiNode =
          isFocusToFocusTransition &&
          outgoingHeroProjectId !== null &&
          project.id === outgoingHeroProjectId;
        const isNodeActive =
          project.id === nodeActiveProjectId || suppressOutgoingLowFiNode;

        return (
          <ProjectNode
            key={project.id}
            project={project}
            isActive={isNodeActive}
            isHovered={project.id === hoveredProjectId}
            mapVisibility={mapVisibility}
            nodeDisplayMode={!visualActiveProjectId ? "neutral" : "background"}
            neutralBlendOverride={lowFiNeutralBlendOverride}
            introRevealRef={initialRevealRef}
            introRevealOffset={0.38 + projectIndex * 0.13}
            reducedMotion={reducedMotion}
            onHover={setHoveredProjectId}
            onSelect={handleNodeSelect}
          />
        );
      })}

      {shouldMountHeroWorlds && (
        <group ref={heroCompileGroupRef}>
          {projects.map((project) => {
            const isOutgoing =
              outgoingHeroProjectId === project.id &&
              visualActiveProjectId !== project.id;
            const isIncoming = visualActiveProjectId === project.id;
            const presenceTarget = Math.max(
              isOutgoing ? outgoingHeroPresence : 0,
              isIncoming ? incomingHeroPresence : 0
            );

            return (
              <HeroWorld
                key={`hero-${project.id}`}
                project={project}
                reducedMotion={reducedMotion}
                isMobileViewport={isMobileViewport}
                presenceTarget={presenceTarget}
                collapseParticlesOnFadeOut={isOutgoing}
                prewarmActive={heroPrewarmActive}
              />
            );
          })}
        </group>
      )}

      <mesh
        renderOrder={-15}
        frustumCulled={false}
        onAfterRender={(renderer: THREE.WebGLRenderer) => {
          renderer.clearDepth();
        }}
      >
        <planeGeometry args={[0.001, 0.001]} />
        <meshBasicMaterial
          colorWrite={false}
          depthWrite={false}
          depthTest={false}
          toneMapped={false}
        />
      </mesh>

      <NeutralStarField
        reducedMotion={reducedMotion}
        isMobileViewport={isMobileViewport}
        bootstrapProgressRef={bootstrapProgressRef}
      />

      <OrbitControls
        ref={controlsRef}
        enablePan={false}
        enableZoom
        enableRotate
        enableDamping
        dampingFactor={isMobileViewport ? 0.11 : 0.09}
        rotateSpeed={isMobileViewport ? 0.44 : 0.52}
        zoomSpeed={isMobileViewport ? 0.52 : 0.62}
        minDistance={2.6}
        maxDistance={14}
        minPolarAngle={0.42}
        maxPolarAngle={2.5}
        autoRotate={false}
      />

      <CameraRig
        projects={projects}
        activeProject={activeProject}
        controlsRef={controlsRef}
        reducedMotion={reducedMotion}
        isMobileViewport={isMobileViewport}
        introUnlocked={introUnlocked}
        onTransitionProgress={handleTransitionProgress}
      />

      <CinematicBloom
        project={visualActiveProject}
        reducedMotion={reducedMotion}
        isMobileViewport={isMobileViewport}
      />
    </>
  );
}

export function ConstellationScene(props: ConstellationSceneProps) {
  const isMobileViewport = useMobileViewport();
  const dpr: [number, number] = isMobileViewport ? [1.2, 1.9] : [1, 2];
  const toneMappingExposure = isMobileViewport
    ? SCENE_EXPOSURE * 1.08
    : SCENE_EXPOSURE;

  return (
    <Canvas
      className="constellation-canvas"
      style={{ position: "absolute", inset: 0 }}
      camera={{ position: [0, 1.8, 8.4], fov: 54, near: 0.1, far: 150 }}
      dpr={dpr}
      gl={{
        antialias: true,
        alpha: false,
        stencil: true,
        powerPreference: "high-performance",
      }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = toneMappingExposure;
      }}
      fallback={<div className="canvas-fallback">WebGL unavailable.</div>}
    >
      <SceneContent {...props} isMobileViewport={isMobileViewport} />
    </Canvas>
  );
}
