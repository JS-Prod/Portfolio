import { useEffect, useMemo, useState } from "react";

import type { Project } from "../data/projects";

type ProjectPanelProps = {
  project: Project | null;
};

type InsightTabKey = "demo" | "contribution" | "approach" | "impact";

type InsightTab = {
  key: InsightTabKey;
  label: string;
  content: string;
};

function toVisibleUrl(href: string): string {
  if (typeof window === "undefined") {
    return href;
  }

  try {
    return new URL(href, window.location.href).toString();
  } catch {
    return href;
  }
}

function isExternalHref(href: string): boolean {
  if (typeof window === "undefined") {
    return /^https?:\/\//.test(href);
  }

  try {
    return (
      new URL(href, window.location.href).origin !== window.location.origin
    );
  } catch {
    return false;
  }
}

export function ProjectPanel({ project }: ProjectPanelProps) {
  const [activeTab, setActiveTab] = useState<InsightTabKey>("demo");

  useEffect(() => {
    setActiveTab("demo");
  }, [project?.id]);

  const insightTabs = useMemo<InsightTab[]>(() => {
    if (!project) {
      return [];
    }

    return [
      {
        key: "demo",
        label: "Demo",
        content: project.demoNote,
      },
      { key: "contribution", label: "Role", content: project.contribution },
      { key: "approach", label: "Decisions", content: project.approach },
      { key: "impact", label: "Results", content: project.impact },
    ];
  }, [project]);

  const activeInsight =
    insightTabs.find((tab) => tab.key === activeTab) ?? insightTabs[0] ?? null;
  const demoLinks = useMemo(() => {
    if (!project) {
      return [];
    }

    if (project.demoLinks && project.demoLinks.length > 0) {
      return project.demoLinks;
    }

    return project.demoUrl
      ? [{ label: project.demoLabel || "Demo", href: project.demoUrl }]
      : [];
  }, [project]);

  return (
    <aside className="project-panel" aria-live="polite" aria-atomic="true">
      <article className="project-card">
        {project ? (
          <>
            <div className="project-meta">
              <span>{project.year}</span>
              <span>{project.role}</span>
            </div>

            <h2>{project.title}</h2>
            <p>{project.summary}</p>

            <div className="insight-panel">
              <div
                className="insight-tabs"
                role="tablist"
                aria-label="Project insights"
              >
                {insightTabs.map((tab) => {
                  const isActive = activeTab === tab.key;

                  return (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      className={`insight-tab ${isActive ? "active" : ""}`}
                      aria-selected={isActive}
                      onClick={() => setActiveTab(tab.key)}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              <div className="insight-content">
                <h3>{activeInsight?.label ?? "Demo"}</h3>
                <p>{activeInsight?.content ?? project.demoNote}</p>
                {activeInsight?.key === "demo" && demoLinks.length > 0 ? (
                  <div className="insight-hotlinks">
                    {demoLinks.map((link) => {
                      const external = isExternalHref(link.href);
                      const visibleUrl = toVisibleUrl(link.href);

                      return (
                        <p
                          className="insight-hotlink-row"
                          key={`${link.label}-${link.href}`}
                        >
                          <span className="insight-hotlink-label">
                            {link.label}:
                          </span>{" "}
                          <a
                            className="insight-hotlink"
                            href={link.href}
                            target={external ? "_blank" : undefined}
                            rel={external ? "noreferrer" : undefined}
                          >
                            {visibleUrl}
                          </a>
                        </p>
                      );
                    })}
                  </div>
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
            <p>Select a project node to learn more about it.</p>
            <div className="impact-block">
              <h3>Tip</h3>
              <p>
                To return to this view when viewing a project use the upwards
                arrow at the top of the screen or click the project's badge at
                the bottom of the screen.
              </p>
            </div>
          </>
        )}
      </article>
    </aside>
  );
}
