import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

import type { Project } from '../data/projects'

type ProjectPanelProps = {
  project: Project
}

export function ProjectPanel({ project }: ProjectPanelProps) {
  const reduceMotion = useReducedMotion() ?? false

  return (
    <aside className="project-panel" aria-live="polite" aria-atomic="true">
      <p className="panel-kicker">Active Constellation Node</p>

      <AnimatePresence mode="wait">
        <motion.article
          key={project.id}
          className="project-card"
          initial={reduceMotion ? false : { opacity: 0, y: 14 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -10 }}
          transition={{ duration: reduceMotion ? 0.01 : 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
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
        </motion.article>
      </AnimatePresence>
    </aside>
  )
}
