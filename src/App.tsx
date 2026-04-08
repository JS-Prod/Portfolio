import { useCallback, useEffect, useState } from "react";
import type { TransitionEvent } from "react";
import { useReducedMotion } from "framer-motion";

import "./App.css";
import { ConstellationScene } from "./components/ConstellationScene";
import { ProjectPanel } from "./components/ProjectPanel";
import { projects } from "./data/projects";

function getProjectIdFromHash(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const hashId = window.location.hash.replace(/^#/, "");
  return projects.some((project) => project.id === hashId) ? hashId : null;
}

function App() {
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() =>
    getProjectIdFromHash()
  );
  const [sceneLoading, setSceneLoading] = useState(true);
  const [loaderVisible, setLoaderVisible] = useState(true);
  const reduceMotion = useReducedMotion() ?? false;
  const hasActiveProject = activeProjectId !== null;

  const activePanelProject = activeProjectId
    ? projects.find((project) => project.id === activeProjectId) ?? null
    : null;

  const handleSceneReady = useCallback(() => {
    setSceneLoading(false);
  }, []);

  const handleLoaderTransitionEnd = useCallback(
    (event: TransitionEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) {
        return;
      }

      if (!sceneLoading) {
        setLoaderVisible(false);
      }
    },
    [sceneLoading]
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const onHashChange = () => {
      setActiveProjectId(getProjectIdFromHash());
    };

    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const nextHash = activeProjectId ? `#${activeProjectId}` : "";

    if (window.location.hash === nextHash) {
      return;
    }

    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${nextHash}`
    );
  }, [activeProjectId]);

  return (
    <div className="portfolio-shell">
      <div className="scene-layer" aria-hidden="true">
        <ConstellationScene
          projects={projects}
          activeProjectId={activeProjectId}
          onSelectProject={setActiveProjectId}
          reducedMotion={reduceMotion}
          onReady={handleSceneReady}
          introUnlocked={!loaderVisible}
        />
      </div>

      {loaderVisible && (
        <div
          className={`loading-overlay${sceneLoading ? "" : " is-hidden"}`}
          aria-live="polite"
          onTransitionEnd={handleLoaderTransitionEnd}
        >
          <div className="loading-spinner" />
        </div>
      )}

      {loaderVisible && (
        <div className="panel-prewarm" aria-hidden="true">
          <ProjectPanel project={projects[0] ?? null} />
        </div>
      )}

      <header className="hud-header">
        <p className="hud-label">Joshua Simpson Portfolio</p>
        <h1>Selected Works</h1>
        <p className="hud-lede">
          Realtime 3D particle simulation, voice-agent platform, and an Android
          memory game.
        </p>
      </header>

      <main className="hud-panel">
        <ProjectPanel project={activePanelProject} />
      </main>

      <button
        type="button"
        className={`neutral-reset${hasActiveProject ? "" : " is-hidden"}`}
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
          const isActive = project.id === activeProjectId;

          return (
            <button
              key={project.id}
              type="button"
              className={`project-pill ${isActive ? "active" : ""}`}
              onClick={() =>
                setActiveProjectId((previous) =>
                  previous === project.id ? null : project.id
                )
              }
              aria-pressed={isActive}
            >
              <span
                className="pill-dot"
                style={{ backgroundColor: project.color }}
                aria-hidden="true"
              />
              <span>{project.title}</span>
            </button>
          );
        })}
      </nav>

      <p className="interaction-hint">DRAG TO ROTATE. CLICK TO NAVIGATE.</p>
    </div>
  );
}

export default App;
