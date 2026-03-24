import { useDeferredValue, useMemo, useState } from 'react'
import { useReducedMotion } from 'framer-motion'

import './App.css'
import { ConstellationScene } from './components/ConstellationScene'
import { ProjectPanel } from './components/ProjectPanel'
import { projects } from './data/projects'

function App() {
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const deferredActiveProjectId = useDeferredValue(activeProjectId)
  const reduceMotion = useReducedMotion() ?? false
  const hasActiveProject = activeProjectId !== null

  const activeProject = useMemo(
    () => (activeProjectId ? projects.find((project) => project.id === activeProjectId) ?? null : null),
    [activeProjectId],
  )
  const deferredPanelProject = useMemo(
    () =>
      deferredActiveProjectId
        ? projects.find((project) => project.id === deferredActiveProjectId) ?? null
        : null,
    [deferredActiveProjectId],
  )

  return (
    <div className="portfolio-shell">
      <div className="scene-layer" aria-hidden="true">
        <ConstellationScene
          projects={projects}
          activeProjectId={activeProjectId}
          onSelectProject={setActiveProjectId}
          reducedMotion={reduceMotion}
        />
      </div>

      <header className="hud-header">
        <p className="hud-label">Janessa Portfolio / Constellation Interface</p>
        <h1>Selected Work</h1>
        <p>Realtime graphics, voice infrastructure, and interactive audio experiences.</p>
      </header>

      <main className="hud-panel">
        <ProjectPanel project={deferredPanelProject} />
      </main>

      <button
        type="button"
        className={`neutral-reset${hasActiveProject ? '' : ' is-hidden'}`}
        onClick={() => setActiveProjectId(null)}
        aria-label="Return to neutral constellation view"
        title="Return to neutral constellation view"
        aria-hidden={!hasActiveProject}
        tabIndex={hasActiveProject ? 0 : -1}
        disabled={!hasActiveProject}
      >
        ↑
      </button>

      <nav className="project-rail" aria-label="Project constellation index">
        {projects.map((project) => {
          const isActive = project.id === activeProjectId

          return (
            <button
              key={project.id}
              type="button"
              className={`project-pill ${isActive ? 'active' : ''}`}
              onClick={() => setActiveProjectId((previous) => (previous === project.id ? null : project.id))}
              aria-pressed={isActive}
            >
              <span className="pill-dot" style={{ backgroundColor: project.color }} aria-hidden="true" />
              <span>{project.title}</span>
            </button>
          )
        })}
      </nav>

      <p className="interaction-hint">
        Drag to orbit. Click stars or project chips to inspect. Click an active chip or top arrow to return to neutral.
      </p>
      <p className="active-readout">Active: {activeProject ? activeProject.title : 'None'}</p>
    </div>
  )
}

export default App
