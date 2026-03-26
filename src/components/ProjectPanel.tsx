import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { Project } from '../data/projects'

type ProjectPanelProps = {
  project: Project | null
}

type InsightTabKey = 'demo' | 'contribution' | 'approach' | 'impact'

type InsightTab = {
  key: InsightTabKey
  label: string
  content: string
  actionLabel?: string
  actionHref?: string
}

export function ProjectPanel({ project }: ProjectPanelProps) {
  const [activeTab, setActiveTab] = useState<InsightTabKey>('demo')
  const insightPanelRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setActiveTab('demo')
  }, [project?.id])

  const insightTabs = useMemo<InsightTab[]>(() => {
    if (!project) {
      return []
    }

    return [
      {
        key: 'demo',
        label: 'Demo',
        content: project.demoNote,
        actionLabel: project.demoLabel,
        actionHref: project.demoUrl,
      },
      { key: 'contribution', label: 'Contribution', content: project.contribution },
      { key: 'approach', label: 'Approach', content: project.approach },
      { key: 'impact', label: 'Impact', content: project.impact },
    ]
  }, [project])

  const activeInsight = insightTabs.find((tab) => tab.key === activeTab) ?? insightTabs[0] ?? null

  useLayoutEffect(() => {
    const panel = insightPanelRef.current
    const tabs = tabsRef.current

    if (!panel || !tabs) {
      return
    }

    const syncHighlightTrack = () => {
      const activeElement = tabs.querySelector<HTMLButtonElement>('.insight-tab.active')

      if (!activeElement) {
        panel.style.setProperty('--insight-active-left', '0px')
        panel.style.setProperty('--insight-active-width', '0px')
        return
      }

      const tabsRect = tabs.getBoundingClientRect()
      const activeRect = activeElement.getBoundingClientRect()
      panel.style.setProperty('--insight-active-left', `${activeRect.left - tabsRect.left}px`)
      panel.style.setProperty('--insight-active-width', `${activeRect.width}px`)
    }

    syncHighlightTrack()

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncHighlightTrack) : null
    observer?.observe(tabs)
    window.addEventListener('resize', syncHighlightTrack)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', syncHighlightTrack)
    }
  }, [activeTab, project?.id, insightTabs.length])

  return (
    <aside className="project-panel" aria-live="polite" aria-atomic="true">
      <p className="panel-kicker">Active Constellation Node</p>

      <article className="project-card">
        {project ? (
          <>
            <div className="project-meta">
              <span>{project.year}</span>
              <span>{project.role}</span>
            </div>

            <h2>{project.title}</h2>
            <p className="project-theme">Theme: {project.theme}</p>
            <p>{project.summary}</p>

            <div className="insight-panel" ref={insightPanelRef}>
              <div className="insight-tabs" role="tablist" aria-label="Project insights" ref={tabsRef}>
                {insightTabs.map((tab, index) => {
                  const isActive = activeTab === tab.key
                  const restingZ = insightTabs.length - index

                  return (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      className={`insight-tab ${isActive ? 'active' : ''}`}
                      aria-selected={isActive}
                      onClick={() => setActiveTab(tab.key)}
                      style={{ zIndex: isActive ? insightTabs.length + 2 : restingZ }}
                    >
                      {tab.label}
                    </button>
                  )
                })}
              </div>

              <div className="impact-block insight-content">
                <h3>{activeInsight?.label ?? 'Demo'}</h3>
                <p>{activeInsight?.content ?? project.demoNote}</p>
                {activeInsight?.actionHref ? (
                  <a
                    className="insight-action"
                    href={activeInsight.actionHref}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {activeInsight.actionLabel ?? 'Open'}
                  </a>
                ) : null}
                {activeInsight?.actionLabel && !activeInsight.actionHref ? (
                  <span className="insight-action-label">{activeInsight.actionLabel}</span>
                ) : null}
              </div>
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
      </article>
    </aside>
  )
}
