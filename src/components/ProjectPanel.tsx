import { useEffect, useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

import type { Project } from '../data/projects'

type ProjectPanelProps = {
  project: Project | null
}

export function ProjectPanel({ project }: ProjectPanelProps) {
  const reduceMotion = useReducedMotion() ?? false
  const hasShownProjectRef = useRef(false)
  const skipFirstProjectAnimation = !reduceMotion && project !== null && !hasShownProjectRef.current
  const disableMotion = reduceMotion || skipFirstProjectAnimation

  useEffect(() => {
    if (project && !hasShownProjectRef.current) {
      hasShownProjectRef.current = true
    }
  }, [project])

  return (
    <aside className="project-panel" aria-live="polite" aria-atomic="true">
      <p className="panel-kicker">Active Constellation Node</p>

      <AnimatePresence mode="wait">
        <motion.article
          key={project?.id ?? 'neutral'}
          className="project-card"
          initial={disableMotion ? false : { opacity: 0, y: 14 }}
          animate={disableMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          exit={disableMotion ? { opacity: 0 } : { opacity: 0, y: -10 }}
          transition={{ duration: disableMotion ? 0.01 : 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
          {project ? (
            <>
              <div className="project-meta">
                <span>{project.year}</span>
                <span>{project.role}</span>
              </div>

              <h2>{project.title}</h2>
              <p className="project-theme">Theme: {project.theme}</p>
              <p>{project.summary}</p>

              <div className="impact-block">
                <h3>Outcome</h3>
                <p>{project.impact}</p>
              </div>

              <div className="stack-list" aria-label="Technology stack">
                {project.stack.map((tech) => (
                  <span key={tech}>{tech}</span>
                ))}
              </div>
            </>
          ) : (
            <>
              <h2>Constellation Overview</h2>
              <p className="project-theme">Theme: Interactive project map</p>
              <p>Select a project node to enter its cinematic world.</p>
              <div className="impact-block">
                <h3>Tip</h3>
                <p>Click the active project chip again or press the subtle top arrow to return here.</p>
              </div>
            </>
          )}
        </motion.article>
      </AnimatePresence>
    </aside>
  )
}
