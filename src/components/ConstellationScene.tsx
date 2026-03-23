import { Html, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import * as THREE from 'three'
import {
  EffectComposer,
  FilmPass,
  RGBShiftShader,
  RenderPass,
  ShaderPass,
  UnrealBloomPass,
  VignetteShader,
} from 'three-stdlib'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

import type { Project } from '../data/projects'

type Vector3 = [number, number, number]

type ConstellationSceneProps = {
  projects: Project[]
  activeProjectId: string | null
  onSelectProject: (projectId: string | null) => void
  reducedMotion: boolean
}

type Connection = {
  id: string
  points: [Vector3, Vector3]
  projects: [string, string]
}

type ConnectionVisual = Connection & {
  midpoint: Vector3
  quaternion: [number, number, number, number]
  length: number
}

type FocusSwapTracePath = {
  start: THREE.Vector3
  direction: THREE.Vector3
  quaternion: [number, number, number, number]
  length: number
}

type FocusSwapTraceState = {
  renderedMidpoint: Vector3
  renderedLength: number
  tracerCenter: Vector3
  tracerLength: number
  baseOpacity: number
  tracerOpacity: number
}

type ProjectNodeProps = {
  project: Project
  isActive: boolean
  isHovered: boolean
  mapVisibility: number
  nodeDisplayMode: 'neutral' | 'background'
  neutralBlendOverride: number | null
  introReveal: number
  reducedMotion: boolean
  onHover: (projectId: string | null) => void
  onSelect: (projectId: string | null) => void
}

type CameraRigProps = {
  projects: Project[]
  activeProject: Project | null
  controlsRef: RefObject<OrbitControlsImpl | null>
  reducedMotion: boolean
  onTransitionHalfway?: () => void
  onTransitionProgress?: (progress: number) => void
}

type HeroKind = 'storm' | 'harmonic' | 'pulse'

type HeroStyle = {
  kind: HeroKind
  accent: string
  secondary: string
  swarmCount: number
  swarmSize: number
  shellScale: number
}

type HeroParticleField = {
  profile: 'stream' | 'dust'
  positions: Float32Array
  velocities: Float32Array
  basePositions: Float32Array
  speeds: Float32Array
  phases: Float32Array
  radii: Float32Array
  bands: Float32Array
  lifts: Float32Array
  sizes: Float32Array
  flickers: Float32Array
  count: number
}

type EtherealFilamentConfig = {
  filamentCount: number
  trailLength: number
  orbitStrength: number
  windStrength: number
  drag: number
  shellDistance: number
  filamentWidth: number
  emissionIntensity: number
  noiseSpeed: number
  radialDrift: number
  containment: number
  crossSectionSegments: number
}

type CoreDustProfile = {
  radiusScale: number
  density: number
  detail: number
  noiseScale: number
  noiseSpeed: number
  opacity: number
  windTempo: number
  feather: number
  stepCount: number
  phaseOffset: number
}

type EtherealFilamentField = {
  config: EtherealFilamentConfig
  ringCount: number
  phases: Float32Array
  orbitScales: Float32Array
  radii: Float32Array
  widthScales: Float32Array
  axisVectors: Float32Array
  headPositions: Float32Array
  headVelocities: Float32Array
  history: Float32Array
  geometry: THREE.BufferGeometry
  positionAttribute: THREE.BufferAttribute
}

type WireTraceGraph = {
  nodes: THREE.Vector3[]
  adjacency: number[][]
}

type NeutralStarInstances = {
  positions: Float32Array
  scales: Float32Array
  count: number
}

type HeroWorldProps = {
  project: Project
  reducedMotion: boolean
  presenceTarget: number
  collapseParticlesOnFadeOut: boolean
}

type CinematicBloomProps = {
  project: Project | null
  reducedMotion: boolean
}

const CONNECTION_DISTANCE = 6.2
const WORLD_UP = new THREE.Vector3(0, 1, 0)
const X_AXIS = new THREE.Vector3(1, 0, 0)
const WHITE = new THREE.Color('#ffffff')
const CORE_VERTEX_SHADER = `
varying vec3 vNormal;
varying vec3 vWorldPos;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPosition.xyz;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

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
  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.4);
  float wave = sin(vWorldPos.x * 3.1 + uTime * 1.35) *
               sin(vWorldPos.y * 2.8 - uTime * 1.22) *
               sin(vWorldPos.z * 3.3 + uTime * 1.15);

  float pulse = 0.58 + sin(uTime * 2.1) * 0.14 + wave * 0.12;
  vec3 color = uColor * (0.46 + pulse * 0.44 + fresnel * (0.22 + uEnergy * 0.62));
  float alpha = clamp((0.12 + fresnel * 0.36) * uIntensity, 0.0, 1.0);

  gl_FragColor = vec4(color, alpha);
}
`

const CORE_DUST_VERTEX_SHADER = `
varying vec3 vLocalPos;
varying vec3 vWorldPos;

void main() {
  vLocalPos = position;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPosition.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

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
  float shellMask = smoothstep(feather * radius, -0.34 * radius, boundary);
  float nearShell = smoothstep(-0.44 * radius, -0.01 * radius, boundary);
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

  vec3 flow = q * noiseScale;
  flow += windPrimary * (t * (0.045 + jetCore * 0.085));
  flow -= windSecondary * (t * 0.04);
  flow += shearDir * (t * 0.24) * nearShell;
  flow += shearDir * dot(q, shearDir) * nearShell * 0.58;

  float warp = fbm3Low(flow * 1.25 + vec3(5.1, 2.3, 1.7)) - 0.5;
  flow += windSecondary * warp * (0.9 + detailGain * 0.28);
  flow += vec3(
    sin((q.y + warp) * 2.1 + t * 0.04),
    sin((q.z - warp) * 1.9 - t * 0.03),
    sin((q.x + warp) * 2.0 + t * 0.028)
  ) * 0.18;

  float base = fbm3(flow * 1.12 + vec3(0.0, t * 0.03, 0.0));
  float detail = fbm3Low(flow * 2.35 + vec3(6.8, 3.3, 4.2));
  float erosion = fbm3Low(flow * 4.0 + vec3(12.1, 9.7, 5.6));

  float cloud = mix(base, detail, 0.38 + detailGain * 0.14) - erosion * (0.24 + detailGain * 0.14);
  cloud = smoothstep(0.24, 0.82, cloud);
  cloud = pow(cloud, 1.1);

  float radial = 1.0 - smoothstep(0.72, 1.14, length(q));
  float packed = smoothstep(-0.26, 0.94, dot(q, windPrimary));
  float wisp = 0.72 + 0.28 * sin(t * 0.32 + q.x * 3.2 + q.z * 2.8 + q.y * 2.1);
  float faceBand = exp(-abs(boundary) / max(radius * 0.14, 0.0001));
  float faceStreak = 0.5 + 0.5 * sin(dot(q, shearDir) * 13.0 + dot(q, faceDir) * 8.0 + t * 0.24);
  float ridge = smoothstep(0.2, 0.62, abs(base - detail));
  float jetPulse = smoothstep(0.18, 0.92, 0.5 + 0.5 * sin(alongWind * 11.0 - t * 0.46 + warp * 3.4));
  float jet = jetCore * jetPulse;
  float jetEdge = smoothstep(0.12, 0.46, jetCore) * (1.0 - smoothstep(0.46, 0.82, jetCore));

  float density = cloud * radial * shellMask * wisp;
  density *= mix(0.7, 1.22, packed);
  density *= 0.9 + ridge * 0.55;
  density *= 1.0 + nearShell * (0.18 + packed * 0.34);
  density += cloud * nearShell * 0.08;
  density += faceBand * faceStreak * (0.08 + nearShell * 0.12);
  density += shellMask * (0.04 + nearShell * 0.08) * (0.4 + detail * 0.56);
  density *= 1.0 - jet * 0.32;
  density += jetEdge * 0.08 * (0.45 + ridge * 0.55);
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
  float shellMask = smoothstep(feather * radius, -0.3 * radius, boundary);
  if (shellMask <= 0.0001) {
    return 0.0;
  }

  vec3 q = p / max(radius, 0.0001);
  vec3 flow = q * (noiseScale * 0.92) + windPrimary * (t * 0.05);
  float n = fbm3Low(flow * 1.55 + vec3(4.7, 1.9, 3.1));
  return smoothstep(0.34, 0.82, n) * shellMask;
}

void main() {
  float radius = max(uRadius, 0.0001);
  vec3 ro = uCameraLocal;
  vec3 rd = normalize(vLocalPos - ro);
  vec3 lightDir = normalize(uLightDirLocal);
  vec3 windPrimary = normalize(uWindPrimary);
  vec3 windSecondary = normalize(uWindSecondary);
  float t = uTime * uNoiseSpeed;

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
    if (density < 0.00008) {
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
    sampleAlpha = min(sampleAlpha, 0.075);
    accumulated += (ambient + direct + innerGlow) * sampleAlpha;
    transmittance *= exp(-sigmaT * stepLen);
    travel += stepLen;
  }

  float alpha = (1.0 - transmittance) * uOpacity * (0.84 + uIntensity * 0.22);
  vec3 color = accumulated * (0.78 + uIntensity * 0.2);

  if (alpha < 0.0006 && length(color) < 0.0006) {
    discard;
  }

  gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.58));
}
`

const SHELL_VERTEX_SHADER = `
varying vec3 vNormal;
varying vec3 vWorldPos;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPosition.xyz;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

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
  float edge = pow(fresnel, 1.8);
  float flow = 0.5 + 0.5 * sin((vWorldPos.y * 6.2 + vWorldPos.x * 2.1) + uTime * 0.58);
  float shell = 0.72 + flow * 0.28;

  vec3 color = uColor * (0.72 + flow * 0.22 + edge * 0.16) * (1.0 + uIntensity * 0.16);
  float alpha = clamp((0.28 + flow * 0.2 + edge * 0.2) * uIntensity, 0.0, 0.9);
  gl_FragColor = vec4(color, alpha);
}
`

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
`

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
`

const STREAM_SWARM_VERTEX_SHADER = `
attribute float aSize;
attribute float aFlicker;

uniform float uTime;
uniform float uBaseSize;
uniform float uIntensity;

varying float vPulse;
varying float vFlicker;

void main() {
  vFlicker = aFlicker;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float pulse = sin(uTime * (0.9 + aFlicker * 1.9) + aFlicker * 21.0) * 0.5 + 0.5;
  vPulse = pulse;
  gl_PointSize = (uBaseSize * aSize * (0.75 + pulse * 0.5) * (0.25 + uIntensity * 0.75)) / max(0.08, -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
}
`

const STREAM_SWARM_FRAGMENT_SHADER = `
uniform vec3 uColor;
uniform float uOpacity;

varying float vPulse;
varying float vFlicker;

void main() {
  vec2 centered = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(centered, centered);

  if (r2 > 1.0) {
    discard;
  }

  float core = exp(-r2 * 7.5);
  float halo = exp(-r2 * 2.8);
  float sparkle = 0.9 + sin(vFlicker * 41.0 + r2 * 8.0) * 0.1;
  float alpha = (core * 0.72 + halo * 0.28) * (0.72 + vPulse * 0.28) * sparkle * uOpacity;
  vec3 color = uColor * (0.78 + vPulse * 0.22 + (1.0 - r2) * 0.22);
  gl_FragColor = vec4(color, alpha);
}
`

const NEBULA_VERTEX_SHADER = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

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
`

function getHash(seed: string): number {
  let hash = 0

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(index)
    hash |= 0
  }

  return Math.abs(hash)
}

function createRandom(seed: number) {
  let state = seed

  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function createNeutralStarInstances(
  seed: string,
  count: number,
  radius: number,
  depthSpread: number,
  sizeRange: [number, number],
): NeutralStarInstances {
  const random = createRandom(getHash(seed) + count * 13)
  const positions = new Float32Array(count * 3)
  const scales = new Float32Array(count)

  for (let index = 0; index < count; index += 1) {
    const offset = index * 3
    const u = random()
    const v = random()
    const theta = u * Math.PI * 2
    const phi = Math.acos(2 * v - 1)
    const shellRadius = radius + (random() - 0.5) * depthSpread
    const sinPhi = Math.sin(phi)

    positions[offset] = shellRadius * sinPhi * Math.cos(theta)
    positions[offset + 1] = shellRadius * Math.cos(phi)
    positions[offset + 2] = shellRadius * sinPhi * Math.sin(theta)

    const [minScale, maxScale] = sizeRange
    const sparkle = random()

    const scaleBase = minScale + random() * (maxScale - minScale)

    if (sparkle > 0.985) {
      scales[index] = scaleBase * (1.38 + random() * 0.58)
    } else {
      scales[index] = scaleBase
    }
  }

  return {
    positions,
    scales,
    count,
  }
}

function clamp01(value: number) {
  return THREE.MathUtils.clamp(value, 0, 1)
}

function smoothstep(edge0: number, edge1: number, value: number) {
  if (edge0 === edge1) {
    return value < edge0 ? 0 : 1
  }

  const normalized = clamp01((value - edge0) / (edge1 - edge0))
  return normalized * normalized * (3 - 2 * normalized)
}

function easeInOutCubic(value: number) {
  return value < 0.5 ? 4 * value * value * value : 1 - ((-2 * value + 2) ** 3) / 2
}

function easeInOutSine(value: number) {
  return -(Math.cos(Math.PI * value) - 1) / 2
}

function buildConnections(projects: Project[]): Connection[] {
  const connections: Connection[] = []

  projects.forEach((project, index) => {
    projects.slice(index + 1).forEach((neighbor) => {
      const [ax, ay, az] = project.coordinates
      const [bx, by, bz] = neighbor.coordinates
      const distance = Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2)

      if (distance <= CONNECTION_DISTANCE) {
        connections.push({
          id: `${project.id}-${neighbor.id}`,
          points: [project.coordinates, neighbor.coordinates],
          projects: [project.id, neighbor.id],
        })
      }
    })
  })

  return connections
}

function getHeroStyle(project: Project): HeroStyle {
  const accent = new THREE.Color(project.color)
  const hsl = { h: 0, s: 0, l: 0 }
  accent.getHSL(hsl)

  const secondary = new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 0.88), Math.max(0.15, hsl.l * 0.42))

  if (project.id === 'gpgpu-particles') {
    return {
      kind: 'storm',
      accent: `#${accent.getHexString()}`,
      secondary: `#${secondary.getHexString()}`,
      swarmCount: 920,
      swarmSize: 32,
      shellScale: 0.78,
    }
  }

  if (project.id === 'voyce') {
    return {
      kind: 'harmonic',
      accent: `#${accent.getHexString()}`,
      secondary: `#${secondary.getHexString()}`,
      swarmCount: 840,
      swarmSize: 30,
      shellScale: 0.83,
    }
  }

  return {
    kind: 'pulse',
    accent: `#${accent.getHexString()}`,
    secondary: `#${secondary.getHexString()}`,
    swarmCount: 880,
    swarmSize: 34,
    shellScale: 0.8,
  }
}

function HeroCoreGeometry({ kind }: { kind: HeroKind }) {
  if (kind === 'harmonic') {
    return <torusKnotGeometry args={[0.31, 0.11, 180, 28, 2, 3]} />
  }

  if (kind === 'pulse') {
    return <octahedronGeometry args={[0.56, 0]} />
  }

  return <icosahedronGeometry args={[0.52, 0]} />
}

const ETHEREAL_FILAMENT_PRESETS: Record<HeroKind, EtherealFilamentConfig> = {
  storm: {
    filamentCount: 6,
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
    filamentCount: 6,
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
    filamentCount: 6,
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
}

const CORE_DUST_PRESETS: Record<HeroKind, CoreDustProfile> = {
  storm: {
    radiusScale: 1.08,
    density: 3.4,
    detail: 0.92,
    noiseScale: 1.78,
    noiseSpeed: 0.05,
    opacity: 0.74,
    windTempo: 0.02,
    feather: 0.2,
    stepCount: 44,
    phaseOffset: 0.45,
  },
  harmonic: {
    radiusScale: 1.02,
    density: 3.1,
    detail: 0.82,
    noiseScale: 1.66,
    noiseSpeed: 0.045,
    opacity: 0.68,
    windTempo: 0.018,
    feather: 0.22,
    stepCount: 40,
    phaseOffset: 1.05,
  },
  pulse: {
    radiusScale: 1.04,
    density: 3.25,
    detail: 0.88,
    noiseScale: 1.7,
    noiseSpeed: 0.048,
    opacity: 0.72,
    windTempo: 0.019,
    feather: 0.21,
    stepCount: 42,
    phaseOffset: 1.6,
  },
}

function createParticleField(style: HeroStyle, seed: string, profile: 'stream' | 'dust'): HeroParticleField {
  const profileScale =
    profile === 'stream'
      ? style.kind === 'harmonic'
        ? 0.24
        : 0.27
      : style.kind === 'storm'
        ? 0.22
        : 0.2
  const count =
    profile === 'stream'
      ? Math.max(170, Math.round(style.swarmCount * profileScale))
      : Math.max(56, Math.round(style.swarmCount * profileScale * 0.4))
  const positions = new Float32Array(count * 3)
  const velocities = new Float32Array(count * 3)
  const basePositions = new Float32Array(count * 3)
  const speeds = new Float32Array(count)
  const phases = new Float32Array(count)
  const radii = new Float32Array(count)
  const bands = new Float32Array(count)
  const lifts = new Float32Array(count)
  const sizes = new Float32Array(count)
  const flickers = new Float32Array(count)
  const random = createRandom(getHash(seed) + count + (profile === 'stream' ? 77 : 131))
  const strandCount = style.kind === 'storm' ? 18 : style.kind === 'harmonic' ? 16 : 14

  for (let index = 0; index < count; index += 1) {
    const offset = index * 3
    const angle = random() * Math.PI * 2

    phases[index] = random() * Math.PI * 2
    speeds[index] = profile === 'stream' ? 0.74 + random() * 1.16 : 0.18 + random() * 0.48
    flickers[index] = random()
    bands[index] = (index % strandCount) / strandCount
    lifts[index] = random() * 2 - 1

    if (profile === 'stream') {
      const bandPhase = bands[index] * Math.PI * 2
      const streamRadius =
        style.kind === 'storm' ? 1.2 + random() * 1.2 : style.kind === 'harmonic' ? 1.0 + random() * 1.0 : 1.1 + random() * 1.1
      const streamLift = (random() - 0.5) * (style.kind === 'harmonic' ? 1.4 : 0.9)

      basePositions[offset] = Math.cos(bandPhase) * streamRadius
      basePositions[offset + 1] = streamLift
      basePositions[offset + 2] = Math.sin(bandPhase) * streamRadius

      radii[index] = streamRadius
      sizes[index] = 0.8 + random() * 1.36
    } else {
      const phi = Math.acos(1 - 2 * random())
      const spread = style.kind === 'harmonic' ? 0.6 + Math.pow(random(), 1.25) * 1.8 : 0.7 + Math.pow(random(), 1.2) * 2.1

      basePositions[offset] = Math.sin(phi) * Math.cos(angle) * spread
      basePositions[offset + 1] = Math.cos(phi) * spread * (style.kind === 'harmonic' ? 1.35 : 1.0)
      basePositions[offset + 2] = Math.sin(phi) * Math.sin(angle) * spread

      radii[index] = spread
      sizes[index] = 1.0 + random() * 1.45
    }
  }

  positions.set(basePositions)

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
  }
}

function createEtherealFilamentField(style: HeroStyle, seed: string): EtherealFilamentField {
  const config = { ...ETHEREAL_FILAMENT_PRESETS[style.kind] }
  const random = createRandom(getHash(seed) + 8192)
  const ringCount = config.crossSectionSegments + 1
  const vertexCount = config.filamentCount * config.trailLength * ringCount
  const positions = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const indices = new Uint16Array(config.filamentCount * (config.trailLength - 1) * config.crossSectionSegments * 6)
  const phases = new Float32Array(config.filamentCount)
  const orbitScales = new Float32Array(config.filamentCount)
  const radii = new Float32Array(config.filamentCount)
  const widthScales = new Float32Array(config.filamentCount)
  const axisVectors = new Float32Array(config.filamentCount * 3)
  const headPositions = new Float32Array(config.filamentCount * 3)
  const headVelocities = new Float32Array(config.filamentCount * 3)
  const history = new Float32Array(config.filamentCount * config.trailLength * 3)
  const axis = new THREE.Vector3()
  const direction = new THREE.Vector3()
  const tangent = new THREE.Vector3()

  let indexOffset = 0

  for (let filament = 0; filament < config.filamentCount; filament += 1) {
    const phase = random() * Math.PI * 2
    phases[filament] = phase
    orbitScales[filament] = 0.78 + random() * 0.64
    radii[filament] = config.shellDistance * (0.82 + random() * 0.42)
    widthScales[filament] = 0.82 + random() * 0.48

    axis.set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1)
    if (axis.lengthSq() < 0.000001) {
      axis.set(0, 1, 0)
    } else {
      axis.normalize()
    }

    const axisOffset = filament * 3
    axisVectors[axisOffset] = axis.x
    axisVectors[axisOffset + 1] = axis.y
    axisVectors[axisOffset + 2] = axis.z

    const azimuth = random() * Math.PI * 2
    const z = random() * 2 - 1
    const radial = Math.sqrt(Math.max(0, 1 - z * z))
    direction.set(Math.cos(azimuth) * radial, z, Math.sin(azimuth) * radial)
    direction.multiplyScalar(radii[filament])

    const headOffset = filament * 3
    headPositions[headOffset] = direction.x
    headPositions[headOffset + 1] = direction.y
    headPositions[headOffset + 2] = direction.z

    tangent.crossVectors(axis, direction)
    if (tangent.lengthSq() < 0.000001) {
      tangent.crossVectors(WORLD_UP, direction)
    }
    if (tangent.lengthSq() < 0.000001) {
      tangent.crossVectors(X_AXIS, direction)
    }
    tangent.normalize()
    tangent.multiplyScalar(config.orbitStrength * orbitScales[filament] * 0.32)
    headVelocities[headOffset] = tangent.x
    headVelocities[headOffset + 1] = tangent.y
    headVelocities[headOffset + 2] = tangent.z

    const filamentVertexBase = filament * config.trailLength * ringCount
    for (let segment = 0; segment < config.trailLength; segment += 1) {
      const along = segment / Math.max(1, config.trailLength - 1)
      const historyOffset = (filament * config.trailLength + segment) * 3
      history[historyOffset] = direction.x
      history[historyOffset + 1] = direction.y
      history[historyOffset + 2] = direction.z

      for (let ring = 0; ring < ringCount; ring += 1) {
        const vertex = filamentVertexBase + segment * ringCount + ring
        uvs[vertex * 2] = ring / config.crossSectionSegments
        uvs[vertex * 2 + 1] = along
      }

      if (segment >= config.trailLength - 1) {
        continue
      }

      for (let ring = 0; ring < config.crossSectionSegments; ring += 1) {
        const current = filamentVertexBase + segment * ringCount + ring
        const currentNext = current + 1
        const next = current + ringCount
        const nextNext = next + 1

        indices[indexOffset] = current
        indices[indexOffset + 1] = next
        indices[indexOffset + 2] = currentNext
        indices[indexOffset + 3] = next
        indices[indexOffset + 4] = nextNext
        indices[indexOffset + 5] = currentNext
        indexOffset += 6
      }
    }
  }

  const positionAttribute = new THREE.BufferAttribute(positions, 3)
  positionAttribute.setUsage(THREE.DynamicDrawUsage)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', positionAttribute)
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeBoundingSphere()

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
  }

  updateEtherealFilamentGeometry(field)
  return field
}

function createWireTraceGraph(shellScale: number): WireTraceGraph {
  const sourceGeometry = new THREE.IcosahedronGeometry(shellScale, 1)
  const edgesGeometry = new THREE.EdgesGeometry(sourceGeometry)
  sourceGeometry.dispose()

  const positions = edgesGeometry.attributes.position.array as Float32Array
  const nodeMap = new Map<string, number>()
  const nodes: THREE.Vector3[] = []
  const adjacency: number[][] = []

  const getNodeIndex = (x: number, y: number, z: number) => {
    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`
    const existing = nodeMap.get(key)

    if (existing !== undefined) {
      return existing
    }

    const index = nodes.length
    nodes.push(new THREE.Vector3(x, y, z))
    adjacency.push([])
    nodeMap.set(key, index)
    return index
  }

  const linkNodes = (a: number, b: number) => {
    if (!adjacency[a].includes(b)) {
      adjacency[a].push(b)
    }

    if (!adjacency[b].includes(a)) {
      adjacency[b].push(a)
    }
  }

  for (let offset = 0; offset < positions.length; offset += 6) {
    const a = getNodeIndex(positions[offset], positions[offset + 1], positions[offset + 2])
    const b = getNodeIndex(positions[offset + 3], positions[offset + 4], positions[offset + 5])

    if (a !== b) {
      linkNodes(a, b)
    }
  }

  edgesGeometry.dispose()

  return {
    nodes,
    adjacency,
  }
}

function pickNextTraceNode(
  graph: WireTraceGraph,
  current: number,
  previous: number,
  random: () => number,
): number {
  const neighbors = graph.adjacency[current]

  if (!neighbors || neighbors.length === 0) {
    return current
  }

  const candidates = neighbors.filter((node) => node !== previous)

  if (candidates.length === 0) {
    return neighbors[Math.floor(random() * neighbors.length)]
  }

  return candidates[Math.floor(random() * candidates.length)]
}

function sampleFilamentWind(position: THREE.Vector3, time: number, phase: number, target: THREE.Vector3) {
  const px = position.x
  const py = position.y
  const pz = position.z

  target.set(
    Math.sin(py * 1.48 + pz * 1.08 + time * 0.9 + phase * 1.7) +
      Math.cos(px * 1.12 - time * 0.62 + phase * 0.8),
    Math.sin(pz * 1.22 + px * 0.96 - time * 0.84 + phase * 1.3) +
      Math.cos(py * 1.36 + time * 0.52 - phase * 0.7),
    Math.sin(px * 1.31 + py * 0.92 + time * 0.74 - phase * 1.2) +
      Math.cos(pz * 1.28 - time * 0.68 + phase * 0.6),
  )

  if (target.lengthSq() < 0.000001) {
    target.set(0, 0, 0)
  } else {
    target.normalize()
  }
}

function updateEtherealFilamentSimulation(
  field: EtherealFilamentField,
  elapsed: number,
  delta: number,
  spread: number,
  reducedMotion: boolean,
) {
  const { config, headPositions, headVelocities, history, phases, orbitScales, radii, axisVectors } = field
  const clampedDelta = Math.min(delta, 1 / 24)
  const motionScale = reducedMotion ? 0.5 : 1
  const head = new THREE.Vector3()
  const velocity = new THREE.Vector3()
  const axis = new THREE.Vector3()
  const radial = new THREE.Vector3()
  const tangent = new THREE.Vector3()
  const orbitForce = new THREE.Vector3()
  const containment = new THREE.Vector3()
  const windForce = new THREE.Vector3()
  const acceleration = new THREE.Vector3()
  const damping = Math.exp(-config.drag * clampedDelta * motionScale)

  for (let filament = 0; filament < config.filamentCount; filament += 1) {
    const offset = filament * 3
    head.set(headPositions[offset], headPositions[offset + 1], headPositions[offset + 2])
    velocity.set(headVelocities[offset], headVelocities[offset + 1], headVelocities[offset + 2])
    axis.set(axisVectors[offset], axisVectors[offset + 1], axisVectors[offset + 2]).normalize()

    const radius = Math.max(head.length(), 0.0001)
    radial.copy(head).multiplyScalar(1 / radius)
    tangent.crossVectors(axis, radial)
    if (tangent.lengthSq() < 0.000001) {
      tangent.crossVectors(WORLD_UP, radial)
    }
    if (tangent.lengthSq() < 0.000001) {
      tangent.crossVectors(X_AXIS, radial)
    }
    tangent.normalize()

    const orbitGain = config.orbitStrength * orbitScales[filament] * motionScale
    orbitForce.copy(tangent).multiplyScalar(orbitGain)

    const targetRadius = THREE.MathUtils.lerp(0.08, radii[filament], spread)
    const radialWave = Math.sin(elapsed * (0.56 + orbitScales[filament] * 0.2) + phases[filament] * 1.3) * config.radialDrift
    containment.copy(radial).multiplyScalar((targetRadius + radialWave - radius) * config.containment * motionScale)

    sampleFilamentWind(head, elapsed * config.noiseSpeed, phases[filament], windForce)
    windForce.multiplyScalar(config.windStrength * motionScale)

    acceleration.copy(orbitForce).add(containment).add(windForce)
    velocity.addScaledVector(acceleration, clampedDelta)
    velocity.multiplyScalar(damping)

    const maxSpeed = (config.orbitStrength * 2.2 + config.windStrength * 1.45) * motionScale
    if (velocity.lengthSq() > maxSpeed * maxSpeed) {
      velocity.setLength(maxSpeed)
    }

    head.addScaledVector(velocity, clampedDelta)
    const collapsePull = (1 - spread) * (reducedMotion ? 0.9 : 1.4)
    if (collapsePull > 0.0001) {
      head.multiplyScalar(Math.max(0, 1 - collapsePull * clampedDelta))
    }

    headPositions[offset] = head.x
    headPositions[offset + 1] = head.y
    headPositions[offset + 2] = head.z
    headVelocities[offset] = velocity.x
    headVelocities[offset + 1] = velocity.y
    headVelocities[offset + 2] = velocity.z

    const baseHistoryOffset = filament * config.trailLength * 3
    for (let segment = config.trailLength - 1; segment > 0; segment -= 1) {
      const currentOffset = baseHistoryOffset + segment * 3
      const previousOffset = currentOffset - 3
      history[currentOffset] = history[previousOffset]
      history[currentOffset + 1] = history[previousOffset + 1]
      history[currentOffset + 2] = history[previousOffset + 2]
    }

    history[baseHistoryOffset] = head.x
    history[baseHistoryOffset + 1] = head.y
    history[baseHistoryOffset + 2] = head.z
  }
}

function updateEtherealFilamentGeometry(field: EtherealFilamentField) {
  const { config, ringCount, axisVectors, widthScales, history, positionAttribute } = field
  const positions = positionAttribute.array as Float32Array
  const center = new THREE.Vector3()
  const next = new THREE.Vector3()
  const tangent = new THREE.Vector3()
  const prevTangent = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const prevNormal = new THREE.Vector3()
  const binormal = new THREE.Vector3()
  const axis = new THREE.Vector3()
  const transportAxis = new THREE.Vector3()
  const ringDirection = new THREE.Vector3()
  const fallback = new THREE.Vector3()
  const lastSegmentIndex = config.trailLength - 1
  const twoPi = Math.PI * 2
  let positionOffset = 0

  for (let filament = 0; filament < config.filamentCount; filament += 1) {
    const axisOffset = filament * 3
    axis.set(axisVectors[axisOffset], axisVectors[axisOffset + 1], axisVectors[axisOffset + 2]).normalize()
    prevTangent.set(0, 0, 0)
    prevNormal.set(0, 0, 0)

    for (let segment = 0; segment < config.trailLength; segment += 1) {
      const historyOffset = (filament * config.trailLength + segment) * 3
      center.set(history[historyOffset], history[historyOffset + 1], history[historyOffset + 2])

      if (segment < lastSegmentIndex) {
        const nextOffset = historyOffset + 3
        next.set(history[nextOffset], history[nextOffset + 1], history[nextOffset + 2])
        tangent.subVectors(next, center)
      } else if (segment > 0) {
        const previousOffset = historyOffset - 3
        next.set(history[previousOffset], history[previousOffset + 1], history[previousOffset + 2])
        tangent.subVectors(center, next)
      } else {
        tangent.set(0, 1, 0)
      }

      if (tangent.lengthSq() < 0.000001) {
        tangent.copy(prevTangent.lengthSq() < 0.000001 ? axis : prevTangent)
      }
      tangent.normalize()

      if (segment === 0 || prevNormal.lengthSq() < 0.000001 || prevTangent.lengthSq() < 0.000001) {
        normal.crossVectors(axis, tangent)
        if (normal.lengthSq() < 0.000001) {
          fallback.crossVectors(WORLD_UP, tangent)
          normal.copy(fallback)
        }
        if (normal.lengthSq() < 0.000001) {
          fallback.crossVectors(X_AXIS, tangent)
          normal.copy(fallback)
        }
        normal.normalize()
      } else {
        transportAxis.crossVectors(prevTangent, tangent)
        const axisLengthSq = transportAxis.lengthSq()
        if (axisLengthSq < 0.000001) {
          normal.copy(prevNormal)
        } else {
          const axisLength = Math.sqrt(axisLengthSq)
          const angle = Math.atan2(axisLength, THREE.MathUtils.clamp(prevTangent.dot(tangent), -1, 1))
          transportAxis.multiplyScalar(1 / axisLength)
          normal.copy(prevNormal).applyAxisAngle(transportAxis, angle)
        }
        normal.addScaledVector(tangent, -normal.dot(tangent))
        if (normal.lengthSq() < 0.000001) {
          normal.copy(prevNormal)
        }
        normal.normalize()
      }

      binormal.crossVectors(tangent, normal).normalize()
      prevTangent.copy(tangent)
      prevNormal.copy(normal)

      const along = segment / Math.max(1, config.trailLength - 1)
      const headTaper = smoothstep(0.0, 0.1, along)
      const tailTaper = 1 - smoothstep(0.76, 1.0, along)
      const profile = headTaper * tailTaper
      const width = config.filamentWidth * widthScales[filament] * (0.24 + profile * 0.76)

      for (let ring = 0; ring < ringCount; ring += 1) {
        const angle = (ring / config.crossSectionSegments) * twoPi
        ringDirection.copy(normal).multiplyScalar(Math.cos(angle)).addScaledVector(binormal, Math.sin(angle))
        positions[positionOffset] = center.x + ringDirection.x * width
        positions[positionOffset + 1] = center.y + ringDirection.y * width
        positions[positionOffset + 2] = center.z + ringDirection.z * width
        positionOffset += 3
      }
    }
  }

  positionAttribute.needsUpdate = true
}

function updateParticleField(
  field: HeroParticleField,
  style: HeroStyle,
  elapsed: number,
  delta: number,
  intensity: number,
  collapseToCenter: boolean,
) {
  const clampedDelta = Math.min(delta, 1 / 24)
  const spread = collapseToCenter ? smoothstep(0.08, 0.64, intensity) : 1
  const collapse = 1 - spread
  const baseResponse = field.profile === 'stream' ? 8.2 : 5.6
  const smoothing = 1 - Math.exp(-(baseResponse + intensity * 3.8 + collapse * 2.2) * clampedDelta)

  for (let index = 0; index < field.count; index += 1) {
    const offset = index * 3
    const prevX = field.positions[offset]
    const prevY = field.positions[offset + 1]
    const prevZ = field.positions[offset + 2]

    const bx = field.basePositions[offset]
    const by = field.basePositions[offset + 1]
    const bz = field.basePositions[offset + 2]

    const phase = field.phases[index]
    const speed = field.speeds[index]
    const radius = field.radii[index]
    const band = field.bands[index]
    const lift = field.lifts[index]

    if (field.profile === 'stream') {
      const streamAngle = band * Math.PI * 2 + phase * 0.25
      const flow = elapsed * (0.92 + speed * 0.5) + phase * 1.6
      const pulse = 0.82 + Math.sin(elapsed * 0.64 + phase) * 0.18 + intensity * 0.22

      let targetX = 0
      let targetY = 0
      let targetZ = 0

      if (style.kind === 'storm') {
        const radial = radius * pulse
        targetX = Math.cos(flow + streamAngle) * radial + Math.sin(flow * 1.9 + lift * 2.4) * 0.16
        targetY = Math.sin(flow * 1.2 + streamAngle * 1.5) * (0.28 + radius * 0.12) + lift * 0.4
        targetZ = Math.sin(flow + streamAngle) * radial + Math.cos(flow * 1.6 + band * 11.0) * 0.14
      } else if (style.kind === 'harmonic') {
        const helixRadius = radius * (0.68 + Math.sin(flow * 1.1 + phase) * 0.18)
        targetX = Math.cos(flow * 1.1 + streamAngle) * helixRadius + Math.sin(flow * 1.7 + lift * 3.0) * 0.12
        targetY = Math.sin(flow * 0.84 + streamAngle * 0.9) * 0.46 + lift * 0.88 + Math.cos(flow * 0.42 + band * 7.0) * 0.42
        targetZ = Math.sin(flow * 1.1 + streamAngle) * helixRadius + Math.cos(flow * 1.4 + phase) * 0.1
      } else {
        const figure = flow * 0.9 + streamAngle
        const radial = radius * (0.78 + Math.sin(flow * 1.35 + phase) * 0.2)
        targetX = Math.sin(figure) * radial * 1.02 + Math.sin(flow * 1.8 + lift * 2.8) * 0.1
        targetY = Math.sin(figure * 1.55) * (0.24 + radius * 0.1) + lift * 0.42
        targetZ = Math.sin(figure * 2.1) * radial * 0.74 + Math.cos(flow * 1.5 + phase) * 0.12
      }

      const finalX = targetX * spread
      const finalY = targetY * spread
      const finalZ = targetZ * spread

      field.positions[offset] = THREE.MathUtils.lerp(prevX, finalX, smoothing)
      field.positions[offset + 1] = THREE.MathUtils.lerp(prevY, finalY, smoothing)
      field.positions[offset + 2] = THREE.MathUtils.lerp(prevZ, finalZ, smoothing)
      const invDelta = 1 / Math.max(clampedDelta, 1 / 240)
      field.velocities[offset] = THREE.MathUtils.lerp(
        field.velocities[offset],
        (field.positions[offset] - prevX) * invDelta,
        0.56,
      )
      field.velocities[offset + 1] = THREE.MathUtils.lerp(
        field.velocities[offset + 1],
        (field.positions[offset + 1] - prevY) * invDelta,
        0.56,
      )
      field.velocities[offset + 2] = THREE.MathUtils.lerp(
        field.velocities[offset + 2],
        (field.positions[offset + 2] - prevZ) * invDelta,
        0.56,
      )
      continue
    }

    const spin = elapsed * (0.16 + speed * 0.18)
    const cos = Math.cos(spin)
    const sin = Math.sin(spin)
    const swirlX = bx * cos - bz * sin
    const swirlZ = bx * sin + bz * cos
    const breathing = 0.84 + Math.sin(elapsed * 0.58 + phase) * 0.22 + intensity * 0.16

    let targetX = swirlX * breathing
    let targetY = by * (0.78 + breathing * 0.36)
    let targetZ = swirlZ * breathing

    if (style.kind === 'harmonic') {
      targetX += Math.sin(elapsed * 1.0 + phase * 1.8) * (0.12 + radius * 0.04)
      targetY += Math.cos(elapsed * 0.7 + phase + lift * 2.0) * 0.22
      targetZ += Math.cos(elapsed * 0.92 + phase * 2.2) * (0.12 + radius * 0.04)
    } else if (style.kind === 'storm') {
      targetX += Math.sin(elapsed * 1.2 + phase * 2.1 + band * 3.2) * 0.2
      targetY += Math.sin(elapsed * 0.86 + phase + lift) * 0.14
      targetZ += Math.cos(elapsed * 1.16 + phase * 1.7 + band * 2.8) * 0.2
    } else {
      targetX += Math.sin(elapsed * 0.95 + phase * 2.0) * 0.16
      targetY += Math.cos(elapsed * 1.02 + phase + lift * 1.8) * 0.12
      targetZ += Math.cos(elapsed * 1.08 + phase * 1.6) * 0.16
    }

    const finalX = targetX * spread
    const finalY = targetY * spread
    const finalZ = targetZ * spread

    field.positions[offset] = THREE.MathUtils.lerp(prevX, finalX, smoothing)
    field.positions[offset + 1] = THREE.MathUtils.lerp(prevY, finalY, smoothing)
    field.positions[offset + 2] = THREE.MathUtils.lerp(prevZ, finalZ, smoothing)
    const invDelta = 1 / Math.max(clampedDelta, 1 / 240)
    field.velocities[offset] = THREE.MathUtils.lerp(
      field.velocities[offset],
      (field.positions[offset] - prevX) * invDelta,
      0.42,
    )
    field.velocities[offset + 1] = THREE.MathUtils.lerp(
      field.velocities[offset + 1],
      (field.positions[offset + 1] - prevY) * invDelta,
      0.42,
    )
    field.velocities[offset + 2] = THREE.MathUtils.lerp(
      field.velocities[offset + 2],
      (field.positions[offset + 2] - prevZ) * invDelta,
      0.42,
    )
  }
}

function getFocusRadius(project: Project) {
  const style = getHeroStyle(project)

  if (style.kind === 'harmonic') {
    return 0.94
  }

  if (style.kind === 'pulse') {
    return 0.9
  }

  return 0.96
}

function ProjectNode({
  project,
  isActive,
  isHovered,
  mapVisibility,
  nodeDisplayMode,
  neutralBlendOverride,
  introReveal,
  reducedMotion,
  onHover,
  onSelect,
}: ProjectNodeProps) {
  const isNeutralNode = nodeDisplayMode === 'neutral'
  const introVisibilityStatic = clamp01(introReveal)
  const neutralNeedsTransparency = !isNeutralNode || neutralBlendOverride !== null || introVisibilityStatic < 0.999
  const groupRef = useRef<THREE.Group>(null)
  const ringRef = useRef<THREE.Mesh>(null)
  const outerRingRef = useRef<THREE.Mesh>(null)
  const nodeMaterialRef = useRef<THREE.MeshStandardMaterial>(null)
  const ringMaterialRef = useRef<THREE.MeshBasicMaterial>(null)
  const outerRingMaterialRef = useRef<THREE.MeshBasicMaterial>(null)
  const scaleTargetRef = useMemo(() => new THREE.Vector3(1, 1, 1), [])
  const neutralBlendRef = useRef(nodeDisplayMode === 'neutral' ? 1 : 0)
  const phaseOffset = useMemo(() => (getHash(project.id) % 628) / 100, [project.id])

  useEffect(() => {
    return () => {
      document.body.style.cursor = 'default'
    }
  }, [])

  useFrame(({ clock }, delta) => {
    if (!groupRef.current) {
      return
    }

    const elapsed = clock.getElapsedTime()
    const frameDelta = reducedMotion ? delta : Math.min(delta, 1 / 28)
    const blendLerp = 1 - Math.exp(-(reducedMotion ? 12 : 8.5) * frameDelta)
    const scaleLerp = 1 - Math.exp(-(reducedMotion ? 14 : 9.5) * frameDelta)
    const [x, y, z] = project.coordinates
    const drift = reducedMotion ? 0 : Math.sin(elapsed * 0.7 + phaseOffset) * 0.1
    const neutralTarget = neutralBlendOverride ?? (nodeDisplayMode === 'neutral' ? 1 : 0)
    const neutralBlendLerp =
      neutralBlendOverride === null ? blendLerp : 1 - Math.exp(-(reducedMotion ? 14 : 6.2) * frameDelta)
    neutralBlendRef.current = THREE.MathUtils.lerp(neutralBlendRef.current, isActive ? 0 : neutralTarget, neutralBlendLerp)
    const neutralBlend = neutralBlendRef.current
    const neutralModeOpacity = neutralBlendOverride === null ? 1 : neutralBlend
    const introVisibility = clamp01(introReveal)
    const introFlash = Math.exp(-Math.pow(introVisibility - 0.72, 2) / 0.014)
    const pulseAmplitude = THREE.MathUtils.lerp(0.024, 0.048, neutralBlend)
    const pulse = reducedMotion ? 0 : Math.sin(elapsed * 2 + phaseOffset) * pulseAmplitude

    groupRef.current.position.set(x, y + drift, z)

    const baseScale = THREE.MathUtils.lerp(0.88, 1.26, neutralBlend)
    const hoverScale = isHovered ? THREE.MathUtils.lerp(0.1, 0.16, neutralBlend) : 0
    const introScale = isNeutralNode ? introVisibility * (0.95 + introFlash * 0.12) : 1
    const targetScale = (baseScale + hoverScale) * introScale
    scaleTargetRef.setScalar(targetScale + pulse)
    groupRef.current.scale.lerp(scaleTargetRef, scaleLerp)

    if (ringRef.current) {
      ringRef.current.rotation.z += reducedMotion ? 0 : THREE.MathUtils.lerp(0.192, 0.288, neutralBlend) * frameDelta
      const innerRingScale = THREE.MathUtils.lerp(0.82, 1.42, neutralBlend) + (isHovered ? 0.08 : 0)
      ringRef.current.scale.setScalar(innerRingScale)
    }

    if (outerRingRef.current) {
      outerRingRef.current.rotation.z -= reducedMotion ? 0 : THREE.MathUtils.lerp(0.144, 0.228, neutralBlend) * frameDelta
      const outerRingScale = THREE.MathUtils.lerp(0.8, 1.5, neutralBlend) + (isHovered ? 0.08 : 0)
      outerRingRef.current.scale.setScalar(outerRingScale)
    }

    if (nodeMaterialRef.current) {
      const baseOpacity = isHovered ? 0.54 : 0.4
      const neutralOpacityBoost = isHovered ? 0.16 : 0.14
      const baseEmissive = isHovered ? 0.42 : 0.3
      const neutralEmissiveBoost = isHovered ? 0.32 : 0.24

      nodeMaterialRef.current.opacity = isNeutralNode
        ? neutralModeOpacity * introVisibility
        : mapVisibility * (baseOpacity + neutralBlend * neutralOpacityBoost)
      nodeMaterialRef.current.emissiveIntensity = mapVisibility * (baseEmissive + neutralBlend * neutralEmissiveBoost) * (isNeutralNode ? (0.24 + introVisibility * 0.76 + introFlash * 0.28) : 1)
    }

    if (ringMaterialRef.current) {
      const baseRingOpacity = isHovered ? 0.22 : 0.13
      const neutralRingBoost = isHovered ? 0.34 : 0.3
      ringMaterialRef.current.opacity = isNeutralNode
        ? neutralModeOpacity * introVisibility * (0.88 + introFlash * 0.24)
        : mapVisibility * (baseRingOpacity + neutralBlend * neutralRingBoost)
    }

    if (outerRingMaterialRef.current) {
      const outerOpacity = isHovered ? 0.28 : 0.18
      outerRingMaterialRef.current.opacity = isNeutralNode
        ? neutralModeOpacity * introVisibility * (0.82 + introFlash * 0.22)
        : mapVisibility * outerOpacity * neutralBlend
    }
  })

  const neutralModeOpacity = neutralBlendOverride === null ? 1 : neutralBlendOverride

  return (
    <group ref={groupRef} scale={isNeutralNode ? Math.max(0.0001, introVisibilityStatic) : 1}>
      {!isActive && (
        <>
          <mesh ref={ringRef} renderOrder={-20}>
            <torusGeometry args={[0.31, 0.014, 12, 80]} />
            <meshBasicMaterial
              ref={ringMaterialRef}
              color={project.color}
              transparent={neutralNeedsTransparency}
              opacity={isNeutralNode ? neutralModeOpacity * introVisibilityStatic : 0.28}
              depthWrite
              depthTest
              blending={isNeutralNode ? THREE.NormalBlending : THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>

          <mesh ref={outerRingRef} rotation={[Math.PI * 0.32, 0, 0]} renderOrder={-20}>
            <torusGeometry args={[0.43, 0.01, 12, 80]} />
            <meshBasicMaterial
              ref={outerRingMaterialRef}
              color={project.color}
              transparent={neutralNeedsTransparency}
              opacity={isNeutralNode ? neutralModeOpacity * introVisibilityStatic : 0.22}
              depthWrite
              depthTest
              blending={isNeutralNode ? THREE.NormalBlending : THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>

          <mesh
            renderOrder={-18}
            onPointerOver={(event) => {
              event.stopPropagation()
              document.body.style.cursor = 'pointer'
              onHover(project.id)
            }}
            onPointerOut={(event) => {
              event.stopPropagation()
              document.body.style.cursor = 'default'
              onHover(null)
            }}
            onClick={(event) => {
              event.stopPropagation()
              onSelect(project.id)
            }}
          >
            <icosahedronGeometry args={[0.27, 1]} />
            <meshStandardMaterial
              ref={nodeMaterialRef}
              color={project.color}
              emissive={project.color}
              roughness={0.3}
              metalness={0.2}
              transparent={neutralNeedsTransparency}
              opacity={isNeutralNode ? neutralModeOpacity * introVisibilityStatic : 0.62}
              depthWrite
              depthTest
              blending={isNeutralNode ? THREE.NormalBlending : THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
        </>
      )}

      {isHovered && mapVisibility > 0.2 && !isActive && (
        <Html position={[0, 0.8, 0]} center distanceFactor={12} zIndexRange={[30, 0]}>
          <div className="node-label">{project.title}</div>
        </Html>
      )}
    </group>
  )
}

function HeroWorld({ project, reducedMotion, presenceTarget, collapseParticlesOnFadeOut }: HeroWorldProps) {
  const groupRef = useRef<THREE.Group>(null)
  const coreRef = useRef<THREE.Object3D>(null)
  const coreMaskRef = useRef<THREE.Mesh>(null)
  const shellRef = useRef<THREE.Mesh>(null)
  const shellStarBlockerRef = useRef<THREE.Mesh>(null)
  const coreStarBlockerRef = useRef<THREE.Mesh>(null)
  const shellAccentRef = useRef<THREE.Object3D>(null)
  const shellOcclusionRef = useRef<THREE.Mesh>(null)
  const shellMaskRef = useRef<THREE.Mesh>(null)
  const shellAccentMaskRef = useRef<THREE.Object3D>(null)
  const coreDustGroupRef = useRef<THREE.Group>(null)
  const coreDustMeshRef = useRef<THREE.Mesh>(null)
  const shellTraceGroupRef = useRef<THREE.Group>(null)
  const shellTraceSegmentRef = useRef<THREE.Mesh>(null)
  const shellTraceCoreRef = useRef<THREE.Mesh>(null)
  const streamRibbonRef = useRef<THREE.Mesh>(null)
  const streamPointsRef = useRef<THREE.Points>(null)
  const coreMaterialRef = useRef<THREE.ShaderMaterial>(null)
  const coreDustMaterialRef = useRef<THREE.ShaderMaterial>(null)
  const shellMaterialRef = useRef<THREE.ShaderMaterial>(null)
  const streamRibbonMaterialRef = useRef<THREE.ShaderMaterial>(null)
  const streamSwarmMaterialRef = useRef<THREE.ShaderMaterial>(null)
  const traceSegmentMaterialRef = useRef<THREE.MeshBasicMaterial>(null)
  const traceCoreMaterialRef = useRef<THREE.MeshBasicMaterial>(null)
  const accentPrimaryMaterialRef = useRef<THREE.MeshBasicMaterial>(null)
  const accentSecondaryMaterialRef = useRef<THREE.MeshBasicMaterial>(null)
  const accentScaleTargetRef = useMemo(() => new THREE.Vector3(1, 1, 1), [])
  const groupScaleTargetRef = useMemo(() => new THREE.Vector3(1, 1, 1), [])
  const traceStartRef = useMemo(() => new THREE.Vector3(), [])
  const traceEndRef = useMemo(() => new THREE.Vector3(), [])
  const traceDirRef = useMemo(() => new THREE.Vector3(), [])
  const traceCenterRef = useMemo(() => new THREE.Vector3(), [])
  const traceCoreColorRef = useMemo(() => new THREE.Color(), [])
  const coreDustCameraLocalRef = useMemo(() => new THREE.Vector3(), [])
  const coreDustWindPrimaryWorldRef = useMemo(() => new THREE.Vector3(), [])
  const coreDustWindSecondaryWorldRef = useMemo(() => new THREE.Vector3(), [])
  const coreDustWindPrimaryTargetWorldRef = useMemo(() => new THREE.Vector3(), [])
  const coreDustWindSecondaryTargetWorldRef = useMemo(() => new THREE.Vector3(), [])
  const coreDustWindPrimaryLocalRef = useMemo(() => new THREE.Vector3(), [])
  const coreDustWindSecondaryLocalRef = useMemo(() => new THREE.Vector3(), [])
  const coreDustLightWorldRef = useMemo(() => new THREE.Vector3(), [])
  const coreDustLightLocalRef = useMemo(() => new THREE.Vector3(), [])
  const coreDustWorldPosRef = useMemo(() => new THREE.Vector3(), [])
  const coreDustWorldQuatRef = useMemo(() => new THREE.Quaternion(), [])
  const coreDustWorldQuatInverseRef = useMemo(() => new THREE.Quaternion(), [])
  const presenceRef = useRef(clamp01(presenceTarget))
  const traceRandomRef = useRef<(() => number) | null>(null)
  const coreDustWindRandomRef = useRef<(() => number) | null>(null)
  const coreDustNextRetargetRef = useRef(0)
  const coreDustStepBudgetRef = useRef(16)
  const traceStateRef = useRef({
    from: 0,
    to: 0,
    previous: -1,
    progress: 0,
    speed: 0.9,
  })

  const style = useMemo(() => getHeroStyle(project), [project])
  const showCoreDust = !collapseParticlesOnFadeOut
  const etherealFilaments = useMemo(() => createEtherealFilamentField(style, `${project.id}-hero-filaments`), [style, project.id])
  const wireTraceGraph = useMemo(() => createWireTraceGraph(style.shellScale), [style.shellScale])
  const streamParticles = useMemo(() => createParticleField(style, `${project.id}-hero-stream`, 'stream'), [style, project.id])
  const accentColor = useMemo(() => new THREE.Color(style.accent), [style.accent])
  const secondaryColor = useMemo(() => new THREE.Color(style.secondary), [style.secondary])
  const coreDustProfile = useMemo(() => CORE_DUST_PRESETS[style.kind], [style.kind])
  const silhouetteProfile = useMemo(() => {
    if (style.kind === 'storm') {
      return { core: 1.02, shell: 0.76, ringsPrimary: 1.0, ringsSecondary: 0.94, particles: 1.34 }
    }

    if (style.kind === 'harmonic') {
      return { core: 1.04, shell: 0.88, ringsPrimary: 0.88, ringsSecondary: 0.82, particles: 1.08 }
    }

    return { core: 1.0, shell: 0.8, ringsPrimary: 1.08, ringsSecondary: 1.0, particles: 1.22 }
  }, [style.kind])
  const coreDustRadius = useMemo(() => style.shellScale * coreDustProfile.radiusScale, [coreDustProfile.radiusScale, style.shellScale])
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
      uLightDirLocal: { value: new THREE.Vector3(0.46, 0.74, 0.36).normalize() },
      uWindPrimary: { value: new THREE.Vector3(1, 0, 0) },
      uWindSecondary: { value: new THREE.Vector3(0, 0, 1) },
    }),
    [accentColor, coreDustProfile, coreDustRadius, secondaryColor],
  )

  const accentBaseOpacity = useMemo(() => {
    if (style.kind === 'harmonic') {
      return { primary: 0.24, secondary: 0.23 }
    }

    if (style.kind === 'pulse') {
      return { primary: 0.22, secondary: 0.21 }
    }

    return { primary: 0.22, secondary: 0.2 }
  }, [style.kind])

  useEffect(
    () => () => {
      etherealFilaments.geometry.dispose()
    },
    [etherealFilaments],
  )

  useEffect(() => {
    coreDustWindRandomRef.current = createRandom(getHash(`${project.id}-core-dust-wind`) + 341)
    coreDustNextRetargetRef.current = 0
    coreDustStepBudgetRef.current = reducedMotion ? 12 : 16
    coreDustWindPrimaryWorldRef.set(1, 0, 0)
    coreDustWindSecondaryWorldRef.set(0, 0, 1)
    coreDustWindPrimaryTargetWorldRef.set(1, 0, 0)
    coreDustWindSecondaryTargetWorldRef.set(0, 0, 1)
  }, [project.id, reducedMotion])

  useEffect(() => {
    const random = createRandom(getHash(`${project.id}-wire-trace`) + 97)
    traceRandomRef.current = random

    if (wireTraceGraph.nodes.length < 2) {
      traceStateRef.current = { from: 0, to: 0, previous: -1, progress: 0, speed: 0.8 }
      return
    }

    const from = Math.floor(random() * wireTraceGraph.nodes.length)
    const to = pickNextTraceNode(wireTraceGraph, from, -1, random)
    traceStateRef.current = {
      from,
      to,
      previous: -1,
      progress: 0,
      speed: style.kind === 'harmonic' ? 0.68 : style.kind === 'pulse' ? 0.76 : 0.72,
    }
  }, [project.id, style.kind, wireTraceGraph])

  const coreUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: accentColor.clone() },
      uIntensity: { value: 1 },
      uEnergy: { value: 1 },
    }),
    [accentColor],
  )

  const shellUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: secondaryColor.clone() },
      uIntensity: { value: 1 },
    }),
    [secondaryColor],
  )

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
    [accentColor, secondaryColor],
  )

  const streamSwarmUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: accentColor.clone() },
      uOpacity: { value: 0.28 },
      uBaseSize: { value: style.kind === 'harmonic' ? 48 : style.kind === 'pulse' ? 50 : 46 },
      uIntensity: { value: 1 },
    }),
    [accentColor, style.kind],
  )

  useFrame(({ clock, camera }, delta) => {
    const elapsed = clock.getElapsedTime()
    const frameDelta = reducedMotion ? delta : Math.min(delta, 1 / 28)
    const presenceLerp = 1 - Math.exp(-(reducedMotion ? 18 : 10.5) * frameDelta)
    presenceRef.current = THREE.MathUtils.lerp(presenceRef.current, clamp01(presenceTarget), presenceLerp)
    const intensity = clamp01(presenceRef.current)
    const isVisible = intensity > 0.008
    const maskVisible = intensity > 0.05

    if (groupRef.current) {
      groupRef.current.visible = isVisible
    }

    if (shellMaskRef.current) {
      shellMaskRef.current.visible = maskVisible
    }

    if (shellOcclusionRef.current) {
      shellOcclusionRef.current.visible = maskVisible
    }

    if (shellAccentMaskRef.current) {
      shellAccentMaskRef.current.visible = maskVisible
    }

    if (coreMaskRef.current) {
      coreMaskRef.current.visible = maskVisible
    }

    if (shellStarBlockerRef.current) {
      shellStarBlockerRef.current.visible = maskVisible
    }

    if (coreStarBlockerRef.current) {
      coreStarBlockerRef.current.visible = maskVisible
    }

    if (!isVisible) {
      return
    }

    const scaleLerp = 1 - Math.exp(-(reducedMotion ? 10 : 7.5) * frameDelta)
    const accentLerp = 1 - Math.exp(-(reducedMotion ? 12 : 8.5) * frameDelta)

    if (groupRef.current) {
      const targetScale = 0.44 + intensity * 0.66
      groupScaleTargetRef.setScalar(targetScale)
      groupRef.current.scale.lerp(groupScaleTargetRef, scaleLerp)
      groupRef.current.rotation.y += frameDelta * (reducedMotion ? 0.018 : 0.054)
    }

    if (coreRef.current) {
      coreRef.current.rotation.x += frameDelta * (reducedMotion ? 0.08 : 0.14)
      coreRef.current.rotation.y += frameDelta * (reducedMotion ? 0.14 : 0.24)
      if (style.kind === 'harmonic') {
        coreRef.current.rotation.z += frameDelta * (reducedMotion ? 0.06 : 0.12)
      }
    }

    if (coreRef.current && coreMaskRef.current) {
      coreMaskRef.current.rotation.copy(coreRef.current.rotation)
    }

    if (coreRef.current && coreStarBlockerRef.current) {
      coreStarBlockerRef.current.rotation.copy(coreRef.current.rotation)
    }

    if (shellRef.current) {
      shellRef.current.rotation.y += frameDelta * (reducedMotion ? 0.024 : 0.108)
      shellRef.current.rotation.z += frameDelta * (reducedMotion ? 0.021 : 0.066)
    }

    if (showCoreDust && shellRef.current && coreDustGroupRef.current) {
      coreDustGroupRef.current.rotation.copy(shellRef.current.rotation)
      const cloudPulse =
        1 +
        Math.sin(elapsed * 0.52 + (style.kind === 'harmonic' ? 0.8 : style.kind === 'pulse' ? 1.4 : 0.2)) *
          0.035 *
          intensity
      coreDustGroupRef.current.scale.setScalar(cloudPulse)
    }

    if (shellAccentRef.current) {
      shellAccentRef.current.rotation.x += frameDelta * (reducedMotion ? 0.024 : 0.108)
      shellAccentRef.current.rotation.y += frameDelta * (reducedMotion ? 0.027 : 0.09)

      if (style.kind === 'storm') {
        const pulse = 1 + Math.sin(elapsed * 0.7) * 0.12 * intensity
        accentScaleTargetRef.setScalar(pulse)
        shellAccentRef.current.scale.lerp(accentScaleTargetRef, accentLerp)
      }

      if (style.kind === 'pulse') {
        const beat = 0.98 + Math.sin(elapsed * 0.65) * 0.1 * intensity
        accentScaleTargetRef.setScalar(beat)
        shellAccentRef.current.scale.lerp(accentScaleTargetRef, accentLerp)
      }
    }

    if (shellRef.current && shellMaskRef.current) {
      shellMaskRef.current.rotation.copy(shellRef.current.rotation)
    }

    if (shellRef.current && shellOcclusionRef.current) {
      shellOcclusionRef.current.rotation.copy(shellRef.current.rotation)
    }

    if (shellRef.current && shellStarBlockerRef.current) {
      shellStarBlockerRef.current.rotation.copy(shellRef.current.rotation)
    }

    if (shellAccentRef.current && shellAccentMaskRef.current) {
      shellAccentMaskRef.current.rotation.copy(shellAccentRef.current.rotation)
      shellAccentMaskRef.current.scale.copy(shellAccentRef.current.scale)
    }

    if (shellRef.current && shellTraceGroupRef.current) {
      shellTraceGroupRef.current.rotation.copy(shellRef.current.rotation)
    }

    if (shellTraceCoreRef.current && shellTraceSegmentRef.current && wireTraceGraph.nodes.length > 1) {
      const random = traceRandomRef.current ?? createRandom(getHash(`${project.id}-wire-trace-fallback`) + 131)
      traceRandomRef.current = random
      const traceState = traceStateRef.current
      const fromNode = wireTraceGraph.nodes[traceState.from]
      const toNode = wireTraceGraph.nodes[traceState.to]

      traceStartRef.copy(fromNode)
      traceEndRef.copy(toNode)
      traceDirRef.subVectors(traceEndRef, traceStartRef)
      const edgeLength = Math.max(traceDirRef.length(), 0.0001)
      traceDirRef.multiplyScalar(1 / edgeLength)

      traceState.progress += ((reducedMotion ? 0.34 : 0.9) * traceState.speed * frameDelta) / edgeLength

      while (traceState.progress >= 1) {
        traceState.progress -= 1
        traceState.previous = traceState.from
        traceState.from = traceState.to
        traceState.to = pickNextTraceNode(wireTraceGraph, traceState.from, traceState.previous, random)

        traceStartRef.copy(wireTraceGraph.nodes[traceState.from])
        traceEndRef.copy(wireTraceGraph.nodes[traceState.to])
        traceDirRef.subVectors(traceEndRef, traceStartRef)
        const nextLength = Math.max(traceDirRef.length(), 0.0001)
        traceDirRef.multiplyScalar(1 / nextLength)
      }

      const currentLength = Math.max(traceStartRef.distanceTo(traceEndRef), 0.0001)
      const pulseHalfLength = THREE.MathUtils.clamp(currentLength * 0.2, 0.12, 0.36)
      const pulseDistance = currentLength * traceState.progress
      const pulseStart = Math.max(0, pulseDistance - pulseHalfLength)
      const pulseEnd = Math.min(currentLength, pulseDistance + pulseHalfLength)
      const tracedLength = Math.max(0.001, pulseEnd - pulseStart)
      traceCenterRef.copy(traceStartRef).addScaledVector(traceDirRef, pulseStart + tracedLength * 0.5)
      const electricPulse = 0.95 + Math.sin(elapsed * 4.2 + traceState.progress * Math.PI * 6) * 0.11

      shellTraceSegmentRef.current.position.copy(traceCenterRef)
      shellTraceSegmentRef.current.quaternion.setFromUnitVectors(WORLD_UP, traceDirRef)
      shellTraceSegmentRef.current.scale.set(electricPulse, tracedLength, electricPulse)

      shellTraceCoreRef.current.position.copy(traceCenterRef)
      shellTraceCoreRef.current.quaternion.copy(shellTraceSegmentRef.current.quaternion)
      shellTraceCoreRef.current.scale.set(electricPulse * 0.54, tracedLength, electricPulse * 0.54)
    }

    updateParticleField(streamParticles, style, elapsed * 0.5, frameDelta, intensity, collapseParticlesOnFadeOut)

    const collapseBlend = collapseParticlesOnFadeOut ? smoothstep(0.02, 0.8, intensity) : 1

    if (streamRibbonRef.current) {
      updateEtherealFilamentSimulation(etherealFilaments, elapsed, frameDelta, collapseBlend, reducedMotion)
      updateEtherealFilamentGeometry(etherealFilaments)
    }

    if (streamPointsRef.current) {
      const streamPosition = streamPointsRef.current.geometry.attributes.position as THREE.BufferAttribute
      streamPosition.needsUpdate = true
    }

    if (coreMaterialRef.current) {
      coreMaterialRef.current.uniforms.uTime.value = elapsed
      coreMaterialRef.current.uniforms.uColor.value.copy(accentColor)
      if (style.kind === 'pulse') {
        coreMaterialRef.current.uniforms.uIntensity.value = (0.17 + intensity * 0.38) * intensity * silhouetteProfile.core
        coreMaterialRef.current.uniforms.uEnergy.value = (0.18 + intensity * 0.54) * intensity * silhouetteProfile.core
      } else {
        coreMaterialRef.current.uniforms.uIntensity.value = (0.22 + intensity * 0.48) * intensity * silhouetteProfile.core
        coreMaterialRef.current.uniforms.uEnergy.value = (0.2 + intensity * 0.7) * intensity * silhouetteProfile.core
      }
    }

    if (shellMaterialRef.current) {
      shellMaterialRef.current.uniforms.uTime.value = elapsed
      shellMaterialRef.current.uniforms.uColor.value.copy(secondaryColor).lerp(accentColor, 0.18)
      shellMaterialRef.current.uniforms.uIntensity.value = (0.26 + intensity * 0.62) * intensity * silhouetteProfile.shell
    }

    if (streamRibbonMaterialRef.current) {
      streamRibbonMaterialRef.current.uniforms.uTime.value = elapsed
      streamRibbonMaterialRef.current.uniforms.uColor.value.copy(accentColor)
      streamRibbonMaterialRef.current.uniforms.uSecondary.value.copy(secondaryColor).lerp(accentColor, 0.2)
      streamRibbonMaterialRef.current.uniforms.uIntensity.value = intensity * silhouetteProfile.particles
      streamRibbonMaterialRef.current.uniforms.uOpacity.value = (0.045 + intensity * 0.14) * intensity
      streamRibbonMaterialRef.current.uniforms.uEmission.value = etherealFilaments.config.emissionIntensity
      streamRibbonMaterialRef.current.uniforms.uNoiseSpeed.value = etherealFilaments.config.noiseSpeed
    }

    if (streamSwarmMaterialRef.current) {
      streamSwarmMaterialRef.current.uniforms.uTime.value = elapsed
      streamSwarmMaterialRef.current.uniforms.uColor.value.copy(accentColor).lerp(secondaryColor, 0.06)
      streamSwarmMaterialRef.current.uniforms.uIntensity.value = intensity * silhouetteProfile.particles
      streamSwarmMaterialRef.current.uniforms.uOpacity.value =
        (0.12 + intensity * 0.36) * intensity * silhouetteProfile.particles
    }

    if (traceSegmentMaterialRef.current) {
      traceSegmentMaterialRef.current.color.copy(accentColor).lerp(secondaryColor, 0.08)
      traceSegmentMaterialRef.current.opacity = (0.2 + intensity * 0.6) * intensity
    }

    if (traceCoreMaterialRef.current) {
      traceCoreMaterialRef.current.color.copy(traceCoreColorRef.copy(accentColor).lerp(WHITE, 0.4))
      traceCoreMaterialRef.current.opacity = (0.26 + intensity * 0.72) * intensity
    }

    if (showCoreDust && coreDustMaterialRef.current) {
      const coreDustMaterial = coreDustMaterialRef.current
      let detailQuality = reducedMotion ? 0.62 : 0.72
      const random = coreDustWindRandomRef.current ?? createRandom(getHash(`${project.id}-core-dust-wind-fallback`) + 557)
      coreDustWindRandomRef.current = random

      if (
        coreDustNextRetargetRef.current <= elapsed ||
        coreDustWindPrimaryTargetWorldRef.lengthSq() < 0.0001 ||
        coreDustWindSecondaryTargetWorldRef.lengthSq() < 0.0001
      ) {
        const holdScale = THREE.MathUtils.clamp(0.02 / Math.max(0.001, coreDustProfile.windTempo), 0.8, 1.45)
        const holdDuration = ((reducedMotion ? 20 : 12) + random() * (reducedMotion ? 16 : 10)) * holdScale
        coreDustNextRetargetRef.current = elapsed + holdDuration

        coreDustWindPrimaryTargetWorldRef.set(random() * 2 - 1, (random() * 2 - 1) * 0.22, random() * 2 - 1)
        if (coreDustWindPrimaryTargetWorldRef.lengthSq() < 0.0001) {
          coreDustWindPrimaryTargetWorldRef.set(1, 0, 0)
        }
        coreDustWindPrimaryTargetWorldRef.normalize()

        coreDustWindSecondaryTargetWorldRef.set(random() * 2 - 1, (random() * 2 - 1) * 0.18, random() * 2 - 1)
        coreDustWindSecondaryTargetWorldRef.addScaledVector(
          coreDustWindPrimaryTargetWorldRef,
          -coreDustWindSecondaryTargetWorldRef.dot(coreDustWindPrimaryTargetWorldRef),
        )
        if (coreDustWindSecondaryTargetWorldRef.lengthSq() < 0.0001) {
          coreDustWindSecondaryTargetWorldRef.set(
            -coreDustWindPrimaryTargetWorldRef.z,
            coreDustWindPrimaryTargetWorldRef.y * 0.2,
            coreDustWindPrimaryTargetWorldRef.x,
          )
        }
        if (coreDustWindSecondaryTargetWorldRef.lengthSq() < 0.0001) {
          coreDustWindSecondaryTargetWorldRef.set(0, 0, 1)
        }
        coreDustWindSecondaryTargetWorldRef.normalize()
      }

      const holdScale = THREE.MathUtils.clamp(0.02 / Math.max(0.001, coreDustProfile.windTempo), 0.8, 1.45)
      const windLerp = 1 - Math.exp(-((reducedMotion ? 0.22 : 0.16) / holdScale) * frameDelta)

      if (coreDustWindPrimaryWorldRef.lengthSq() < 0.0001) {
        coreDustWindPrimaryWorldRef.copy(coreDustWindPrimaryTargetWorldRef)
      } else {
        coreDustWindPrimaryWorldRef.lerp(coreDustWindPrimaryTargetWorldRef, windLerp).normalize()
      }

      if (coreDustWindSecondaryWorldRef.lengthSq() < 0.0001) {
        coreDustWindSecondaryWorldRef.copy(coreDustWindSecondaryTargetWorldRef)
      } else {
        coreDustWindSecondaryWorldRef.lerp(coreDustWindSecondaryTargetWorldRef, windLerp).normalize()
      }

      const windAlignment = Math.abs(coreDustWindPrimaryWorldRef.dot(coreDustWindSecondaryWorldRef))
      if (windAlignment > 0.9) {
        coreDustWindSecondaryWorldRef.addScaledVector(X_AXIS, 0.4).normalize()
      }

      coreDustLightWorldRef.set(0.46, 0.74, 0.36).addScaledVector(coreDustWindSecondaryWorldRef, 0.28).normalize()

      if (coreDustMeshRef.current) {
        coreDustMeshRef.current.getWorldPosition(coreDustWorldPosRef)
        const cameraDistance = camera.position.distanceTo(coreDustWorldPosRef)
        const nearDistance = coreDustRadius * 1.9
        const farDistance = coreDustRadius * 7.2
        const distanceBlend = smoothstep(nearDistance, farDistance, cameraDistance)
        const minSteps = reducedMotion ? 8 : 7
        const maxSteps = reducedMotion ? 13 : 20
        const targetStepBudget = THREE.MathUtils.lerp(minSteps, maxSteps, distanceBlend)
        const stepBudgetLerp = 1 - Math.exp(-(reducedMotion ? 4.2 : 3.2) * frameDelta)
        coreDustStepBudgetRef.current = THREE.MathUtils.lerp(
          coreDustStepBudgetRef.current,
          targetStepBudget,
          stepBudgetLerp,
        )
        detailQuality = THREE.MathUtils.lerp(reducedMotion ? 0.54 : 0.48, reducedMotion ? 0.82 : 0.92, distanceBlend)

        coreDustCameraLocalRef.copy(camera.position)
        coreDustMeshRef.current.worldToLocal(coreDustCameraLocalRef)

        coreDustMeshRef.current.getWorldQuaternion(coreDustWorldQuatRef)
        coreDustWorldQuatInverseRef.copy(coreDustWorldQuatRef).invert()
        coreDustWindPrimaryLocalRef.copy(coreDustWindPrimaryWorldRef).applyQuaternion(coreDustWorldQuatInverseRef).normalize()
        coreDustWindSecondaryLocalRef.copy(coreDustWindSecondaryWorldRef).applyQuaternion(coreDustWorldQuatInverseRef).normalize()
        coreDustLightLocalRef.copy(coreDustLightWorldRef).applyQuaternion(coreDustWorldQuatInverseRef).normalize()

        coreDustMaterial.uniforms.uCameraLocal.value.copy(coreDustCameraLocalRef)
        coreDustMaterial.uniforms.uLightDirLocal.value.copy(coreDustLightLocalRef)
        coreDustMaterial.uniforms.uWindPrimary.value.copy(coreDustWindPrimaryLocalRef)
        coreDustMaterial.uniforms.uWindSecondary.value.copy(coreDustWindSecondaryLocalRef)
      }

      coreDustMaterial.uniforms.uTime.value = elapsed
      coreDustMaterial.uniforms.uColor.value.copy(secondaryColor).lerp(accentColor, 0.42)
      coreDustMaterial.uniforms.uSecondary.value.copy(accentColor).lerp(secondaryColor, 0.26)
      coreDustMaterial.uniforms.uIntensity.value = intensity * silhouetteProfile.core
      coreDustMaterial.uniforms.uRadius.value = coreDustRadius
      coreDustMaterial.uniforms.uDensity.value = coreDustProfile.density * (0.72 + intensity * 0.9)
      coreDustMaterial.uniforms.uDetail.value = coreDustProfile.detail * detailQuality
      coreDustMaterial.uniforms.uNoiseScale.value = coreDustProfile.noiseScale * (0.74 + detailQuality * 0.24)
      coreDustMaterial.uniforms.uNoiseSpeed.value = coreDustProfile.noiseSpeed * (reducedMotion ? 0.5 : 1)
      coreDustMaterial.uniforms.uStepCount.value = coreDustStepBudgetRef.current
      coreDustMaterial.uniforms.uFeather.value = coreDustProfile.feather
      coreDustMaterial.uniforms.uOpacity.value =
        coreDustProfile.opacity * (0.28 + intensity * 0.5) * silhouetteProfile.core * (reducedMotion ? 0.9 : 1)
    }

    if (accentPrimaryMaterialRef.current) {
      accentPrimaryMaterialRef.current.opacity = accentBaseOpacity.primary * silhouetteProfile.ringsPrimary * intensity
    }

    if (accentSecondaryMaterialRef.current) {
      accentSecondaryMaterialRef.current.opacity = accentBaseOpacity.secondary * silhouetteProfile.ringsSecondary * intensity
    }
  }, -2)

  return (
    <group ref={groupRef} position={project.coordinates}>
      <mesh
        ref={shellOcclusionRef}
        renderOrder={-11}
        frustumCulled={false}
        rotation={
          style.kind === 'pulse'
            ? [Math.PI / 4, Math.PI / 3, 0]
            : [0, 0, 0]
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
          style.kind === 'pulse'
            ? [Math.PI / 4, Math.PI / 3, 0]
            : [0, 0, 0]
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

      {style.kind === 'storm' && (
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

      {style.kind === 'harmonic' && (
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

      {style.kind === 'pulse' && (
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
          style.kind === 'pulse'
            ? [Math.PI / 4, Math.PI / 3, 0]
            : [0, 0, 0]
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

      <mesh ref={coreStarBlockerRef} renderOrder={-27} frustumCulled={false}>
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

      <mesh ref={coreRef} renderOrder={-12} scale={style.shellScale * 0.36}>
        <HeroCoreGeometry kind={style.kind} />
        <shaderMaterial
          ref={coreMaterialRef}
          uniforms={coreUniforms}
          vertexShader={CORE_VERTEX_SHADER}
          fragmentShader={CORE_FRAGMENT_SHADER}
          transparent
          depthTest={false}
          depthWrite={false}
          blending={THREE.NormalBlending}
          toneMapped={false}
        />
      </mesh>

      <mesh
        ref={shellRef}
        renderOrder={-12}
        rotation={
          style.kind === 'pulse'
            ? [Math.PI / 4, Math.PI / 3, 0]
            : [0, 0, 0]
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
          blending={THREE.AdditiveBlending}
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

      {style.kind === 'storm' && (
        <group ref={shellAccentRef}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.65, 0.018, 16, 120]} />
            <meshBasicMaterial
              ref={accentPrimaryMaterialRef}
              color={style.accent}
              transparent
              opacity={0.22}
              depthTest={false}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
          <mesh rotation={[Math.PI / 2, Math.PI / 5, 0]}>
            <torusGeometry args={[1.37, 0.015, 16, 120]} />
            <meshBasicMaterial
              ref={accentSecondaryMaterialRef}
              color={style.secondary}
              transparent
              opacity={0.18}
              depthTest={false}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        </group>
      )}

      {style.kind === 'harmonic' && (
        <group ref={shellAccentRef}>
          <mesh rotation={[Math.PI / 2, 0.06, 0]}>
            <torusGeometry args={[1.65, 0.018, 12, 120]} />
            <meshBasicMaterial
              ref={accentPrimaryMaterialRef}
              color={style.accent}
              transparent
              opacity={0.24}
              depthTest={false}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
          <mesh rotation={[Math.PI / 2, Math.PI / 5, 0]}>
            <torusGeometry args={[1.37, 0.015, 12, 120]} />
            <meshBasicMaterial
              ref={accentSecondaryMaterialRef}
              color={style.secondary}
              transparent
              opacity={0.2}
              depthTest={false}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        </group>
      )}

      {style.kind === 'pulse' && (
        <group ref={shellAccentRef}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.37, 0.018, 10, 90]} />
            <meshBasicMaterial
              ref={accentPrimaryMaterialRef}
              color={style.accent}
              transparent
              opacity={0.22}
              depthTest={false}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
          <mesh rotation={[Math.PI / 2, Math.PI / 5, 0]}>
            <torusGeometry args={[1.65, 0.014, 10, 90]} />
            <meshBasicMaterial
              ref={accentSecondaryMaterialRef}
              color={style.secondary}
              transparent
              opacity={0.18}
              depthTest={false}
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
            toneMapped={false}
          />
        </mesh>
      </group>

      <mesh ref={streamRibbonRef} geometry={etherealFilaments.geometry} renderOrder={-9} frustumCulled={false}>
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
          <bufferAttribute attach="attributes-position" args={[streamParticles.positions, 3]} />
          <bufferAttribute attach="attributes-aSize" args={[streamParticles.sizes, 1]} />
          <bufferAttribute attach="attributes-aFlicker" args={[streamParticles.flickers, 1]} />
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
  )
}

function CinematicBloom({ project, reducedMotion }: CinematicBloomProps) {
  const { gl, scene, camera, size } = useThree()
  const composerRef = useRef<EffectComposer | null>(null)
  const bloomRef = useRef<UnrealBloomPass | null>(null)
  const rgbShiftRef = useRef<ShaderPass | null>(null)
  const vignetteRef = useRef<ShaderPass | null>(null)
  const filmRef = useRef<FilmPass | null>(null)

  useEffect(() => {
    const renderPass = new RenderPass(scene, camera)
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(size.width, size.height), 0.66, 0.5, 0.41)
    const rgbShiftPass = new ShaderPass(RGBShiftShader)
    const vignettePass = new ShaderPass(VignetteShader)
    const filmPass = new FilmPass(0.008, 0, 0, false)
    const composerTarget = new THREE.WebGLRenderTarget(size.width, size.height, {
      depthBuffer: true,
      stencilBuffer: true,
    })
    if ('samples' in composerTarget) {
      composerTarget.samples = Math.min(4, gl.capabilities.maxSamples)
    }

    const rgbUniforms = rgbShiftPass.uniforms as Record<string, THREE.IUniform<number>>
    rgbUniforms.amount.value = 0.00012
    rgbUniforms.angle.value = 0.22

    const vignetteUniforms = vignettePass.uniforms as Record<string, THREE.IUniform<number>>
    vignetteUniforms.offset.value = 1.04
    vignetteUniforms.darkness.value = 1.08

    const filmUniforms = filmPass.uniforms as Record<string, THREE.IUniform<number>>
    filmUniforms.nIntensity.value = 0.004
    filmUniforms.sIntensity.value = 0
    filmUniforms.sCount.value = 0

    const composer = new EffectComposer(gl, composerTarget)
    composer.addPass(renderPass)
    composer.addPass(bloomPass)
    composer.addPass(rgbShiftPass)
    composer.addPass(vignettePass)
    composer.addPass(filmPass)

    composerRef.current = composer
    bloomRef.current = bloomPass
    rgbShiftRef.current = rgbShiftPass
    vignetteRef.current = vignettePass
    filmRef.current = filmPass

    return () => {
      composer.dispose()
      composerTarget.dispose()
      composerRef.current = null
      bloomRef.current = null
      rgbShiftRef.current = null
      vignetteRef.current = null
      filmRef.current = null
    }
  }, [camera, gl, scene, size.height, size.width])

  useEffect(() => {
    const bloomPass = bloomRef.current
    const rgbShiftPass = rgbShiftRef.current
    const vignettePass = vignetteRef.current
    const filmPass = filmRef.current

    if (!bloomPass || !rgbShiftPass || !vignettePass || !filmPass) {
      return
    }

    const rgbUniforms = rgbShiftPass.uniforms as Record<string, THREE.IUniform<number>>
    const vignetteUniforms = vignettePass.uniforms as Record<string, THREE.IUniform<number>>
    const filmUniforms = filmPass.uniforms as Record<string, THREE.IUniform<number>>

    if (!project) {
      bloomPass.strength = reducedMotion ? 0.4 : 0.48
      bloomPass.radius = 0.46
      bloomPass.threshold = 0.5
      rgbUniforms.amount.value = 0.00008
      vignetteUniforms.darkness.value = 1.06
      filmUniforms.nIntensity.value = reducedMotion ? 0.001 : 0.003
    } else if (project.id === 'gpgpu-particles') {
      bloomPass.strength = reducedMotion ? 0.54 : 0.68
      bloomPass.radius = 0.56
      bloomPass.threshold = 0.39
      rgbUniforms.amount.value = 0.00014
      vignetteUniforms.darkness.value = 1.04
      filmUniforms.nIntensity.value = reducedMotion ? 0.0015 : 0.0038
    } else if (project.id === 'voyce') {
      bloomPass.strength = reducedMotion ? 0.48 : 0.6
      bloomPass.radius = 0.52
      bloomPass.threshold = 0.41
      rgbUniforms.amount.value = 0.00012
      vignetteUniforms.darkness.value = 1.04
      filmUniforms.nIntensity.value = reducedMotion ? 0.0014 : 0.0034
    } else {
      bloomPass.strength = reducedMotion ? 0.52 : 0.64
      bloomPass.radius = 0.54
      bloomPass.threshold = 0.4
      rgbUniforms.amount.value = 0.00013
      vignetteUniforms.darkness.value = 1.05
      filmUniforms.nIntensity.value = reducedMotion ? 0.0015 : 0.0036
    }
  }, [project, reducedMotion])

  useFrame(({ clock }, delta) => {
    const elapsed = clock.getElapsedTime()
    const rgbShiftPass = rgbShiftRef.current
    const vignettePass = vignetteRef.current

    if (rgbShiftPass) {
      const rgbUniforms = rgbShiftPass.uniforms as Record<string, THREE.IUniform<number>>
      rgbUniforms.angle.value = 0.2 + Math.sin(elapsed * 0.09) * 0.03
    }

    if (vignettePass) {
      const vignetteUniforms = vignettePass.uniforms as Record<string, THREE.IUniform<number>>
      vignetteUniforms.offset.value = 1.03 + Math.sin(elapsed * 0.06) * 0.015
    }

    composerRef.current?.render(delta)
  }, 1)

  return null
}

function CameraRig({
  projects,
  activeProject,
  controlsRef,
  reducedMotion,
  onTransitionHalfway,
  onTransitionProgress,
}: CameraRigProps) {
  const { camera, size } = useThree()

  const startTargetRef = useRef(new THREE.Vector3())
  const startCameraRef = useRef(new THREE.Vector3())
  const endTargetRef = useRef(new THREE.Vector3())
  const endCameraRef = useRef(new THREE.Vector3())

  const startOffsetDirectionRef = useRef(new THREE.Vector3(0, 0, 1))
  const endOffsetDirectionRef = useRef(new THREE.Vector3(0, 0, 1))
  const startOffsetRadiusRef = useRef(1)
  const endOffsetRadiusRef = useRef(1)

  const activeAnchorRef = useRef(new THREE.Vector3())
  const transitionTargetRef = useRef(new THREE.Vector3())
  const transitionDirectionRef = useRef(new THREE.Vector3())
  const fallbackAxisRef = useRef(new THREE.Vector3(1, 0, 0))
  const introSwayAxisRef = useRef(new THREE.Vector3(1, 0, 0))

  const orbitCameraOffsetRef = useRef(new THREE.Vector3())
  const orbitTargetOffsetRef = useRef(new THREE.Vector3())

  const progressRef = useRef(1)
  const isTransitioningRef = useRef(true)
  const isInitialNeutralTransitionRef = useRef(false)
  const hasInitializedRef = useRef(false)
  const transitionModeRef = useRef<'neutral-intro' | 'neutral-to-focus' | 'focus-to-neutral' | 'focus-to-focus'>(
    'focus-to-focus',
  )
  const previousActiveProjectIdRef = useRef<string | null>(activeProject?.id ?? null)
  const isUserInteractingRef = useRef(false)
  const halfwayNotifiedRef = useRef(false)
  const wasDampingEnabledRef = useRef(true)
  const orbitResumeRef = useRef(1)
  const arrivalHoldRef = useRef(0)

  useEffect(() => {
    const controls = controlsRef.current

    if (!controls) {
      return
    }

    wasDampingEnabledRef.current = controls.enableDamping

    const onStart = () => {
      isUserInteractingRef.current = true
    }

    const onEnd = () => {
      isUserInteractingRef.current = false
    }

    controls.addEventListener('start', onStart)
    controls.addEventListener('end', onEnd)

    return () => {
      controls.removeEventListener('start', onStart)
      controls.removeEventListener('end', onEnd)
    }
  }, [controlsRef])

  useEffect(() => {
    const controls = controlsRef.current

    if (projects.length === 0) {
      return
    }

    const perspectiveCamera = camera as THREE.PerspectiveCamera
    const isNeutral = activeProject === null
    const overallCentroid = new THREE.Vector3()
    projects.forEach((project) => {
      overallCentroid.add(new THREE.Vector3(...project.coordinates))
    })
    overallCentroid.multiplyScalar(1 / projects.length)

    const active = isNeutral ? overallCentroid.clone() : new THREE.Vector3(...activeProject.coordinates)

    const selectedProjectId = activeProject?.id ?? null
    let focusRadius = 1

    if (activeProject) {
      focusRadius = getFocusRadius(activeProject)
    }

    const sameSelectionWhileTransitioning =
      hasInitializedRef.current && isTransitioningRef.current && previousActiveProjectIdRef.current === selectedProjectId

    if (sameSelectionWhileTransitioning) {
      return
    }

    if (isNeutral) {
      let maxDistanceFromCentroid = 0
      projects.forEach((project) => {
        maxDistanceFromCentroid = Math.max(
          maxDistanceFromCentroid,
          new THREE.Vector3(...project.coordinates).distanceTo(active),
        )
      })
      focusRadius = Math.max(2.2, maxDistanceFromCentroid + 0.8)
    }

    const fovRad = THREE.MathUtils.degToRad(perspectiveCamera.fov)

    const others = isNeutral || !selectedProjectId ? projects : projects.filter((project) => project.id !== selectedProjectId)
    const centroid = new THREE.Vector3()
    let maxDistanceToOthers = 0

    if (others.length > 0) {
      others.forEach((project) => {
        const point = new THREE.Vector3(...project.coordinates)
        centroid.add(point)
        maxDistanceToOthers = Math.max(maxDistanceToOthers, point.distanceTo(active))
      })
      centroid.multiplyScalar(1 / others.length)
    } else {
      centroid.copy(active).add(new THREE.Vector3(1, 0.2, 0.5))
    }

    const towardOthers = centroid.clone().sub(active)

    if (isNeutral) {
      towardOthers.set(0.18, -0.08, -0.98).normalize()
    } else {
      if (towardOthers.lengthSq() < 0.0001) {
        towardOthers.set(1, 0.2, 0.6)
      }
      towardOthers.normalize()
    }

    let yawOffset = 0
    let distanceScale = 1
    let verticalBoost = 0

    if (isNeutral) {
      distanceScale = 1.22
      verticalBoost = 0.14
    } else if (selectedProjectId === 'voyce') {
      yawOffset = 0.46
      distanceScale = 0.9
      verticalBoost = 0.1
    } else if (selectedProjectId === 'gpgpu-particles') {
      yawOffset = 0.14
      distanceScale = 0.88
    } else {
      yawOffset = 0.2
      distanceScale = 0.86
      verticalBoost = 0.05
    }

    if (!isNeutral) {
      towardOthers.applyAxisAngle(WORLD_UP, yawOffset).normalize()
    }

    const side = new THREE.Vector3().crossVectors(WORLD_UP, towardOthers)

    if (side.lengthSq() < 0.0001) {
      side.copy(X_AXIS)
    }

    side.normalize()

    const desiredFill = isNeutral ? (size.width < 900 ? 0.66 : 0.72) : size.width < 900 ? 0.78 : 0.92
    const fillDistance = (2 * focusRadius) / (desiredFill * Math.tan(fovRad / 2))
    const spreadAllowance = Math.min(1.2, maxDistanceToOthers * 0.18)
    const distance = THREE.MathUtils.clamp(
      (fillDistance + spreadAllowance) * distanceScale,
      isNeutral ? (size.width < 900 ? 5.0 : 5.8) : size.width < 900 ? 3.8 : 4.5,
      isNeutral ? (size.width < 900 ? 7.4 : 8.6) : size.width < 900 ? 5.8 : 6.8,
    )

    const sideAmount = isNeutral ? (size.width < 900 ? 0.22 : 0.28) : size.width < 900 ? 0.4 : 0.52 + maxDistanceToOthers * 0.12
    const verticalLift = (size.width < 900 ? 0.42 : 0.6) + verticalBoost

    const target = active.clone()
    const baseCameraPosition = active.clone().sub(towardOthers.clone().multiplyScalar(distance))
    const plusSide = baseCameraPosition.clone().add(side.clone().multiplyScalar(sideAmount)).add(new THREE.Vector3(0, verticalLift, 0))
    const minusSide = baseCameraPosition.clone().add(side.clone().multiplyScalar(-sideAmount)).add(new THREE.Vector3(0, verticalLift, 0))

    const currentOffsetFromActive = camera.position.clone().sub(active)

    if (currentOffsetFromActive.lengthSq() < 0.0001) {
      currentOffsetFromActive.set(0, 0, 1)
    }

    const plusAngle = currentOffsetFromActive.angleTo(plusSide.clone().sub(active))
    const minusAngle = currentOffsetFromActive.angleTo(minusSide.clone().sub(active))
    const cameraPosition = isNeutral ? plusSide : plusAngle <= minusAngle ? plusSide : minusSide

    const viewDirection = target.clone().sub(cameraPosition).normalize()
    const cameraRight = new THREE.Vector3().crossVectors(viewDirection, WORLD_UP).normalize()
    const cameraUp = new THREE.Vector3().crossVectors(cameraRight, viewDirection).normalize()

    let desiredNdcX = isNeutral ? -0.01 : -0.03
    const desiredNdcY = isNeutral ? (size.width < 900 ? 0 : 0.04) : size.width < 900 ? -0.02 : 0.02

    if (size.width >= 900) {
      const panelElement = document.querySelector('.hud-panel') as HTMLElement | null

      if (panelElement) {
        const panelRect = panelElement.getBoundingClientRect()
        const safeRightEdge = Math.max(220, panelRect.left - 24)
        const remainderCenterX = Math.min(safeRightEdge - 24, safeRightEdge * 0.5 + 96)
        desiredNdcX = (remainderCenterX / Math.max(size.width, 1)) * 2 - 1
      }
    }

    const verticalHalf = distance * Math.tan(fovRad / 2)
    const horizontalHalf = verticalHalf * perspectiveCamera.aspect

    const lookOffset = new THREE.Vector3()
      .addScaledVector(cameraRight, -desiredNdcX * horizontalHalf)
      .addScaledVector(cameraUp, -desiredNdcY * verticalHalf)

    target.add(lookOffset)

    const shouldUseInitialNeutralTransition = !hasInitializedRef.current && isNeutral && !reducedMotion

    const nextActiveProjectId = activeProject?.id ?? null
    const previousActiveProjectId = previousActiveProjectIdRef.current

    if (shouldUseInitialNeutralTransition) {
      const finalViewDirection = cameraPosition.clone().sub(target).normalize()
      const introSide = new THREE.Vector3().crossVectors(finalViewDirection, WORLD_UP)

      if (introSide.lengthSq() < 0.0001) {
        introSide.copy(X_AXIS)
      }

      introSide.normalize()
      introSwayAxisRef.current.copy(introSide)

      const introDistance = size.width < 900 ? 1.6 : 2.2
      const introSideOffset = size.width < 900 ? -0.22 : -0.36
      const introLift = size.width < 900 ? 0.24 : 0.34

      startCameraRef.current
        .copy(cameraPosition)
        .addScaledVector(finalViewDirection, introDistance)
        .addScaledVector(introSide, introSideOffset)
        .addScaledVector(WORLD_UP, introLift)

      startTargetRef.current
        .copy(target)
        .addScaledVector(introSide, introSideOffset * 0.7)
        .addScaledVector(WORLD_UP, introLift * 0.44)

      isInitialNeutralTransitionRef.current = true
      transitionModeRef.current = 'neutral-intro'
    } else {
      startTargetRef.current.copy(controls?.target ?? active)
      startCameraRef.current.copy(camera.position)
      isInitialNeutralTransitionRef.current = false

      if (previousActiveProjectId === null && nextActiveProjectId !== null) {
        transitionModeRef.current = 'neutral-to-focus'
      } else if (previousActiveProjectId !== null && nextActiveProjectId === null) {
        transitionModeRef.current = 'focus-to-neutral'
      } else {
        transitionModeRef.current = 'focus-to-focus'
      }
    }

    endTargetRef.current.copy(target)
    endCameraRef.current.copy(cameraPosition)
    activeAnchorRef.current.copy(active)
    hasInitializedRef.current = true
    previousActiveProjectIdRef.current = nextActiveProjectId

    const startOffset = startCameraRef.current.clone().sub(startTargetRef.current)
    const endOffset = endCameraRef.current.clone().sub(endTargetRef.current)

    if (startOffset.lengthSq() < 0.0001) {
      startOffset.copy(endOffset.lengthSq() < 0.0001 ? new THREE.Vector3(0, 0, 1) : endOffset)
    }

    if (endOffset.lengthSq() < 0.0001) {
      endOffset.copy(startOffset)
    }

    startOffsetRadiusRef.current = Math.max(startOffset.length(), 0.001)
    endOffsetRadiusRef.current = Math.max(endOffset.length(), 0.001)
    startOffsetDirectionRef.current.copy(startOffset.normalize())
    endOffsetDirectionRef.current.copy(endOffset.normalize())

    progressRef.current = 0
    isTransitioningRef.current = true
    isUserInteractingRef.current = false
    halfwayNotifiedRef.current = false
    orbitResumeRef.current = 0
    arrivalHoldRef.current = 0
    onTransitionProgress?.(0)
  }, [activeProject, projects, size.width, size.height, camera, controlsRef, onTransitionProgress])

  useFrame((_state, delta) => {
    const controls = controlsRef.current

    if (!controls) {
      return
    }

    if (!isTransitioningRef.current) {
      controls.enabled = true
      controls.enableDamping = wasDampingEnabledRef.current
      const frameDelta = reducedMotion ? delta : Math.min(delta, 1 / 30)

      if (arrivalHoldRef.current > 0) {
        arrivalHoldRef.current = Math.max(0, arrivalHoldRef.current - frameDelta)
        controls.update()
        return
      }

      if (!reducedMotion && !isUserInteractingRef.current && activeProject) {
        orbitResumeRef.current = THREE.MathUtils.clamp(orbitResumeRef.current + frameDelta * 1.6, 0, 1)
        const orbitBlend = easeInOutCubic(orbitResumeRef.current)
        const orbitSpeed = size.width < 900 ? 0.08 : 0.055
        const theta = frameDelta * orbitSpeed * orbitBlend

        orbitCameraOffsetRef.current.copy(camera.position).sub(activeAnchorRef.current)
        orbitTargetOffsetRef.current.copy(controls.target).sub(activeAnchorRef.current)

        orbitCameraOffsetRef.current.applyAxisAngle(WORLD_UP, theta)
        orbitTargetOffsetRef.current.applyAxisAngle(WORLD_UP, theta)

        camera.position.copy(activeAnchorRef.current).add(orbitCameraOffsetRef.current)
        controls.target.copy(activeAnchorRef.current).add(orbitTargetOffsetRef.current)
      } else {
        orbitResumeRef.current = THREE.MathUtils.clamp(orbitResumeRef.current - frameDelta * 2.2, 0, 1)
      }

      controls.update()
      return
    }

    controls.enabled = false
    controls.enableDamping = false

    const frameDelta = reducedMotion ? delta : Math.min(delta, 1 / 30)
    const transitionMode = transitionModeRef.current
    const duration = reducedMotion
      ? 0.01
      : transitionMode === 'neutral-intro'
        ? size.width < 900
          ? 2.0
          : 2.25
        : transitionMode === 'neutral-to-focus'
          ? size.width < 900
            ? 1.46
            : 1.72
          : transitionMode === 'focus-to-neutral'
            ? size.width < 900
              ? 1.52
              : 1.84
        : size.width < 900
          ? 1.75
          : 2.35
    const nextProgress = Math.min(1, progressRef.current + frameDelta / duration)
    progressRef.current = nextProgress
    onTransitionProgress?.(nextProgress)

    if (!halfwayNotifiedRef.current && nextProgress >= 0.5) {
      halfwayNotifiedRef.current = true
      onTransitionHalfway?.()
    }

    let eased = easeInOutSine(nextProgress)

    if (transitionMode === 'neutral-intro') {
      eased = smoothstep(0, 1, nextProgress)
    } else if (transitionMode === 'focus-to-focus') {
      eased = easeInOutCubic(nextProgress)
    }
    const arcLift = reducedMotion
      ? 0
      : transitionMode === 'neutral-intro'
        ? Math.sin(Math.PI * eased) * (size.width < 900 ? 0.04 : 0.08)
        : transitionMode === 'neutral-to-focus'
          ? Math.sin(Math.PI * eased) * (size.width < 900 ? 0.06 : 0.15)
          : transitionMode === 'focus-to-neutral'
            ? Math.sin(Math.PI * eased) * (size.width < 900 ? 0.06 : 0.15)
        : Math.sin(Math.PI * eased) * (size.width < 900 ? 0.08 : 0.24)

    transitionTargetRef.current.lerpVectors(startTargetRef.current, endTargetRef.current, eased)
    controls.target.copy(transitionTargetRef.current)

    const startDirection = startOffsetDirectionRef.current
    const endDirection = endOffsetDirectionRef.current
    const dot = THREE.MathUtils.clamp(startDirection.dot(endDirection), -1, 1)

    if (dot > 0.9995) {
      transitionDirectionRef.current.lerpVectors(startDirection, endDirection, eased).normalize()
    } else if (dot < -0.9995) {
      fallbackAxisRef.current.crossVectors(WORLD_UP, startDirection)

      if (fallbackAxisRef.current.lengthSq() < 0.0001) {
        fallbackAxisRef.current.crossVectors(X_AXIS, startDirection)
      }

      fallbackAxisRef.current.normalize()
      transitionDirectionRef.current.copy(startDirection).applyAxisAngle(fallbackAxisRef.current, Math.PI * eased).normalize()
    } else {
      const theta = Math.acos(dot)
      const sinTheta = Math.sin(theta)
      const startWeight = Math.sin((1 - eased) * theta) / sinTheta
      const endWeight = Math.sin(eased * theta) / sinTheta

      transitionDirectionRef.current.copy(startDirection).multiplyScalar(startWeight).addScaledVector(endDirection, endWeight).normalize()
    }

    const radius = THREE.MathUtils.lerp(startOffsetRadiusRef.current, endOffsetRadiusRef.current, eased)
    const cinematicDolly = reducedMotion
      ? 0
      : transitionMode === 'neutral-intro'
        ? Math.sin(Math.PI * eased) * (size.width < 900 ? 0.08 : 0.14)
        : transitionMode === 'neutral-to-focus'
          ? Math.sin(Math.PI * eased) * (size.width < 900 ? 0.28 : 0.64)
          : transitionMode === 'focus-to-neutral'
            ? Math.sin(Math.PI * eased) * (size.width < 900 ? 0.28 : 0.64)
        : Math.sin(Math.PI * eased) * (size.width < 900 ? 0.44 : 0.94)

    camera.position.copy(transitionTargetRef.current).addScaledVector(transitionDirectionRef.current, radius + cinematicDolly)
    if (transitionMode === 'neutral-intro') {
      const introSway = Math.sin(Math.PI * eased) * (size.width < 900 ? 0.035 : 0.055)
      camera.position.addScaledVector(introSwayAxisRef.current, introSway)
    }
    camera.position.addScaledVector(WORLD_UP, arcLift)
    camera.lookAt(transitionTargetRef.current)
    camera.updateMatrixWorld()

    if (nextProgress >= 1) {
      if (!halfwayNotifiedRef.current) {
        halfwayNotifiedRef.current = true
        onTransitionHalfway?.()
      }

      isTransitioningRef.current = false
      onTransitionProgress?.(1)
      orbitResumeRef.current = 0
      arrivalHoldRef.current = reducedMotion ? 0 : transitionMode === 'neutral-intro' ? 0.08 : 0.22
      isInitialNeutralTransitionRef.current = false
      controls.enabled = true
      controls.enableDamping = wasDampingEnabledRef.current
      controls.target.copy(transitionTargetRef.current)
      camera.lookAt(transitionTargetRef.current)
      camera.updateMatrixWorld()
      controls.update()
    }
  }, -1)

  return null
}

function CinematicLights({ project, reducedMotion }: { project: Project | null; reducedMotion: boolean }) {
  const keyRef = useRef<THREE.PointLight>(null)
  const rimRef = useRef<THREE.PointLight>(null)
  const fillRef = useRef<THREE.PointLight>(null)
  const hemiRef = useRef<THREE.HemisphereLight>(null)

  const palette = useMemo(() => {
    if (!project) {
      return {
        key: '#8fb9ef',
        rim: '#6a8bc5',
        fill: '#9db1d0',
        hemiSky: '#a8c6ee',
        hemiGround: '#091321',
        keyIntensity: 1.1,
        rimIntensity: 0.52,
        fillIntensity: 0.42,
      }
    }

    if (project.id === 'gpgpu-particles') {
      return {
        key: '#88c9ff',
        rim: '#5a86ff',
        fill: '#9ebce3',
        hemiSky: '#b2d8ff',
        hemiGround: '#091324',
        keyIntensity: 1.36,
        rimIntensity: 0.72,
        fillIntensity: 0.58,
      }
    }

    if (project.id === 'voyce') {
      return {
        key: '#8cf5d8',
        rim: '#4fbf98',
        fill: '#9dd9c9',
        hemiSky: '#b0ffea',
        hemiGround: '#081a1c',
        keyIntensity: 1.28,
        rimIntensity: 0.68,
        fillIntensity: 0.54,
      }
    }

    return {
      key: '#ffc58f',
      rim: '#dd8f50',
      fill: '#e6bb94',
      hemiSky: '#ffe0bf',
      hemiGround: '#1a1009',
      keyIntensity: 1.34,
      rimIntensity: 0.7,
      fillIntensity: 0.55,
    }
  }, [project])

  useEffect(() => {
    if (keyRef.current) {
      keyRef.current.color.set(palette.key)
    }

    if (rimRef.current) {
      rimRef.current.color.set(palette.rim)
    }

    if (fillRef.current) {
      fillRef.current.color.set(palette.fill)
    }

    if (hemiRef.current) {
      hemiRef.current.color.set(palette.hemiSky)
      hemiRef.current.groundColor.set(palette.hemiGround)
    }
  }, [palette])

  useFrame(({ clock }) => {
    const pulse = reducedMotion ? 0 : (Math.sin(clock.getElapsedTime() * 1.2) + 1) * 0.5

    if (keyRef.current) {
      keyRef.current.intensity = THREE.MathUtils.lerp(keyRef.current.intensity, palette.keyIntensity * (0.92 + pulse * 0.12), 0.08)
    }

    if (rimRef.current) {
      rimRef.current.intensity = THREE.MathUtils.lerp(rimRef.current.intensity, palette.rimIntensity * (0.9 + pulse * 0.12), 0.08)
    }

    if (fillRef.current) {
      fillRef.current.intensity = THREE.MathUtils.lerp(fillRef.current.intensity, palette.fillIntensity * (0.9 + pulse * 0.1), 0.08)
    }
  })

  return (
    <>
      <ambientLight intensity={0.34} />
      <hemisphereLight ref={hemiRef} args={[palette.hemiSky, palette.hemiGround, 0.4]} />
      <pointLight ref={keyRef} position={[6, 5, 4]} intensity={palette.keyIntensity} color={palette.key} />
      <pointLight ref={fillRef} position={[-6, -2.5, -3]} intensity={palette.fillIntensity} color={palette.fill} />
      <pointLight ref={rimRef} position={[0, 3, -7]} intensity={palette.rimIntensity} color={palette.rim} />
    </>
  )
}

function NeutralStarField({ reducedMotion }: { reducedMotion: boolean }) {
  const baseGroupRef = useRef<THREE.Group>(null)
  const midGroupRef = useRef<THREE.Group>(null)
  const overlayGroupRef = useRef<THREE.Group>(null)
  const baseMeshRef = useRef<THREE.InstancedMesh>(null)
  const midMeshRef = useRef<THREE.InstancedMesh>(null)
  const overlayMeshRef = useRef<THREE.InstancedMesh>(null)
  const nebulaNearRef = useRef<THREE.Mesh>(null)
  const nebulaFarRef = useRef<THREE.Mesh>(null)
  const nebulaNearMaterialRef = useRef<THREE.ShaderMaterial>(null)
  const nebulaFarMaterialRef = useRef<THREE.ShaderMaterial>(null)
  const scratchObject = useMemo(() => new THREE.Object3D(), [])

  const neutralBaseStars = useMemo(
    () => createNeutralStarInstances('neutral-stars-base', 1842, 122, 28, [0.026, 0.062]),
    [],
  )
  const neutralMidStars = useMemo(
    () => createNeutralStarInstances('neutral-stars-mid', 1120, 108, 22, [0.022, 0.052]),
    [],
  )
  const neutralOverlayStars = useMemo(
    () => createNeutralStarInstances('neutral-stars-overlay', 744, 94, 18, [0.038, 0.085]),
    [],
  )
  const nebulaNearUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: new THREE.Color('#294a64') },
      uOpacity: { value: 0.08 },
      uScale: { value: 3.5 },
    }),
    [],
  )
  const nebulaFarUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: new THREE.Color('#3a4d73') },
      uOpacity: { value: 0.06 },
      uScale: { value: 2.9 },
    }),
    [],
  )

  const applyInstances = useCallback(
    (mesh: THREE.InstancedMesh | null, stars: NeutralStarInstances) => {
      if (!mesh) {
        return
      }

      for (let index = 0; index < stars.count; index += 1) {
        const offset = index * 3
        scratchObject.position.set(stars.positions[offset], stars.positions[offset + 1], stars.positions[offset + 2])
        scratchObject.scale.setScalar(stars.scales[index])
        scratchObject.updateMatrix()
        mesh.setMatrixAt(index, scratchObject.matrix)
      }

      mesh.instanceMatrix.needsUpdate = true
    },
    [scratchObject],
  )

  useLayoutEffect(() => {
    applyInstances(baseMeshRef.current, neutralBaseStars)
    applyInstances(midMeshRef.current, neutralMidStars)
    applyInstances(overlayMeshRef.current, neutralOverlayStars)
  }, [applyInstances, neutralBaseStars, neutralMidStars, neutralOverlayStars])

  useFrame(({ clock }) => {
    const elapsed = clock.getElapsedTime()

    if (baseGroupRef.current) {
      baseGroupRef.current.rotation.y = reducedMotion ? 0 : elapsed * 0.006
      baseGroupRef.current.rotation.x = reducedMotion ? 0 : Math.sin(elapsed * 0.03) * 0.012
    }

    if (midGroupRef.current) {
      midGroupRef.current.rotation.y = reducedMotion ? 0 : -elapsed * 0.0054 + 0.22
      midGroupRef.current.rotation.x = reducedMotion ? 0 : Math.sin(elapsed * 0.022) * 0.014
    }

    if (overlayGroupRef.current) {
      overlayGroupRef.current.rotation.y = reducedMotion ? 0 : -elapsed * 0.0048 + 0.4
      overlayGroupRef.current.rotation.x = reducedMotion ? 0 : Math.cos(elapsed * 0.028) * 0.01
    }

    if (nebulaNearRef.current) {
      nebulaNearRef.current.rotation.z = reducedMotion ? -0.34 : -0.34 + Math.sin(elapsed * 0.045) * 0.04
      nebulaNearRef.current.rotation.y = reducedMotion ? 0.22 : 0.22 + Math.cos(elapsed * 0.032) * 0.05
    }

    if (nebulaFarRef.current) {
      nebulaFarRef.current.rotation.z = reducedMotion ? 0.2 : 0.2 + Math.sin(elapsed * 0.034) * 0.035
      nebulaFarRef.current.rotation.y = reducedMotion ? -0.18 : -0.18 + Math.cos(elapsed * 0.028) * 0.038
    }

    if (nebulaNearMaterialRef.current) {
      nebulaNearMaterialRef.current.uniforms.uTime.value = elapsed
      nebulaNearMaterialRef.current.uniforms.uOpacity.value = 0.07 + Math.sin(elapsed * 0.14) * 0.008
    }

    if (nebulaFarMaterialRef.current) {
      nebulaFarMaterialRef.current.uniforms.uTime.value = elapsed + 11
      nebulaFarMaterialRef.current.uniforms.uOpacity.value = 0.055 + Math.cos(elapsed * 0.11) * 0.007
    }
  })

  return (
    <>
      <mesh ref={nebulaFarRef} position={[6, 8, -118]} rotation={[-0.32, -0.18, 0.2]} renderOrder={-36}>
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

      <group ref={baseGroupRef} position={[0, 0, -32]} renderOrder={-30} frustumCulled={false}>
        <instancedMesh
          ref={baseMeshRef}
          args={[undefined, undefined, neutralBaseStars.count]}
          renderOrder={-30}
          frustumCulled={false}
        >
          <sphereGeometry args={[2, 10, 10]} />
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

      <group ref={midGroupRef} position={[0, 0, -32]} renderOrder={-31} frustumCulled={false}>
        <instancedMesh
          ref={midMeshRef}
          args={[undefined, undefined, neutralMidStars.count]}
          renderOrder={-31}
          frustumCulled={false}
        >
          <sphereGeometry args={[2, 10, 10]} />
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

      <group ref={overlayGroupRef} position={[0, 0, -32]} renderOrder={-29} frustumCulled={false}>
        <instancedMesh
          ref={overlayMeshRef}
          args={[undefined, undefined, neutralOverlayStars.count]}
          renderOrder={-29}
          frustumCulled={false}
        >
          <sphereGeometry args={[2, 10, 10]} />
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

      <mesh ref={nebulaNearRef} position={[-8, -6, -90]} rotation={[0.2, 0.22, -0.34]} renderOrder={-33}>
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
  )
}

function SceneContent({ projects, activeProjectId, onSelectProject, reducedMotion }: ConstellationSceneProps) {
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null)
  const [visualActiveProjectId, setVisualActiveProjectId] = useState<string | null>(activeProjectId)
  const [outgoingHeroProjectId, setOutgoingHeroProjectId] = useState<string | null>(null)
  const [transitionProgress, setTransitionProgress] = useState(1)
  const [initialRevealProgress, setInitialRevealProgress] = useState(reducedMotion ? 1 : 0)

  const controlsRef = useRef<OrbitControlsImpl | null>(null)
  const visualProjectIdRef = useRef<string | null>(activeProjectId)
  const initialRevealRef = useRef(reducedMotion ? 1 : 0)

  const connections = useMemo(() => buildConnections(projects), [projects])
  const connectionVisuals = useMemo<ConnectionVisual[]>(
    () =>
      connections.map((connection) => {
        const start = new THREE.Vector3(...connection.points[0])
        const end = new THREE.Vector3(...connection.points[1])
        const segment = end.clone().sub(start)
        const length = Math.max(segment.length(), 0.001)
        const direction = segment.clone().normalize()
        const midpoint = start.clone().addScaledVector(segment, 0.5)
        const quaternion = new THREE.Quaternion().setFromUnitVectors(WORLD_UP, direction)

        return {
          ...connection,
          midpoint: [midpoint.x, midpoint.y, midpoint.z],
          quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
          length,
        }
      }),
    [connections],
  )

  const activeProject = useMemo(
    () => (activeProjectId ? projects.find((project) => project.id === activeProjectId) ?? null : null),
    [projects, activeProjectId],
  )

  const visualActiveProject = useMemo(
    () => {
      if (!visualActiveProjectId) {
        return null
      }

      return projects.find((project) => project.id === visualActiveProjectId) ?? activeProject
    },
    [projects, visualActiveProjectId, activeProject],
  )

  const outgoingHeroProject = useMemo(
    () => (outgoingHeroProjectId ? projects.find((project) => project.id === outgoingHeroProjectId) ?? null : null),
    [projects, outgoingHeroProjectId],
  )

  const heroBlend = useMemo(
    () => (reducedMotion ? 1 : smoothstep(0.04, 0.96, transitionProgress)),
    [reducedMotion, transitionProgress],
  )

  const incomingHeroPresence = useMemo(() => {
    if (!visualActiveProjectId) {
      return 0
    }

    if (reducedMotion) {
      return 1
    }

    const isInboundTransition = Boolean(transitionProgress < 0.999 && !outgoingHeroProjectId && visualActiveProjectId)

    if (isInboundTransition) {
      return smoothstep(0.5, 0.9, transitionProgress)
    }

    const isFocusSwap = Boolean(
      transitionProgress < 0.999 &&
        outgoingHeroProjectId &&
        visualActiveProjectId &&
        outgoingHeroProjectId !== visualActiveProjectId,
    )

    if (isFocusSwap) {
      const transferProgress = clamp01((transitionProgress - 0.02) / 0.48)
      const arrivalLinkedReveal = smoothstep(0.66, 0.94, transferProgress)
      const settle = smoothstep(0.38, 0.66, transitionProgress)
      return Math.max(arrivalLinkedReveal, settle)
    }

    return transitionProgress < 0.999 ? heroBlend : 1
  }, [
    heroBlend,
    outgoingHeroProjectId,
    reducedMotion,
    transitionProgress,
    visualActiveProjectId,
  ])

  const outgoingHeroPresence = useMemo(() => {
    if (!outgoingHeroProjectId) {
      return 0
    }

    if (reducedMotion) {
      return 0
    }

    const isFocusSwap = Boolean(
      transitionProgress < 0.999 &&
        outgoingHeroProjectId &&
        visualActiveProjectId &&
        outgoingHeroProjectId !== visualActiveProjectId,
    )

    if (isFocusSwap) {
      return 1 - smoothstep(0.3, 0.62, transitionProgress)
    }

    return 1 - heroBlend
  }, [heroBlend, outgoingHeroProjectId, reducedMotion, transitionProgress, visualActiveProjectId])

  const isNeutralToFocusedTransition = useMemo(
    () => Boolean(transitionProgress < 0.999 && !outgoingHeroProjectId && visualActiveProjectId),
    [outgoingHeroProjectId, transitionProgress, visualActiveProjectId],
  )

  const isFocusedToNeutralTransition = useMemo(
    () => Boolean(transitionProgress < 0.999 && outgoingHeroProjectId && !visualActiveProjectId),
    [outgoingHeroProjectId, transitionProgress, visualActiveProjectId],
  )

  const isFocusToFocusTransition = useMemo(
    () =>
      Boolean(
        transitionProgress < 0.999 &&
          outgoingHeroProjectId &&
          visualActiveProjectId &&
          outgoingHeroProjectId !== visualActiveProjectId,
      ),
    [outgoingHeroProjectId, transitionProgress, visualActiveProjectId],
  )

  const lowFiNeutralBlendOverride = useMemo(() => {
    if (reducedMotion) {
      return null
    }

    if (isNeutralToFocusedTransition) {
      return 1 - smoothstep(0.0, 0.5, transitionProgress)
    }

    if (isFocusedToNeutralTransition) {
      return smoothstep(0.0, 0.5, transitionProgress)
    }

    return null
  }, [isFocusedToNeutralTransition, isNeutralToFocusedTransition, reducedMotion, transitionProgress])

  const nodeActiveProjectId = useMemo(() => {
    if (isNeutralToFocusedTransition && transitionProgress < 0.5) {
      return null
    }

    if (isFocusedToNeutralTransition && transitionProgress < 0.5) {
      return outgoingHeroProjectId
    }

    return visualActiveProjectId
  }, [
    isFocusedToNeutralTransition,
    isNeutralToFocusedTransition,
    outgoingHeroProjectId,
    transitionProgress,
    visualActiveProjectId,
  ])

  const mapVisibility = useMemo(() => {
    if (!visualActiveProjectId) {
      return 0.96
    }

    if (reducedMotion) {
      return 0.42
    }

    return 0.36 + (1 - smoothstep(0.08, 0.62, transitionProgress)) * 0.48
  }, [visualActiveProjectId, reducedMotion, transitionProgress])

  const fogFar = visualActiveProjectId ? 44 : 128

  const activeConnectionColor = useMemo(() => {
    if (!visualActiveProject) {
      return '#7489a8'
    }

    const color = new THREE.Color(visualActiveProject.color)
    color.offsetHSL(0, -0.08, 0.14)
    return `#${color.getHexString()}`
  }, [visualActiveProject])
  const neutralConnectionColor = '#5f7ba1'
  const focusSwapTracePath = useMemo<FocusSwapTracePath | null>(() => {
    if (!outgoingHeroProject || !visualActiveProject || outgoingHeroProject.id === visualActiveProject.id) {
      return null
    }

    const start = new THREE.Vector3(...outgoingHeroProject.coordinates)
    const end = new THREE.Vector3(...visualActiveProject.coordinates)
    const segment = end.clone().sub(start)
    const length = Math.max(segment.length(), 0.001)
    const direction = segment.clone().normalize()
    const quaternion = new THREE.Quaternion().setFromUnitVectors(WORLD_UP, direction)

    return {
      start,
      direction,
      quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
      length,
    }
  }, [outgoingHeroProject, visualActiveProject])
  const focusSwapTraceState = useMemo<FocusSwapTraceState | null>(() => {
    if (!focusSwapTracePath || !isFocusToFocusTransition) {
      return null
    }

    const lineReveal = smoothstep(0.0, 0.42, transitionProgress)
    const renderedLength = Math.max(0.001, focusSwapTracePath.length * lineReveal)
    const renderedMidpoint = focusSwapTracePath.start.clone().addScaledVector(focusSwapTracePath.direction, renderedLength * 0.5)
    const transferProgress = clamp01((transitionProgress - 0.02) / 0.48)
    const tracerProgress = smoothstep(0, 1, transferProgress)
    const tracerDistance = THREE.MathUtils.lerp(0, focusSwapTracePath.length, tracerProgress)
    const tracerMaxLength = Math.min(0.62, Math.max(0.24, focusSwapTracePath.length * 0.2))
    const halfMax = tracerMaxLength * 0.5
    const halfBoundary = Math.max(0, Math.min(tracerDistance, focusSwapTracePath.length - tracerDistance))
    const tracerHalf = Math.min(halfMax, halfBoundary)
    const tracerLength = Math.max(0.002, tracerHalf * 2)
    const tracerCenter = focusSwapTracePath.start.clone().addScaledVector(focusSwapTracePath.direction, tracerDistance)
    const fade = 1 - smoothstep(0.66, 0.9, transitionProgress)
    const tracerEnvelope = halfMax <= 0 ? 0 : smoothstep(0.0, 0.9, tracerHalf / halfMax)

    return {
      renderedMidpoint: [renderedMidpoint.x, renderedMidpoint.y, renderedMidpoint.z],
      renderedLength,
      tracerCenter: [tracerCenter.x, tracerCenter.y, tracerCenter.z],
      tracerLength,
      baseOpacity: 0.46 * fade,
      tracerOpacity: 0.94 * fade * tracerEnvelope,
    }
  }, [focusSwapTracePath, isFocusToFocusTransition, transitionProgress])
  const introRevealActive = useMemo(
    () => !reducedMotion && !visualActiveProjectId && initialRevealProgress < 0.999,
    [initialRevealProgress, reducedMotion, visualActiveProjectId],
  )

  useFrame((_state, delta) => {
    if (reducedMotion || visualActiveProjectId || initialRevealRef.current >= 1) {
      return
    }

    const frameDelta = Math.min(delta, 1 / 30)
    const duration = 2.2
    const next = Math.min(1, initialRevealRef.current + frameDelta / duration)
    initialRevealRef.current = next
    setInitialRevealProgress((previous) => (Math.abs(previous - next) > 0.002 ? next : previous))
  })

  useEffect(() => {
    const previousVisualId = visualProjectIdRef.current

    if (previousVisualId === activeProjectId) {
      return
    }

    if (reducedMotion) {
      setOutgoingHeroProjectId(null)
      setVisualActiveProjectId(activeProjectId)
      setTransitionProgress(1)
      visualProjectIdRef.current = activeProjectId
      return
    }

    setOutgoingHeroProjectId(previousVisualId)
    setVisualActiveProjectId(activeProjectId)
    setTransitionProgress(0)
    visualProjectIdRef.current = activeProjectId
  }, [activeProjectId, reducedMotion])

  useEffect(() => {
    if (reducedMotion || visualActiveProjectId) {
      initialRevealRef.current = 1
      setInitialRevealProgress(1)
    }
  }, [reducedMotion, visualActiveProjectId])

  const handleTransitionProgress = useCallback((progress: number) => {
    setTransitionProgress((previous) => {
      if (progress === 0 || progress === 1) {
        return progress
      }

      return Math.abs(previous - progress) > (reducedMotion ? 0.05 : 0.01) ? progress : previous
    })

    if (progress >= 1) {
      setOutgoingHeroProjectId(null)
    }
  }, [reducedMotion])

  const handleNodeSelect = useCallback(
    (projectId: string | null) => {
      setHoveredProjectId(null)
      onSelectProject(projectId)
    },
    [onSelectProject],
  )

  useEffect(() => {
    setHoveredProjectId(null)
  }, [activeProjectId])

  return (
    <>
      <color attach="background" args={['#070708']} />
      <fog attach="fog" args={['#070708', 10, fogFar]} />

      <CinematicLights project={visualActiveProject} reducedMotion={reducedMotion} />

      {connectionVisuals.map((connection, connectionIndex) => {
        const showAllConnections = !visualActiveProjectId && !hoveredProjectId
        const linkedToActive =
          Boolean(visualActiveProjectId) &&
          (connection.projects[0] === visualActiveProjectId || connection.projects[1] === visualActiveProjectId)
        const linkedToHover =
          Boolean(hoveredProjectId) && (connection.projects[0] === hoveredProjectId || connection.projects[1] === hoveredProjectId)
        const focusedHoverConnection = Boolean(visualActiveProjectId && hoveredProjectId && linkedToActive && linkedToHover)
        const linkedToSelection =
          visualActiveProjectId === null ? showAllConnections || linkedToHover : focusedHoverConnection

        if (!linkedToSelection) {
          return null
        }

        const lineReveal = introRevealActive
          ? smoothstep(0, 1, clamp01((initialRevealProgress - connectionIndex * 0.045) / 0.42))
          : 1

        const [sx, sy, sz] = connection.points[0]
        const [ex, ey, ez] = connection.points[1]
        const start = new THREE.Vector3(sx, sy, sz)
        const end = new THREE.Vector3(ex, ey, ez)
        const direction = end.sub(start).normalize()
        const renderedLength = Math.max(0.001, connection.length * lineReveal)
        let renderedMidpoint: Vector3 = connection.midpoint

        if (introRevealActive) {
          const center = start.clone().addScaledVector(direction, renderedLength * 0.5)
          renderedMidpoint = [center.x, center.y, center.z]
        }

        const baseOpacity = visualActiveProjectId ? mapVisibility * 0.52 : 1
        const lineOpacity = baseOpacity * (introRevealActive ? lineReveal : 1)

        const tracerProgress = introRevealActive
          ? clamp01((initialRevealProgress - 0.08 - connectionIndex * 0.05) / 0.52)
          : 1
        const tracerLength = Math.min(0.6, connection.length * 0.24)
        const tracerOpacity = introRevealActive ? (1 - smoothstep(0.7, 1, tracerProgress)) * 0.92 : 0
        const tracerStart = tracerLength * 0.5
        const tracerEnd = Math.max(tracerStart, connection.length - tracerLength * 0.5)
        const tracerDistance = THREE.MathUtils.lerp(tracerStart, tracerEnd, tracerProgress)
        const tracerCenter = start.clone().addScaledVector(direction, tracerDistance)

        return (
          <group key={connection.id}>
            <mesh position={renderedMidpoint} quaternion={connection.quaternion} renderOrder={-20}>
              <cylinderGeometry args={[0.012, 0.012, renderedLength, 8, 1, true]} />
              <meshBasicMaterial
                color={visualActiveProjectId ? activeConnectionColor : neutralConnectionColor}
                transparent={Boolean(visualActiveProjectId) || lineOpacity < 0.999}
                opacity={lineOpacity}
                depthWrite
                depthTest
                blending={THREE.NormalBlending}
                toneMapped={false}
              />
            </mesh>

            {tracerOpacity > 0.004 && (
              <mesh
                position={[tracerCenter.x, tracerCenter.y, tracerCenter.z]}
                quaternion={connection.quaternion}
                renderOrder={-19}
              >
                <cylinderGeometry args={[0.018, 0.018, tracerLength, 10, 1, true]} />
                <meshBasicMaterial
                  color="#d9ecff"
                  transparent
                  opacity={tracerOpacity}
                  depthWrite={false}
                  depthTest
                  blending={THREE.AdditiveBlending}
                  toneMapped={false}
                />
              </mesh>
            )}
          </group>
        )
      })}

      {focusSwapTracePath && focusSwapTraceState && (
        <group key={`focus-trace-${outgoingHeroProjectId ?? 'none'}-${visualActiveProjectId ?? 'none'}`}>
          {focusSwapTraceState.baseOpacity > 0.003 && (
            <mesh position={focusSwapTraceState.renderedMidpoint} quaternion={focusSwapTracePath.quaternion} renderOrder={-19}>
              <cylinderGeometry args={[0.014, 0.014, focusSwapTraceState.renderedLength, 10, 1, true]} />
              <meshBasicMaterial
                color={activeConnectionColor}
                transparent
                opacity={focusSwapTraceState.baseOpacity}
                depthWrite={false}
                depthTest
                blending={THREE.NormalBlending}
                toneMapped={false}
              />
            </mesh>
          )}

          {focusSwapTraceState.tracerOpacity > 0.003 && (
            <mesh position={focusSwapTraceState.tracerCenter} quaternion={focusSwapTracePath.quaternion} renderOrder={-18}>
              <cylinderGeometry args={[0.021, 0.021, focusSwapTraceState.tracerLength, 12, 1, true]} />
              <meshBasicMaterial
                color="#d9ecff"
                transparent
                opacity={focusSwapTraceState.tracerOpacity}
                depthWrite={false}
                depthTest
                blending={THREE.AdditiveBlending}
                toneMapped={false}
              />
            </mesh>
          )}
        </group>
      )}

      {projects.map((project, projectIndex) => {
        const nodeReveal = introRevealActive
          ? smoothstep(0, 1, clamp01((initialRevealProgress - (0.43 + projectIndex * 0.15)) / 0.34))
          : 1

        return (
        <ProjectNode
          key={project.id}
          project={project}
          isActive={project.id === nodeActiveProjectId}
          isHovered={project.id === hoveredProjectId}
          mapVisibility={mapVisibility}
          nodeDisplayMode={!visualActiveProjectId ? 'neutral' : 'background'}
          neutralBlendOverride={lowFiNeutralBlendOverride}
          introReveal={nodeReveal}
          reducedMotion={reducedMotion}
          onHover={setHoveredProjectId}
          onSelect={handleNodeSelect}
        />
        )
      })}

      {outgoingHeroProject && outgoingHeroPresence > 0.004 && (
        <HeroWorld
          key={`hero-${outgoingHeroProject.id}`}
          project={outgoingHeroProject}
          reducedMotion={reducedMotion}
          presenceTarget={outgoingHeroPresence}
          collapseParticlesOnFadeOut
        />
      )}

      {visualActiveProject && incomingHeroPresence > 0.004 && (
        <HeroWorld
          key={`hero-${visualActiveProject.id}`}
          project={visualActiveProject}
          reducedMotion={reducedMotion}
          presenceTarget={incomingHeroPresence}
          collapseParticlesOnFadeOut={false}
        />
      )}

      <mesh
        renderOrder={-15}
        frustumCulled={false}
        onAfterRender={(renderer: THREE.WebGLRenderer) => {
          renderer.clearDepth()
        }}
      >
        <planeGeometry args={[0.001, 0.001]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} depthTest={false} toneMapped={false} />
      </mesh>

      <NeutralStarField reducedMotion={reducedMotion} />

      <OrbitControls
        ref={controlsRef}
        enablePan={false}
        enableZoom
        enableRotate
        enableDamping
        dampingFactor={0.09}
        rotateSpeed={0.52}
        zoomSpeed={0.62}
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
        onTransitionProgress={handleTransitionProgress}
      />

      <CinematicBloom project={visualActiveProject} reducedMotion={reducedMotion} />
    </>
  )
}

export function ConstellationScene(props: ConstellationSceneProps) {
  return (
    <Canvas
      className="constellation-canvas"
      style={{ position: 'absolute', inset: 0 }}
      camera={{ position: [0, 1.8, 8.4], fov: 54, near: 0.1, far: 150 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false, stencil: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.5
      }}
      fallback={<div className="canvas-fallback">WebGL unavailable.</div>}
    >
      <SceneContent {...props} />
    </Canvas>
  )
}
