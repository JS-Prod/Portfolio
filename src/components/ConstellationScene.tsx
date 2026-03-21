import { Html, Line, OrbitControls, Sparkles, Stars } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

import type { Project } from '../data/projects'

type Vector3 = [number, number, number]

type ConstellationSceneProps = {
  projects: Project[]
  activeProjectId: string
  onSelectProject: (projectId: string) => void
  reducedMotion: boolean
}

type Connection = {
  id: string
  points: [Vector3, Vector3]
  projects: [string, string]
}

type ProjectNodeProps = {
  project: Project
  isActive: boolean
  isHovered: boolean
  reducedMotion: boolean
  onHover: (projectId: string | null) => void
  onSelect: (projectId: string) => void
}

type SignatureProfile = {
  starKind: 'core' | 'crystal' | 'knot'
  particleKind: 'burst' | 'helix' | 'rays'
  accent: string
  secondaryAccent: string
  primaryCount: number
  secondaryCount: number
  primarySize: number
  secondarySize: number
}

type ParticleLayer = {
  basePositions: Float32Array
  positions: Float32Array
  phases: Float32Array
  speeds: Float32Array
  radii: Float32Array
  count: number
}

type SignatureParticles = {
  primary: ParticleLayer
  secondary: ParticleLayer
}

type ProjectSignatureProps = {
  project: Project
  reducedMotion: boolean
}

type CameraRigProps = {
  projects: Project[]
  activeProject: Project
  controlsRef: RefObject<OrbitControlsImpl | null>
  reducedMotion: boolean
  onTransitionHalfway?: () => void
}

const CONNECTION_DISTANCE = 6.2

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

function createParticleTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128

  const context = canvas.getContext('2d')

  if (!context) {
    return new THREE.Texture()
  }

  const gradient = context.createRadialGradient(64, 64, 6, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.2, 'rgba(255,255,255,0.95)')
  gradient.addColorStop(0.5, 'rgba(180,215,255,0.55)')
  gradient.addColorStop(1, 'rgba(0,0,0,0)')

  context.fillStyle = gradient
  context.fillRect(0, 0, 128, 128)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true

  return texture
}

function getPhase(seed: string): number {
  return (getHash(seed) % 628) / 100
}

function easeInOutCubic(value: number): number {
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

function getSignatureProfile(project: Project): SignatureProfile {
  if (project.id === 'gpgpu-particles') {
    return {
      starKind: 'core',
      particleKind: 'burst',
      accent: '#8dc9ff',
      secondaryAccent: '#3f79d6',
      primaryCount: 920,
      secondaryCount: 520,
      primarySize: 0.048,
      secondarySize: 0.078,
    }
  }

  if (project.id === 'voyce') {
    return {
      starKind: 'knot',
      particleKind: 'helix',
      accent: '#8ff2d7',
      secondaryAccent: '#58c9af',
      primaryCount: 760,
      secondaryCount: 420,
      primarySize: 0.044,
      secondarySize: 0.074,
    }
  }

  return {
    starKind: 'crystal',
    particleKind: 'rays',
    accent: '#ffd29f',
    secondaryAccent: '#d79652',
    primaryCount: 780,
    secondaryCount: 460,
    primarySize: 0.05,
    secondarySize: 0.082,
  }
}

function getSignatureFocusRadius(project: Project): number {
  const profile = getSignatureProfile(project)

  if (profile.starKind === 'core') {
    return 0.88
  }

  if (profile.starKind === 'knot') {
    return 0.82
  }

  return 0.8
}

function createParticleLayer(profile: SignatureProfile, seed: string, count: number): ParticleLayer {
  const basePositions = new Float32Array(count * 3)
  const positions = new Float32Array(count * 3)
  const phases = new Float32Array(count)
  const speeds = new Float32Array(count)
  const radii = new Float32Array(count)

  const random = createRandom(getHash(seed) + count)

  for (let index = 0; index < count; index += 1) {
    const offset = index * 3
    const angle = random() * Math.PI * 2

    phases[index] = random() * Math.PI * 2
    speeds[index] = 0.65 + random() * 1.5
    radii[index] = 0.25 + random() * 1.7

    if (profile.particleKind === 'burst') {
      const phi = Math.acos(1 - 2 * random())
      basePositions[offset] = Math.sin(phi) * Math.cos(angle)
      basePositions[offset + 1] = Math.cos(phi)
      basePositions[offset + 2] = Math.sin(phi) * Math.sin(angle)
      radii[index] = 0.8 + random() * 2.4
    } else if (profile.particleKind === 'helix') {
      const t = index / Math.max(count - 1, 1)
      const turns = 8.8
      const helixAngle = t * Math.PI * turns + random() * 0.35
      const radius = 0.58 + random() * 0.78
      basePositions[offset] = Math.cos(helixAngle) * radius
      basePositions[offset + 1] = (t - 0.5) * 4.2 + (random() - 0.5) * 0.3
      basePositions[offset + 2] = Math.sin(helixAngle) * radius
      radii[index] = radius * (1.1 + random() * 0.5)
    } else {
      const spread = 0.6 + random() * 1.8
      basePositions[offset] = Math.cos(angle) * spread
      basePositions[offset + 1] = (random() - 0.5) * 1.15 * spread * 0.45
      basePositions[offset + 2] = Math.sin(angle) * spread
      radii[index] = spread
    }
  }

  positions.set(basePositions)

  return {
    basePositions,
    positions,
    phases,
    speeds,
    radii,
    count,
  }
}

function createSignatureParticles(profile: SignatureProfile, seed: string): SignatureParticles {
  return {
    primary: createParticleLayer(profile, `${seed}-primary`, profile.primaryCount),
    secondary: createParticleLayer(profile, `${seed}-secondary`, profile.secondaryCount),
  }
}

function updateParticleLayer(layer: ParticleLayer, profile: SignatureProfile, elapsed: number) {
  for (let index = 0; index < layer.count; index += 1) {
    const offset = index * 3

    const bx = layer.basePositions[offset]
    const by = layer.basePositions[offset + 1]
    const bz = layer.basePositions[offset + 2]

    const phase = layer.phases[index]
    const speed = layer.speeds[index]
    const radius = layer.radii[index]

    if (profile.particleKind === 'burst') {
      const pulse = 1 + Math.sin(elapsed * 1.8 * speed + phase) * 0.34
      const spin = elapsed * 0.28 * speed
      const cos = Math.cos(spin)
      const sin = Math.sin(spin)

      const sx = bx * cos - bz * sin
      const sz = bx * sin + bz * cos

      layer.positions[offset] = sx * radius * pulse + Math.sin(elapsed * speed + phase) * 0.1
      layer.positions[offset + 1] = by * radius * pulse + Math.cos(elapsed * 1.35 + phase) * 0.1
      layer.positions[offset + 2] = sz * radius * pulse + Math.sin(elapsed * 1.15 + phase) * 0.1
    } else if (profile.particleKind === 'helix') {
      const spin = elapsed * 1.05 * speed + phase
      const baseRadius = Math.max(Math.sqrt(bx * bx + bz * bz), 0.08)
      const drift = 0.16 + Math.sin(elapsed * 1.3 + phase) * 0.13
      const verticalWave = Math.sin(elapsed * 0.95 + phase) * 0.28

      layer.positions[offset] = Math.cos(spin) * (baseRadius + drift)
      layer.positions[offset + 1] = by + verticalWave
      layer.positions[offset + 2] = Math.sin(spin) * (baseRadius + drift)
    } else {
      const wave = 0.62 + Math.abs(Math.sin(elapsed * 1.65 * speed + phase)) * 0.7
      layer.positions[offset] = bx * wave
      layer.positions[offset + 1] = by * wave
      layer.positions[offset + 2] = bz * wave
    }
  }
}

function ProjectNode({
  project,
  isActive,
  isHovered,
  reducedMotion,
  onHover,
  onSelect,
}: ProjectNodeProps) {
  const groupRef = useRef<THREE.Group>(null)
  const ringRef = useRef<THREE.Mesh>(null)
  const scaleRef = useMemo(() => new THREE.Vector3(1, 1, 1), [])
  const ringScaleRef = useMemo(() => new THREE.Vector3(1, 1, 1), [])
  const phaseOffset = useMemo(() => getPhase(project.id), [project.id])

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

    const drift = reducedMotion ? 0 : Math.sin(elapsed * 0.72 + phaseOffset) * 0.14
    const pulse = reducedMotion ? 0 : Math.sin(elapsed * 1.9 + phaseOffset) * 0.04

    const scaleTarget = isActive ? 0.82 : isHovered ? 1.14 : 1
    const ringTarget = isHovered ? 1.72 : 1.38

    groupRef.current.position.set(x, y + drift, z)

    scaleRef.setScalar(scaleTarget + pulse)
    groupRef.current.scale.lerp(scaleRef, 0.1)

    if (ringRef.current) {
      ringScaleRef.setScalar(ringTarget + pulse)
      ringRef.current.scale.lerp(ringScaleRef, 0.1)
      ringRef.current.rotation.z += reducedMotion ? 0 : 0.005
    }
  })

  return (
    <group ref={groupRef}>
      {!isActive && (
        <mesh ref={ringRef}>
          <torusGeometry args={[0.24, 0.018, 10, 64]} />
          <meshBasicMaterial color={project.color} transparent opacity={isHovered ? 0.45 : 0.2} />
        </mesh>
      )}

      <mesh
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
        <icosahedronGeometry args={[isActive ? 0.16 : 0.2, 1]} />
        <meshStandardMaterial
          color={isActive ? '#dce8ff' : project.color}
          emissive={project.color}
          emissiveIntensity={isActive ? 0.38 : isHovered ? 0.66 : 0.34}
          roughness={0.28}
          metalness={0.2}
        />
      </mesh>

      {isHovered && !isActive && (
        <Html position={[0, 0.86, 0]} center distanceFactor={12} zIndexRange={[20, 0]}>
          <div className="node-label">{project.title}</div>
        </Html>
      )}
    </group>
  )
}

function ProjectSignature({ project, reducedMotion }: ProjectSignatureProps) {
  const groupRef = useRef<THREE.Group>(null)
  const starRef = useRef<THREE.Mesh>(null)
  const shellRef = useRef<THREE.Mesh>(null)
  const pointsPrimaryRef = useRef<THREE.Points>(null)
  const pointsSecondaryRef = useRef<THREE.Points>(null)

  const profile = useMemo(() => getSignatureProfile(project), [project])
  const particles = useMemo(() => createSignatureParticles(profile, project.id), [profile, project.id])
  const particleTexture = useMemo(() => createParticleTexture(), [])

  useEffect(() => {
    return () => {
      particleTexture.dispose()
    }
  }, [particleTexture])

  useFrame(({ clock }) => {
    const elapsed = clock.getElapsedTime()

    if (groupRef.current && !reducedMotion) {
      groupRef.current.rotation.y += 0.0028
    }

    if (starRef.current) {
      starRef.current.rotation.x += reducedMotion ? 0.001 : 0.011
      starRef.current.rotation.y += reducedMotion ? 0.0016 : 0.017
    }

    if (shellRef.current) {
      shellRef.current.rotation.z += reducedMotion ? 0.0012 : 0.006
    }

    updateParticleLayer(particles.primary, profile, elapsed)
    updateParticleLayer(particles.secondary, profile, elapsed)

    if (pointsPrimaryRef.current) {
      const attribute = pointsPrimaryRef.current.geometry.attributes.position as THREE.BufferAttribute
      attribute.needsUpdate = true
    }

    if (pointsSecondaryRef.current) {
      const attribute = pointsSecondaryRef.current.geometry.attributes.position as THREE.BufferAttribute
      attribute.needsUpdate = true
    }
  })

  return (
    <group ref={groupRef} position={project.coordinates}>
      {profile.starKind === 'core' && (
        <>
          <mesh ref={starRef}>
            <dodecahedronGeometry args={[0.44, 0]} />
            <meshPhysicalMaterial
              color={profile.accent}
              emissive={profile.accent}
              emissiveIntensity={0.86}
              roughness={0.16}
              metalness={0.5}
              clearcoat={1}
              clearcoatRoughness={0.16}
            />
          </mesh>
          <mesh ref={shellRef}>
            <icosahedronGeometry args={[0.62, 1]} />
            <meshBasicMaterial color={profile.secondaryAccent} transparent opacity={0.24} wireframe />
          </mesh>
        </>
      )}

      {profile.starKind === 'knot' && (
        <>
          <mesh ref={starRef}>
            <torusKnotGeometry args={[0.27, 0.09, 170, 24]} />
            <meshPhysicalMaterial
              color={profile.accent}
              emissive={profile.accent}
              emissiveIntensity={0.82}
              roughness={0.22}
              metalness={0.45}
              clearcoat={0.9}
            />
          </mesh>
          <mesh ref={shellRef}>
            <icosahedronGeometry args={[0.7, 1]} />
            <meshBasicMaterial color={profile.secondaryAccent} transparent opacity={0.26} wireframe />
          </mesh>
        </>
      )}

      {profile.starKind === 'crystal' && (
        <>
          <mesh ref={starRef}>
            <octahedronGeometry args={[0.46, 0]} />
            <meshPhysicalMaterial
              color={profile.accent}
              emissive={profile.accent}
              emissiveIntensity={0.84}
              roughness={0.14}
              metalness={0.52}
              clearcoat={1}
            />
          </mesh>
          <mesh ref={shellRef} rotation={[Math.PI / 4, Math.PI / 3, 0]}>
            <dodecahedronGeometry args={[0.63, 0]} />
            <meshBasicMaterial color={profile.secondaryAccent} transparent opacity={0.26} wireframe />
          </mesh>
        </>
      )}

      <points ref={pointsSecondaryRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[particles.secondary.positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          map={particleTexture}
          color={profile.secondaryAccent}
          size={profile.secondarySize}
          sizeAttenuation
          transparent
          opacity={0.28}
          depthWrite={false}
          alphaTest={0.01}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </points>

      <points ref={pointsPrimaryRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[particles.primary.positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          map={particleTexture}
          color={profile.accent}
          size={profile.primarySize}
          sizeAttenuation
          transparent
          opacity={0.9}
          depthWrite={false}
          alphaTest={0.01}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </points>

      <Sparkles
        count={reducedMotion ? 12 : 36}
        scale={[2.8, 2.8, 2.8]}
        speed={reducedMotion ? 0 : 0.32}
        size={3.2}
        noise={0.2}
        color={profile.accent}
      />
    </group>
  )
}

function CameraRig({ projects, activeProject, controlsRef, reducedMotion, onTransitionHalfway }: CameraRigProps) {
  const { camera, size } = useThree()
  const startTargetRef = useRef(new THREE.Vector3())
  const startCameraRef = useRef(new THREE.Vector3())
  const startOffsetDirectionRef = useRef(new THREE.Vector3(0, 0, 1))
  const endOffsetDirectionRef = useRef(new THREE.Vector3(0, 0, 1))
  const startOffsetRadiusRef = useRef(1)
  const endOffsetRadiusRef = useRef(1)
  const targetRef = useRef(new THREE.Vector3())
  const cameraPositionRef = useRef(new THREE.Vector3())
  const activeAnchorRef = useRef(new THREE.Vector3())
  const transitionTargetRef = useRef(new THREE.Vector3())
  const transitionDirectionRef = useRef(new THREE.Vector3())
  const fallbackAxisRef = useRef(new THREE.Vector3(1, 0, 0))
  const xAxisRef = useRef(new THREE.Vector3(1, 0, 0))
  const orbitCameraOffsetRef = useRef(new THREE.Vector3())
  const orbitTargetOffsetRef = useRef(new THREE.Vector3())
  const worldUpRef = useRef(new THREE.Vector3(0, 1, 0))
  const isUserInteractingRef = useRef(false)
  const transitionProgressRef = useRef(1)
  const isTransitioningRef = useRef(true)
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
    const perspectiveCamera = camera as THREE.PerspectiveCamera
    const active = new THREE.Vector3(...activeProject.coordinates)
    const focusRadius = getSignatureFocusRadius(activeProject)
    const fovRad = THREE.MathUtils.degToRad(perspectiveCamera.fov)

    const others = projects.filter((project) => project.id !== activeProject.id)
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

    if (towardOthers.lengthSq() < 0.0001) {
      towardOthers.set(1, 0.2, 0.6)
    }

    towardOthers.normalize()

    let yawOffset = 0
    let distanceScale = 1
    let verticalBoost = 0
    let fillBoost = 0

    if (activeProject.id === 'voyce') {
      yawOffset = 0.55
      distanceScale = 0.88
      verticalBoost = 0.12
    } else if (activeProject.id === 'gpgpu-particles') {
      yawOffset = 0.2
      distanceScale = 0.9
    } else if (activeProject.id === 'tone-tap') {
      yawOffset = 0.16
      distanceScale = 0.82
      verticalBoost = 0.04
      fillBoost = 0.08
    }

    if (yawOffset !== 0) {
      towardOthers.applyAxisAngle(new THREE.Vector3(0, 1, 0), yawOffset).normalize()
    }

    const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), towardOthers)
    if (side.lengthSq() < 0.0001) {
      side.set(1, 0, 0)
    }
    side.normalize()

    const desiredFillBase = size.width < 900 ? 0.78 : 0.92
    const desiredFill = Math.min(0.99, desiredFillBase + fillBoost)
    const fillDistance = (2 * focusRadius) / (desiredFill * Math.tan(fovRad / 2))
    const spreadAllowance = Math.min(1.2, maxDistanceToOthers * 0.2)
    const distance = THREE.MathUtils.clamp(
      (fillDistance + spreadAllowance) * distanceScale,
      size.width < 900 ? 3.4 : 4.2,
      size.width < 900 ? 5.4 : 6.2,
    )

    const sideAmount = size.width < 900 ? 0.42 : 0.5 + maxDistanceToOthers * 0.12
    const verticalLift = (size.width < 900 ? 0.42 : 0.58) + verticalBoost
    const verticalOffset = new THREE.Vector3(0, verticalLift, 0)

    startTargetRef.current.copy(controls?.target ?? active)
    startCameraRef.current.copy(camera.position)

    const target = active.clone()
    const baseCameraPosition = active.clone().sub(towardOthers.clone().multiplyScalar(distance))
    const plusSidePosition = baseCameraPosition
      .clone()
      .add(side.clone().multiplyScalar(sideAmount))
      .add(verticalOffset)
    const minusSidePosition = baseCameraPosition
      .clone()
      .add(side.clone().multiplyScalar(-sideAmount))
      .add(verticalOffset)

    const currentOffsetFromActive = camera.position.clone().sub(active)
    if (currentOffsetFromActive.lengthSq() < 0.0001) {
      currentOffsetFromActive.set(0, 0, 1)
    }

    const plusAngle = currentOffsetFromActive.angleTo(plusSidePosition.clone().sub(active))
    const minusAngle = currentOffsetFromActive.angleTo(minusSidePosition.clone().sub(active))
    const cameraPosition = plusAngle <= minusAngle ? plusSidePosition : minusSidePosition

    const viewDirection = target.clone().sub(cameraPosition).normalize()
    const cameraRight = new THREE.Vector3().crossVectors(viewDirection, worldUpRef.current).normalize()
    const cameraUp = new THREE.Vector3().crossVectors(cameraRight, viewDirection).normalize()

    let desiredNdcX = -0.02
    const desiredNdcY = size.width < 900 ? -0.02 : 0.03

    if (size.width >= 900) {
      const panelElement = document.querySelector('.hud-panel') as HTMLElement | null

      if (panelElement) {
        const panelRect = panelElement.getBoundingClientRect()
        const safeRightEdge = Math.max(220, panelRect.left - 28)
        const remainderCenterX = Math.min(safeRightEdge - 24, safeRightEdge * 0.5 + 86)
        desiredNdcX = (remainderCenterX / Math.max(size.width, 1)) * 2 - 1
      } else {
        desiredNdcX = -0.16
      }
    }

    const verticalHalf = distance * Math.tan(fovRad / 2)
    const horizontalHalf = verticalHalf * perspectiveCamera.aspect

    const lookOffset = new THREE.Vector3()
      .addScaledVector(cameraRight, -desiredNdcX * horizontalHalf)
      .addScaledVector(cameraUp, -desiredNdcY * verticalHalf)

    target.add(lookOffset)

    targetRef.current.copy(target)
    activeAnchorRef.current.copy(active)

    cameraPositionRef.current.copy(cameraPosition)

    const startOffset = startCameraRef.current.clone().sub(startTargetRef.current)
    const endOffset = cameraPosition.clone().sub(target)

    if (startOffset.lengthSq() < 0.0001) {
      if (endOffset.lengthSq() < 0.0001) {
        startOffset.set(0, 0, 1)
      } else {
        startOffset.copy(endOffset)
      }
    }

    if (endOffset.lengthSq() < 0.0001) {
      endOffset.copy(startOffset)
    }

    startOffsetRadiusRef.current = Math.max(startOffset.length(), 0.001)
    endOffsetRadiusRef.current = Math.max(endOffset.length(), 0.001)
    startOffsetDirectionRef.current.copy(startOffset.normalize())
    endOffsetDirectionRef.current.copy(endOffset.normalize())

    transitionProgressRef.current = 0
    isTransitioningRef.current = true
    halfwayNotifiedRef.current = false
  }, [activeProject, projects, size.width, size.height, camera, controlsRef])

  useFrame((_state, delta) => {
    const controls = controlsRef.current

    if (!controls) {
      return
    }

    if (!isTransitioningRef.current) {
      if (!reducedMotion && !isUserInteractingRef.current) {
        const orbitSpeed = size.width < 900 ? 0.2 : 0.16
        const theta = delta * orbitSpeed

        orbitCameraOffsetRef.current.copy(camera.position).sub(activeAnchorRef.current)
        orbitTargetOffsetRef.current.copy(controls.target).sub(activeAnchorRef.current)

        orbitCameraOffsetRef.current.applyAxisAngle(worldUpRef.current, theta)
        orbitTargetOffsetRef.current.applyAxisAngle(worldUpRef.current, theta)

        camera.position.copy(activeAnchorRef.current).add(orbitCameraOffsetRef.current)
        controls.target.copy(activeAnchorRef.current).add(orbitTargetOffsetRef.current)
      }

      controls.update()
      return
    }

    const duration = reducedMotion ? 0.01 : size.width < 900 ? 1.35 : 1.85
    const nextProgress = Math.min(1, transitionProgressRef.current + delta / duration)
    transitionProgressRef.current = nextProgress

    if (!halfwayNotifiedRef.current && nextProgress >= 0.5) {
      halfwayNotifiedRef.current = true
      onTransitionHalfway?.()
    }

    const easedProgress = easeInOutCubic(nextProgress)
    const arcLift = reducedMotion ? 0 : Math.sin(Math.PI * easedProgress) * (size.width < 900 ? 0.08 : 0.22)

    transitionTargetRef.current.lerpVectors(startTargetRef.current, targetRef.current, easedProgress)
    controls.target.copy(transitionTargetRef.current)

    const startDirection = startOffsetDirectionRef.current
    const endDirection = endOffsetDirectionRef.current
    const dot = THREE.MathUtils.clamp(startDirection.dot(endDirection), -1, 1)

    if (dot > 0.9995) {
      transitionDirectionRef.current.lerpVectors(startDirection, endDirection, easedProgress).normalize()
    } else if (dot < -0.9995) {
      fallbackAxisRef.current.crossVectors(worldUpRef.current, startDirection)

      if (fallbackAxisRef.current.lengthSq() < 0.0001) {
        fallbackAxisRef.current.crossVectors(xAxisRef.current, startDirection)
      }

      fallbackAxisRef.current.normalize()
      transitionDirectionRef.current
        .copy(startDirection)
        .applyAxisAngle(fallbackAxisRef.current, Math.PI * easedProgress)
        .normalize()
    } else {
      const theta = Math.acos(dot)
      const sinTheta = Math.sin(theta)
      const startWeight = Math.sin((1 - easedProgress) * theta) / sinTheta
      const endWeight = Math.sin(easedProgress * theta) / sinTheta

      transitionDirectionRef.current
        .copy(startDirection)
        .multiplyScalar(startWeight)
        .addScaledVector(endDirection, endWeight)
        .normalize()
    }

    const radius = THREE.MathUtils.lerp(startOffsetRadiusRef.current, endOffsetRadiusRef.current, easedProgress)
    camera.position.copy(transitionTargetRef.current).addScaledVector(transitionDirectionRef.current, radius)
    camera.position.addScaledVector(worldUpRef.current, arcLift)
    controls.update()

    if (nextProgress >= 1) {
      if (!halfwayNotifiedRef.current) {
        halfwayNotifiedRef.current = true
        onTransitionHalfway?.()
      }
      isTransitioningRef.current = false
      controls.target.copy(targetRef.current)
      camera.position.copy(cameraPositionRef.current)
      controls.update()
    }
  })

  return null
}

function SceneContent({
  projects,
  activeProjectId,
  onSelectProject,
  reducedMotion,
}: ConstellationSceneProps) {
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null)
  const [visualActiveProjectId, setVisualActiveProjectId] = useState(activeProjectId)
  const controlsRef = useRef<OrbitControlsImpl | null>(null)
  const pendingVisualProjectIdRef = useRef<string | null>(null)
  const resolvedVisualActiveProjectId = reducedMotion ? activeProjectId : visualActiveProjectId

  const connections = useMemo(() => buildConnections(projects), [projects])

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? projects[0],
    [projects, activeProjectId],
  )
  const visualActiveProject = useMemo(
    () => projects.find((project) => project.id === resolvedVisualActiveProjectId) ?? activeProject,
    [projects, resolvedVisualActiveProjectId, activeProject],
  )

  useEffect(() => {
    if (reducedMotion) {
      pendingVisualProjectIdRef.current = null
      return
    }

    pendingVisualProjectIdRef.current = activeProjectId
  }, [activeProjectId, reducedMotion])

  const handleTransitionHalfway = () => {
    if (!pendingVisualProjectIdRef.current) {
      return
    }

    setVisualActiveProjectId(pendingVisualProjectIdRef.current)
    pendingVisualProjectIdRef.current = null
  }

  return (
    <>
      <color attach="background" args={['#030711']} />
      <fog attach="fog" args={['#030711', 10, 38]} />

      <ambientLight intensity={0.65} />
      <hemisphereLight args={['#accfff', '#091321', 0.56]} />
      <pointLight position={[6, 5, 4]} intensity={1.5} color="#9ec8ff" />
      <pointLight position={[-6, -2.5, -3]} intensity={1} color="#ffc08d" />
      <pointLight position={[0, 3, -7]} intensity={0.92} color="#d4c6ff" />

      <Stars
        radius={52}
        depth={42}
        count={reducedMotion ? 1200 : 2600}
        factor={5.4}
        saturation={0}
        fade
        speed={reducedMotion ? 0 : 0.45}
      />

      <Sparkles
        count={reducedMotion ? 28 : 80}
        scale={[16, 12, 16]}
        speed={reducedMotion ? 0 : 0.18}
        size={3.7}
        noise={0.22}
        color="#8ec6ff"
      />

      {connections.map((connection) => {
        const linkedToSelection =
          connection.projects[0] === resolvedVisualActiveProjectId ||
          connection.projects[1] === resolvedVisualActiveProjectId ||
          connection.projects[0] === hoveredProjectId ||
          connection.projects[1] === hoveredProjectId

        if (!linkedToSelection) {
          return null
        }

        return (
          <Line
            key={connection.id}
            points={connection.points}
            color={linkedToSelection ? '#b5d9ff' : '#4f6078'}
            transparent
            opacity={0.72}
            lineWidth={1.35}
          />
        )
      })}

      {projects.map((project) => (
        <ProjectNode
          key={project.id}
          project={project}
          isActive={project.id === resolvedVisualActiveProjectId}
          isHovered={project.id === hoveredProjectId}
          reducedMotion={reducedMotion}
          onHover={setHoveredProjectId}
          onSelect={onSelectProject}
        />
      ))}

      <ProjectSignature project={visualActiveProject} reducedMotion={reducedMotion} />

      <OrbitControls
        ref={controlsRef}
        enablePan={false}
        enableZoom
        enableRotate
        enableDamping
        dampingFactor={0.09}
        rotateSpeed={0.6}
        zoomSpeed={0.7}
        minDistance={2.5}
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
      />
    </>
  )
}

export function ConstellationScene(props: ConstellationSceneProps) {
  return (
    <Canvas
      className="constellation-canvas"
      style={{ position: 'absolute', inset: 0 }}
      camera={{ position: [0, 1.8, 8.2], fov: 54, near: 0.1, far: 140 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.12
      }}
      fallback={<div className="canvas-fallback">WebGL unavailable.</div>}
    >
      <SceneContent {...props} />
    </Canvas>
  )
}
