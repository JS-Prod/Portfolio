import { useMemo, useState } from 'react'
import { useReducedMotion } from 'framer-motion'

import './App.css'
import { ConstellationScene } from './components/ConstellationScene'
import { ProjectPanel } from './components/ProjectPanel'
import { projects } from './data/projects'

function App() {
  const [activeProjectId, setActiveProjectId] = useState<string>(projects[0].id)
  const reduceMotion = useReducedMotion() ?? false

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? projects[0],
    [activeProjectId],
  )

  return (
    <div className="portfolio-shell">
      <div className="scene-layer" aria-hidden="true">
        <ConstellationScene
          projects={projects}
          activeProjectId={activeProject.id}
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
        <ProjectPanel project={activeProject} />
      </main>

      <nav className="project-rail" aria-label="Project constellation index">
        {projects.map((project) => {
          const isActive = project.id === activeProject.id

          return (
            <button
              key={project.id}
              type="button"
              className={`project-pill ${isActive ? 'active' : ''}`}
              onClick={() => setActiveProjectId(project.id)}
              aria-pressed={isActive}
            >
              <span className="pill-dot" style={{ backgroundColor: project.color }} aria-hidden="true" />
              <span>{project.title}</span>
            </button>
          )
        })}
      </nav>

      <p className="interaction-hint">Drag to orbit. Click stars or project chips to inspect.</p>
      <p className="active-readout">Active: {activeProject.title}</p>
    </div>
  )
}

export default App
