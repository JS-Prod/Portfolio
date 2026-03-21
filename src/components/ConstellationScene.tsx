import { Html, Line, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import * as THREE from 'three'
import { EffectComposer, RenderPass, UnrealBloomPass } from 'three-stdlib'
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

type ProjectNodeProps = {
  project: Project
  isActive: boolean
  isHovered: boolean
  mapVisibility: number
  nodeDisplayMode: 'neutral' | 'background'
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
  positions: Float32Array
  basePositions: Float32Array
  speeds: Float32Array
  phases: Float32Array
  radii: Float32Array
  sizes: Float32Array
  flickers: Float32Array
  count: number
}

type NeutralStarInstances = {
  positions: Float32Array
  scales: Float32Array
  count: number
}

type HeroWorldProps = {
  project: Project
  reducedMotion: boolean
  transitionProgress: number
}

type CinematicBloomProps = {
  project: Project | null
  reducedMotion: boolean
}

const CONNECTION_DISTANCE = 6.2
const WORLD_UP = new THREE.Vector3(0, 1, 0)
const X_AXIS = new THREE.Vector3(1, 0, 0)

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

  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 1.9);
  float edge = pow(fresnel, 2.4);
  float scan = 0.5 + 0.5 * sin((vWorldPos.y + uTime * 1.65) * 10.5);
  float shell = smoothstep(0.2, 1.0, fresnel) * (0.44 + scan * 0.56);

  vec3 color = uColor * (0.42 + scan * 0.58 + edge * 0.3);
  gl_FragColor = vec4(color, shell * (0.22 + edge * 0.12) * uIntensity);
}
`

const PARTICLE_VERTEX_SHADER = `
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
`

const PARTICLE_FRAGMENT_SHADER = `
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

  float falloff = exp(-distanceSquared * 3.25);
  float edge = smoothstep(1.0, 0.0, distanceSquared);
  float glow = falloff * edge * (0.45 + vPulse * 0.5) * (0.52 + vDepthFade * 0.48);
  vec3 color = uColor * (0.74 + vPulse * 0.2);

  gl_FragColor = vec4(color, glow * uOpacity);
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

  return { positions, scales, count }
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

function createParticleField(style: HeroStyle, seed: string): HeroParticleField {
  const count = style.swarmCount
  const positions = new Float32Array(count * 3)
  const basePositions = new Float32Array(count * 3)
  const speeds = new Float32Array(count)
  const phases = new Float32Array(count)
  const radii = new Float32Array(count)
  const sizes = new Float32Array(count)
  const flickers = new Float32Array(count)
  const random = createRandom(getHash(seed) + count)

  for (let index = 0; index < count; index += 1) {
    const offset = index * 3
    const angle = random() * Math.PI * 2
    const t = index / Math.max(count - 1, 1)

    phases[index] = random() * Math.PI * 2
    speeds[index] = 0.35 + random() * 0.85
    flickers[index] = random()
    sizes[index] = 0.78 + random() * 1.3

    if (style.kind === 'storm') {
      const phi = Math.acos(1 - 2 * random())
      const spread = 0.24 + Math.pow(random(), 1.1) * 2.25
      basePositions[offset] = Math.sin(phi) * Math.cos(angle)
      basePositions[offset + 1] = Math.cos(phi)
      basePositions[offset + 2] = Math.sin(phi) * Math.sin(angle)
      radii[index] = spread
    } else if (style.kind === 'harmonic') {
      const turns = 8.2
      const helixAngle = t * Math.PI * turns + random() * 0.35
      const radius = 0.24 + random() * 1.1
      basePositions[offset] = Math.cos(helixAngle) * radius
      basePositions[offset + 1] = (t - 0.5) * 4.1 + (random() - 0.5) * 0.2
      basePositions[offset + 2] = Math.sin(helixAngle) * radius
      radii[index] = radius
    } else {
      const spread = 0.16 + Math.pow(random(), 1.15) * 2.6
      basePositions[offset] = Math.cos(angle) * spread
      basePositions[offset + 1] = (random() - 0.5) * spread * 0.42
      basePositions[offset + 2] = Math.sin(angle) * spread
      radii[index] = spread
    }
  }

  positions.set(basePositions)

  return {
    positions,
    basePositions,
    speeds,
    phases,
    radii,
    sizes,
    flickers,
    count,
  }
}

function updateParticleField(field: HeroParticleField, style: HeroStyle, elapsed: number, intensity: number) {
  const smoothing = 0.12 + intensity * 0.08

  for (let index = 0; index < field.count; index += 1) {
    const offset = index * 3

    const bx = field.basePositions[offset]
    const by = field.basePositions[offset + 1]
    const bz = field.basePositions[offset + 2]

    const phase = field.phases[index]
    const speed = field.speeds[index]
    const radius = field.radii[index]

    if (style.kind === 'storm') {
      const spin = elapsed * 0.2 * speed + phase
      const pulse = 0.8 + Math.abs(Math.sin(elapsed * 0.6 + phase)) * (0.42 + intensity * 0.5)
      const wave = Math.sin(elapsed * 0.85 + phase) * 0.1
      const radial = radius * pulse

      const targetX = Math.cos(spin) * radial + wave
      const targetY = by * radial + Math.sin(elapsed * 0.8 + phase) * 0.16
      const targetZ = Math.sin(spin) * radial + Math.cos(elapsed * 0.7 + phase) * 0.08

      field.positions[offset] = THREE.MathUtils.lerp(field.positions[offset], targetX, smoothing)
      field.positions[offset + 1] = THREE.MathUtils.lerp(field.positions[offset + 1], targetY, smoothing)
      field.positions[offset + 2] = THREE.MathUtils.lerp(field.positions[offset + 2], targetZ, smoothing)
      continue
    }

    if (style.kind === 'harmonic') {
      const spin = elapsed * 0.58 * speed + phase
      const baseRadius = Math.max(Math.sqrt(bx * bx + bz * bz), 0.08)
      const wobble = Math.sin(elapsed * 1.0 + phase) * (0.12 + intensity * 0.1)
      const drift = 0.08 + Math.sin(elapsed * 0.7 + phase) * 0.1

      const targetX = Math.cos(spin) * (baseRadius + drift)
      const targetY = by + wobble
      const targetZ = Math.sin(spin) * (baseRadius + drift)

      field.positions[offset] = THREE.MathUtils.lerp(field.positions[offset], targetX, smoothing)
      field.positions[offset + 1] = THREE.MathUtils.lerp(field.positions[offset + 1], targetY, smoothing)
      field.positions[offset + 2] = THREE.MathUtils.lerp(field.positions[offset + 2], targetZ, smoothing)
      continue
    }

    const beat = 0.84 + (Math.sin(elapsed * 0.95 + phase) * 0.5 + 0.5) * (0.42 + intensity * 0.36)
    const spin = elapsed * 0.18 * speed
    const cos = Math.cos(spin)
    const sin = Math.sin(spin)
    const sx = bx * cos - bz * sin
    const sz = bx * sin + bz * cos

    const targetX = sx * beat
    const targetY = by * (0.82 + beat * 0.34) + Math.sin(elapsed * 0.85 + phase) * 0.07
    const targetZ = sz * beat

    field.positions[offset] = THREE.MathUtils.lerp(field.positions[offset], targetX, smoothing)
    field.positions[offset + 1] = THREE.MathUtils.lerp(field.positions[offset + 1], targetY, smoothing)
    field.positions[offset + 2] = THREE.MathUtils.lerp(field.positions[offset + 2], targetZ, smoothing)
  }
}

function createCirclePoints(radius: number, segments: number, tilt = 0): Vector3[] {
  const points: Vector3[] = []

  for (let index = 0; index <= segments; index += 1) {
    const t = (index / segments) * Math.PI * 2
    const x = Math.cos(t) * radius
    const z = Math.sin(t) * radius
    const y = Math.sin(t * 2.0) * tilt
    points.push([x, y, z])
  }

  return points
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
  reducedMotion,
  onHover,
  onSelect,
}: ProjectNodeProps) {
  const isNeutralNode = nodeDisplayMode === 'neutral'
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

  useFrame(({ clock }) => {
    if (!groupRef.current) {
      return
    }

    const elapsed = clock.getElapsedTime()
    const [x, y, z] = project.coordinates
    const drift = reducedMotion ? 0 : Math.sin(elapsed * 0.7 + phaseOffset) * 0.1
    const neutralTarget = nodeDisplayMode === 'neutral' && !isActive ? 1 : 0
    neutralBlendRef.current = THREE.MathUtils.lerp(
      neutralBlendRef.current,
      neutralTarget,
      reducedMotion ? 0.2 : 0.08,
    )
    const neutralBlend = neutralBlendRef.current
    const pulseAmplitude = THREE.MathUtils.lerp(0.024, 0.048, neutralBlend)
    const pulse = reducedMotion ? 0 : Math.sin(elapsed * 2 + phaseOffset) * pulseAmplitude

    groupRef.current.position.set(x, y + drift, z)

    const baseScale = THREE.MathUtils.lerp(0.88, 1.26, neutralBlend)
    const hoverScale = isHovered ? THREE.MathUtils.lerp(0.1, 0.16, neutralBlend) : 0
    const targetScale = baseScale + hoverScale
    scaleTargetRef.setScalar(targetScale + pulse)
    groupRef.current.scale.lerp(scaleTargetRef, 0.1)

    if (ringRef.current) {
      ringRef.current.rotation.z += reducedMotion ? 0 : THREE.MathUtils.lerp(0.0032, 0.0048, neutralBlend)
      const innerRingScale = THREE.MathUtils.lerp(0.82, 1.42, neutralBlend) + (isHovered ? 0.08 : 0)
      ringRef.current.scale.setScalar(innerRingScale)
    }

    if (outerRingRef.current) {
      outerRingRef.current.rotation.z -= reducedMotion ? 0 : THREE.MathUtils.lerp(0.0024, 0.0038, neutralBlend)
      const outerRingScale = THREE.MathUtils.lerp(0.8, 1.5, neutralBlend) + (isHovered ? 0.08 : 0)
      outerRingRef.current.scale.setScalar(outerRingScale)
    }

    if (nodeMaterialRef.current) {
      const baseOpacity = isHovered ? 0.54 : 0.4
      const neutralOpacityBoost = isHovered ? 0.16 : 0.14
      const baseEmissive = isHovered ? 0.42 : 0.3
      const neutralEmissiveBoost = isHovered ? 0.32 : 0.24

      nodeMaterialRef.current.opacity = isNeutralNode ? 1 : mapVisibility * (baseOpacity + neutralBlend * neutralOpacityBoost)
      nodeMaterialRef.current.emissiveIntensity = mapVisibility * (baseEmissive + neutralBlend * neutralEmissiveBoost)
    }

    if (ringMaterialRef.current) {
      const baseRingOpacity = isHovered ? 0.22 : 0.13
      const neutralRingBoost = isHovered ? 0.34 : 0.3
      ringMaterialRef.current.opacity = isNeutralNode ? 1 : mapVisibility * (baseRingOpacity + neutralBlend * neutralRingBoost)
    }

    if (outerRingMaterialRef.current) {
      const outerOpacity = isHovered ? 0.28 : 0.18
      outerRingMaterialRef.current.opacity = isNeutralNode ? 1 : mapVisibility * outerOpacity * neutralBlend
    }
  })

  return (
    <group ref={groupRef}>
      {!isActive && (
        <>
          <mesh ref={ringRef} renderOrder={-20}>
            <torusGeometry args={[0.31, 0.014, 12, 80]} />
            <meshBasicMaterial
              ref={ringMaterialRef}
              color={project.color}
              transparent={!isNeutralNode}
              opacity={isNeutralNode ? 1 : 0.28}
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
              transparent={!isNeutralNode}
              opacity={isNeutralNode ? 1 : 0.22}
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
              transparent={!isNeutralNode}
              opacity={isNeutralNode ? 1 : 0.62}
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

function HeroWorld({ project, reducedMotion, transitionProgress }: HeroWorldProps) {
  const { gl } = useThree()
  const groupRef = useRef<THREE.Group>(null)
  const coreRef = useRef<THREE.Mesh>(null)
  const shellRef = useRef<THREE.Mesh>(null)
  const shellAccentRef = useRef<THREE.Mesh>(null)
  const pointsRef = useRef<THREE.Points>(null)
  const coreMaterialRef = useRef<THREE.ShaderMaterial>(null)
  const shellMaterialRef = useRef<THREE.ShaderMaterial>(null)
  const particleMaterialRef = useRef<THREE.ShaderMaterial>(null)
  const accentScaleTargetRef = useMemo(() => new THREE.Vector3(1, 1, 1), [])

  const style = useMemo(() => getHeroStyle(project), [project])
  const particles = useMemo(() => createParticleField(style, `${project.id}-hero-swarm`), [style, project.id])
  const accentColor = useMemo(() => new THREE.Color(style.accent), [style.accent])
  const secondaryColor = useMemo(() => new THREE.Color(style.secondary), [style.secondary])

  const introProgress = transitionProgress < 0.5 ? 1 - smoothstep(0, 0.5, transitionProgress) : smoothstep(0.5, 1, transitionProgress)
  const intensity = reducedMotion ? 1 : clamp01(introProgress)

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

  const particleUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: accentColor.clone().lerp(secondaryColor, 0.14) },
      uOpacity: { value: 0.44 },
      uBaseSize: { value: style.swarmSize },
      uPixelRatio: { value: Math.min(gl.getPixelRatio(), 2) },
      uIntensity: { value: 1 },
    }),
    [accentColor, secondaryColor, gl, style.swarmSize],
  )

  const harmonicRingA = useMemo(() => createCirclePoints(1.12, 128, 0.06), [])
  const harmonicRingB = useMemo(() => createCirclePoints(0.84, 128, 0.04), [])

  useFrame(({ clock }) => {
    const elapsed = clock.getElapsedTime()

    if (groupRef.current) {
      const targetScale = 0.72 + intensity * 0.36
      groupRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.08)
      groupRef.current.rotation.y += reducedMotion ? 0.0003 : 0.0009
    }

    if (coreRef.current) {
      coreRef.current.rotation.x += reducedMotion ? 0.0007 : 0.0045
      coreRef.current.rotation.y += reducedMotion ? 0.0008 : 0.006
    }

    if (shellRef.current) {
      shellRef.current.rotation.y += reducedMotion ? 0.0004 : 0.0018
      shellRef.current.rotation.z += reducedMotion ? 0.00035 : 0.0011
    }

    if (shellAccentRef.current) {
      shellAccentRef.current.rotation.x += reducedMotion ? 0.0004 : 0.0018
      shellAccentRef.current.rotation.y += reducedMotion ? 0.00045 : 0.0015

      if (style.kind === 'storm') {
        const pulse = 1 + Math.sin(elapsed * 0.7) * 0.12 * intensity
        accentScaleTargetRef.setScalar(pulse)
        shellAccentRef.current.scale.lerp(accentScaleTargetRef, 0.08)
      }

      if (style.kind === 'pulse') {
        const beat = 0.98 + Math.sin(elapsed * 0.65) * 0.1 * intensity
        accentScaleTargetRef.setScalar(beat)
        shellAccentRef.current.scale.lerp(accentScaleTargetRef, 0.08)
      }
    }

    updateParticleField(particles, style, elapsed, intensity)

    if (pointsRef.current) {
      const attribute = pointsRef.current.geometry.attributes.position as THREE.BufferAttribute
      attribute.needsUpdate = true
    }

    if (coreMaterialRef.current) {
      coreMaterialRef.current.uniforms.uTime.value = elapsed
      coreMaterialRef.current.uniforms.uColor.value.copy(accentColor)
      coreMaterialRef.current.uniforms.uIntensity.value = 0.22 + intensity * 0.48
      coreMaterialRef.current.uniforms.uEnergy.value = 0.2 + intensity * 0.7
    }

    if (shellMaterialRef.current) {
      shellMaterialRef.current.uniforms.uTime.value = elapsed
      shellMaterialRef.current.uniforms.uColor.value.copy(secondaryColor).lerp(accentColor, 0.18)
      shellMaterialRef.current.uniforms.uIntensity.value = 0.26 + intensity * 0.62
    }

    if (particleMaterialRef.current) {
      particleMaterialRef.current.uniforms.uTime.value = elapsed
      particleMaterialRef.current.uniforms.uColor.value.copy(accentColor).lerp(secondaryColor, 0.12)
      particleMaterialRef.current.uniforms.uIntensity.value = 0.22 + intensity * 0.74
      particleMaterialRef.current.uniforms.uOpacity.value = 0.16 + intensity * 0.28
      particleMaterialRef.current.uniforms.uPixelRatio.value = Math.min(gl.getPixelRatio(), 2)
    }
  })

  return (
    <group ref={groupRef} position={project.coordinates}>
      <mesh ref={coreRef}>
        {style.kind === 'harmonic' ? (
          <torusKnotGeometry args={[0.24, 0.08, 180, 24]} />
        ) : style.kind === 'pulse' ? (
          <octahedronGeometry args={[0.46, 0]} />
        ) : (
          <dodecahedronGeometry args={[0.42, 0]} />
        )}
        <shaderMaterial
          ref={coreMaterialRef}
          uniforms={coreUniforms}
          vertexShader={CORE_VERTEX_SHADER}
          fragmentShader={CORE_FRAGMENT_SHADER}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>

      <mesh
        ref={shellRef}
        rotation={
          style.kind === 'pulse'
            ? [Math.PI / 4, Math.PI / 3, 0]
            : style.kind === 'harmonic'
              ? [Math.PI / 3, 0, 0]
              : [0, 0, 0]
        }
      >
        {style.kind === 'harmonic' ? (
          <torusGeometry args={[0.66, 0.016, 16, 120]} />
        ) : (
          <icosahedronGeometry args={[style.shellScale, 1]} />
        )}
        <shaderMaterial
          ref={shellMaterialRef}
          uniforms={shellUniforms}
          vertexShader={SHELL_VERTEX_SHADER}
          fragmentShader={SHELL_FRAGMENT_SHADER}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          wireframe
          toneMapped={false}
        />
      </mesh>

      {style.kind === 'storm' && (
        <mesh ref={shellAccentRef} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.1, 0.022, 16, 120]} />
          <meshBasicMaterial color={style.accent} transparent opacity={0.2} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      )}

      {style.kind === 'harmonic' && (
        <group ref={shellAccentRef}>
          <Line points={harmonicRingA} color={style.accent} lineWidth={1.1} transparent opacity={0.38} />
          <Line points={harmonicRingB} color={style.secondary} lineWidth={0.95} transparent opacity={0.32} />
        </group>
      )}

      {style.kind === 'pulse' && (
        <group ref={shellAccentRef}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.76, 0.018, 10, 90]} />
            <meshBasicMaterial color={style.accent} transparent opacity={0.22} depthWrite={false} blending={THREE.AdditiveBlending} />
          </mesh>
          <mesh rotation={[Math.PI / 2, Math.PI / 5, 0]}>
            <torusGeometry args={[1.02, 0.014, 10, 90]} />
            <meshBasicMaterial color={style.secondary} transparent opacity={0.18} depthWrite={false} blending={THREE.AdditiveBlending} />
          </mesh>
        </group>
      )}

      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[particles.positions, 3]} />
          <bufferAttribute attach="attributes-aSize" args={[particles.sizes, 1]} />
          <bufferAttribute attach="attributes-aFlicker" args={[particles.flickers, 1]} />
        </bufferGeometry>
        <shaderMaterial
          ref={particleMaterialRef}
          uniforms={particleUniforms}
          vertexShader={PARTICLE_VERTEX_SHADER}
          fragmentShader={PARTICLE_FRAGMENT_SHADER}
          transparent
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

  useEffect(() => {
    const renderPass = new RenderPass(scene, camera)
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.9, 0.6, 0.36)
    const composer = new EffectComposer(gl)

    composer.addPass(renderPass)
    composer.addPass(bloomPass)

    composerRef.current = composer
    bloomRef.current = bloomPass

    return () => {
      composer.dispose()
      composerRef.current = null
      bloomRef.current = null
    }
  }, [gl, scene, camera])

  useEffect(() => {
    composerRef.current?.setSize(size.width, size.height)
  }, [size.width, size.height])

  useEffect(() => {
    const bloomPass = bloomRef.current

    if (!bloomPass) {
      return
    }

    if (!project) {
      bloomPass.strength = reducedMotion ? 0.42 : 0.5
      bloomPass.radius = 0.55
      bloomPass.threshold = 0.44
    } else if (project.id === 'gpgpu-particles') {
      bloomPass.strength = reducedMotion ? 0.62 : 0.8
      bloomPass.radius = 0.62
      bloomPass.threshold = 0.34
    } else if (project.id === 'voyce') {
      bloomPass.strength = reducedMotion ? 0.52 : 0.68
      bloomPass.radius = 0.58
      bloomPass.threshold = 0.38
    } else {
      bloomPass.strength = reducedMotion ? 0.58 : 0.74
      bloomPass.radius = 0.6
      bloomPass.threshold = 0.35
    }
  }, [project, reducedMotion])

  useFrame((_state, delta) => {
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

  const orbitCameraOffsetRef = useRef(new THREE.Vector3())
  const orbitTargetOffsetRef = useRef(new THREE.Vector3())

  const progressRef = useRef(1)
  const isTransitioningRef = useRef(true)
  const isUserInteractingRef = useRef(false)
  const halfwayNotifiedRef = useRef(false)

  useEffect(() => {
    const controls = controlsRef.current

    if (!controls) {
      return
    }

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

    startTargetRef.current.copy(controls?.target ?? active)
    startCameraRef.current.copy(camera.position)

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

    endTargetRef.current.copy(target)
    endCameraRef.current.copy(cameraPosition)
    activeAnchorRef.current.copy(active)

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
    halfwayNotifiedRef.current = false
    onTransitionProgress?.(0)
  }, [activeProject, projects, size.width, size.height, camera, controlsRef, onTransitionProgress])

  useFrame((_state, delta) => {
    const controls = controlsRef.current

    if (!controls) {
      return
    }

    if (!isTransitioningRef.current) {
      if (!reducedMotion && !isUserInteractingRef.current && activeProject) {
        const orbitSpeed = size.width < 900 ? 0.08 : 0.055
        const theta = delta * orbitSpeed

        orbitCameraOffsetRef.current.copy(camera.position).sub(activeAnchorRef.current)
        orbitTargetOffsetRef.current.copy(controls.target).sub(activeAnchorRef.current)

        orbitCameraOffsetRef.current.applyAxisAngle(WORLD_UP, theta)
        orbitTargetOffsetRef.current.applyAxisAngle(WORLD_UP, theta)

        camera.position.copy(activeAnchorRef.current).add(orbitCameraOffsetRef.current)
        controls.target.copy(activeAnchorRef.current).add(orbitTargetOffsetRef.current)
      }

      controls.update()
      return
    }

    const duration = reducedMotion ? 0.01 : size.width < 900 ? 1.65 : 2.2
    const nextProgress = Math.min(1, progressRef.current + delta / duration)
    progressRef.current = nextProgress
    onTransitionProgress?.(nextProgress)

    if (!halfwayNotifiedRef.current && nextProgress >= 0.5) {
      halfwayNotifiedRef.current = true
      onTransitionHalfway?.()
    }

    const eased = easeInOutCubic(nextProgress)
    const arcLift = reducedMotion ? 0 : Math.sin(Math.PI * eased) * (size.width < 900 ? 0.08 : 0.24)

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
    const cinematicDolly = reducedMotion ? 0 : Math.sin(Math.PI * eased) * (size.width < 900 ? 0.44 : 0.94)

    camera.position.copy(transitionTargetRef.current).addScaledVector(transitionDirectionRef.current, radius + cinematicDolly)
    camera.position.addScaledVector(WORLD_UP, arcLift)

    controls.update()

    if (nextProgress >= 1) {
      if (!halfwayNotifiedRef.current) {
        halfwayNotifiedRef.current = true
        onTransitionHalfway?.()
      }

      isTransitioningRef.current = false
      onTransitionProgress?.(1)
      controls.target.copy(endTargetRef.current)
      camera.position.copy(endCameraRef.current)
      controls.update()
    }
  })

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
  const overlayGroupRef = useRef<THREE.Group>(null)
  const baseMeshRef = useRef<THREE.InstancedMesh>(null)
  const overlayMeshRef = useRef<THREE.InstancedMesh>(null)
  const scratchObject = useMemo(() => new THREE.Object3D(), [])

  const baseStars = useMemo(
    () => createNeutralStarInstances('neutral-stars-base', 1842, 122, 28, [0.036, 0.084]),
    [],
  )
  const overlayStars = useMemo(
    () => createNeutralStarInstances('neutral-stars-overlay', 744, 94, 18, [0.058, 0.125]),
    [],
  )

  useLayoutEffect(() => {
    const applyInstances = (mesh: THREE.InstancedMesh | null, stars: NeutralStarInstances) => {
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
    }

    applyInstances(baseMeshRef.current, baseStars)
    applyInstances(overlayMeshRef.current, overlayStars)
  }, [baseStars, overlayStars, scratchObject])

  useFrame(({ clock }) => {
    const elapsed = clock.getElapsedTime()

    if (baseGroupRef.current) {
      baseGroupRef.current.rotation.set(0, 0, 0)

      if (!reducedMotion) {
        baseGroupRef.current.rotation.y = elapsed * 0.008
        baseGroupRef.current.rotation.x = Math.sin(elapsed * 0.045) * 0.014
      }
    }

    if (overlayGroupRef.current) {
      overlayGroupRef.current.rotation.set(0, 0, 0)

      if (!reducedMotion) {
        overlayGroupRef.current.rotation.y = -elapsed * 0.0065 + 1.1
        overlayGroupRef.current.rotation.x = Math.cos(elapsed * 0.04) * 0.012
      }
    }
  })

  return (
    <>
      <group ref={baseGroupRef} renderOrder={-30} frustumCulled={false}>
        <instancedMesh ref={baseMeshRef} args={[undefined, undefined, baseStars.count]} frustumCulled={false}>
          <sphereGeometry args={[1, 6, 6]} />
          <meshBasicMaterial
            color="#e8f1ff"
            transparent={false}
            depthWrite={false}
            depthTest
            blending={THREE.NormalBlending}
            fog={false}
            toneMapped={false}
          />
        </instancedMesh>
      </group>

      <group ref={overlayGroupRef} renderOrder={-29} frustumCulled={false}>
        <instancedMesh ref={overlayMeshRef} args={[undefined, undefined, overlayStars.count]} frustumCulled={false}>
          <sphereGeometry args={[1, 6, 6]} />
          <meshBasicMaterial
            color="#f6fbff"
            transparent={false}
            depthWrite={false}
            depthTest
            blending={THREE.NormalBlending}
            fog={false}
            toneMapped={false}
          />
        </instancedMesh>
      </group>
    </>
  )
}

function SceneContent({ projects, activeProjectId, onSelectProject, reducedMotion }: ConstellationSceneProps) {
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null)
  const [visualActiveProjectId, setVisualActiveProjectId] = useState<string | null>(activeProjectId)
  const [transitionProgress, setTransitionProgress] = useState(1)

  const controlsRef = useRef<OrbitControlsImpl | null>(null)
  const pendingVisualProjectIdRef = useRef<string | null | undefined>(undefined)

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

  const mapVisibility = useMemo(() => {
    if (!visualActiveProjectId) {
      return 0.96
    }

    if (reducedMotion) {
      return 0.28
    }

    return 0.18 + (1 - smoothstep(0.08, 0.62, transitionProgress)) * 0.62
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

  useEffect(() => {
    if (reducedMotion) {
      pendingVisualProjectIdRef.current = undefined
      return
    }

    pendingVisualProjectIdRef.current = activeProjectId
  }, [activeProjectId, reducedMotion])

  const handleTransitionHalfway = useCallback(() => {
    if (pendingVisualProjectIdRef.current === undefined) {
      return
    }

    setVisualActiveProjectId(pendingVisualProjectIdRef.current)
    pendingVisualProjectIdRef.current = undefined
  }, [])

  const handleTransitionProgress = useCallback((progress: number) => {
    setTransitionProgress((previous) => (Math.abs(previous - progress) > 0.006 ? progress : previous))
  }, [])

  return (
    <>
      <color attach="background" args={['#070708']} />
      <fog attach="fog" args={['#070708', 10, fogFar]} />

      <CinematicLights project={visualActiveProject} reducedMotion={reducedMotion} />

      {connectionVisuals.map((connection) => {
        const showAllConnections = !visualActiveProjectId && !hoveredProjectId
        const linkedToSelection =
          showAllConnections ||
          connection.projects[0] === visualActiveProjectId ||
          connection.projects[1] === visualActiveProjectId ||
          connection.projects[0] === hoveredProjectId ||
          connection.projects[1] === hoveredProjectId

        if (!linkedToSelection) {
          return null
        }

        return (
          <group key={connection.id}>
            <mesh position={connection.midpoint} quaternion={connection.quaternion} renderOrder={-20}>
              <cylinderGeometry args={[0.012, 0.012, connection.length, 8, 1, true]} />
              <meshBasicMaterial
                color={visualActiveProjectId ? activeConnectionColor : neutralConnectionColor}
                transparent={Boolean(visualActiveProjectId)}
                opacity={visualActiveProjectId ? mapVisibility * 0.52 : 1}
                depthWrite
                depthTest
                blending={THREE.NormalBlending}
                toneMapped={false}
              />
            </mesh>
          </group>
        )
      })}

      {projects.map((project) => (
        <ProjectNode
          key={project.id}
          project={project}
          isActive={project.id === visualActiveProjectId}
          isHovered={project.id === hoveredProjectId}
          mapVisibility={mapVisibility}
          nodeDisplayMode={!visualActiveProjectId ? 'neutral' : 'background'}
          reducedMotion={reducedMotion}
          onHover={setHoveredProjectId}
          onSelect={onSelectProject}
        />
      ))}

      {visualActiveProject && (
        <HeroWorld
          key={visualActiveProject.id}
          project={visualActiveProject}
          reducedMotion={reducedMotion}
          transitionProgress={transitionProgress}
        />
      )}

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
        onTransitionHalfway={handleTransitionHalfway}
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
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.0
      }}
      fallback={<div className="canvas-fallback">WebGL unavailable.</div>}
    >
      <SceneContent {...props} />
    </Canvas>
  )
}
