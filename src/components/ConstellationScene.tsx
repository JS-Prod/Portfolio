import { Html, Line, OrbitControls, Sparkles, Stars } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

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

const CONNECTION_DISTANCE = 6.2

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

function getPhase(seed: string): number {
  let hash = 0

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(index)
    hash |= 0
  }

  return (Math.abs(hash) % 628) / 100
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
  const auraRef = useRef<THREE.Mesh>(null)
  const scaleRef = useMemo(() => new THREE.Vector3(1, 1, 1), [])
  const ringScaleRef = useMemo(() => new THREE.Vector3(1, 1, 1), [])
  const phaseOffset = useMemo(() => getPhase(project.id), [project.id])

  useEffect(() => {
    return () => {
      document.body.style.cursor = 'default'
    }
  }, [])

  useFrame(({ clock }) => {
    if (!groupRef.current || !ringRef.current || !auraRef.current) {
      return
    }

    const elapsed = clock.getElapsedTime()
    const [x, y, z] = project.coordinates

    const drift = reducedMotion ? 0 : Math.sin(elapsed * 0.72 + phaseOffset) * 0.18
    const pulse = reducedMotion ? 0 : Math.sin(elapsed * 1.9 + phaseOffset) * 0.06

    const scaleTarget = isActive ? 1.78 : isHovered ? 1.33 : 1
    const ringTarget = isActive ? 2.6 : isHovered ? 2.08 : 1.62

    groupRef.current.position.set(x, y + drift, z)

    scaleRef.setScalar(scaleTarget + pulse)
    groupRef.current.scale.lerp(scaleRef, 0.1)

    ringScaleRef.setScalar(ringTarget + pulse)
    ringRef.current.scale.lerp(ringScaleRef, 0.1)
    ringRef.current.rotation.z += reducedMotion ? 0 : 0.007

    auraRef.current.scale.setScalar(isActive ? 2.15 + pulse : isHovered ? 1.72 + pulse : 1.4 + pulse)
  })

  return (
    <group ref={groupRef}>
      <mesh ref={auraRef}>
        <sphereGeometry args={[0.3, 20, 20]} />
        <meshBasicMaterial color={project.color} transparent opacity={isActive ? 0.22 : isHovered ? 0.16 : 0.1} />
      </mesh>

      <mesh ref={ringRef}>
        <torusGeometry args={[0.28, 0.024, 12, 80]} />
        <meshBasicMaterial
          color={project.color}
          transparent
          opacity={isActive ? 0.9 : isHovered ? 0.58 : 0.32}
        />
      </mesh>

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
        <icosahedronGeometry args={[0.24, 1]} />
        <meshStandardMaterial
          color={project.color}
          emissive={project.color}
          emissiveIntensity={isActive ? 1.35 : isHovered ? 0.98 : 0.62}
          roughness={0.2}
          metalness={0.26}
        />
      </mesh>

      {(isActive || isHovered) && (
        <Html position={[0, 0.86, 0]} center distanceFactor={12} zIndexRange={[20, 0]}>
          <div className="node-label">{project.title}</div>
        </Html>
      )}
    </group>
  )
}

function SceneContent({
  projects,
  activeProjectId,
  onSelectProject,
  reducedMotion,
}: ConstellationSceneProps) {
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null)
  const constellationRef = useRef<THREE.Group>(null)
  const offsetTargetRef = useRef(new THREE.Vector3())

  const connections = useMemo(() => buildConnections(projects), [projects])

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? projects[0],
    [projects, activeProjectId],
  )

  useFrame(({ size }) => {
    if (!constellationRef.current) {
      return
    }

    const leftBias = size.width < 900 ? -0.35 : -1.25
    const downBias = size.width < 900 ? -0.18 : -0.32

    offsetTargetRef.current.set(
      -activeProject.coordinates[0] * 0.14 + leftBias,
      -activeProject.coordinates[1] * 0.11 + downBias,
      0,
    )
    constellationRef.current.position.lerp(offsetTargetRef.current, reducedMotion ? 0.32 : 0.07)
  })

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

      <group ref={constellationRef}>
        {connections.map((connection) => {
          const linkedToSelection =
            connection.projects[0] === activeProjectId ||
            connection.projects[1] === activeProjectId ||
            connection.projects[0] === hoveredProjectId ||
            connection.projects[1] === hoveredProjectId

          return (
            <Line
              key={connection.id}
              points={connection.points}
              color={linkedToSelection ? '#b5d9ff' : '#4f6078'}
              transparent
              opacity={linkedToSelection ? 0.78 : 0.27}
              lineWidth={linkedToSelection ? 1.45 : 0.8}
            />
          )
        })}

        {projects.map((project) => (
          <ProjectNode
            key={project.id}
            project={project}
            isActive={project.id === activeProjectId}
            isHovered={project.id === hoveredProjectId}
            reducedMotion={reducedMotion}
            onHover={setHoveredProjectId}
            onSelect={onSelectProject}
          />
        ))}
      </group>

      <OrbitControls
        enablePan={false}
        enableZoom
        enableRotate
        enableDamping
        dampingFactor={0.09}
        rotateSpeed={0.6}
        zoomSpeed={0.7}
        minDistance={4.2}
        maxDistance={14}
        minPolarAngle={0.42}
        maxPolarAngle={2.5}
        autoRotate={!reducedMotion}
        autoRotateSpeed={0.2}
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
      fallback={<div className="canvas-fallback">WebGL unavailable.</div>}
    >
      <SceneContent {...props} />
    </Canvas>
  )
}
