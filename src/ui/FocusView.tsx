import { useEffect, useRef, useState } from "react";
import type { FocusTarget } from "../domain/model.ts";
import type { SceneModel } from "../visual/scene-model.ts";
import type { Flowline3DController } from "../visual/flowline-3d.ts";

/**
 * Optional WebGL magnifier over the state the timeline already proves. It never
 * owns state: the canvas is a second reading of the same revision, and the
 * inspector beside it carries the same facts in text for the DOM fallback.
 */
export function FocusView({ model, onFocus, onClose }: { model: SceneModel; onFocus: (focus: FocusTarget) => void; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<Flowline3DController | undefined>(undefined);
  const [rendererState, setRendererState] = useState<"loading" | "ready" | "fallback">("loading");
  const [rendererError, setRendererError] = useState("");
  const reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const captureBuffer = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("flowline-capture");

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    void import("../visual/flowline-3d.ts").then(({ createFlowline3D }) => {
      if (!active || !canvasRef.current) return;
      try {
        const controller = createFlowline3D(canvasRef.current, model, { reducedMotion, preserveDrawingBuffer: captureBuffer });
        if (!active) {
          controller.dispose();
          return;
        }
        controllerRef.current = controller;
        // A non-enumerable local inspection hook lets the CDP evidence harness
        // read renderer.info and frame samples without adding a production HUD
        // or a second render loop. It is removed together with the renderer.
        Object.defineProperty(canvasRef.current, "__flowlineController", { configurable: true, value: controller });
        setRendererState("ready");
      } catch (error) {
        setRendererError(error instanceof Error ? error.message : "WebGL could not be started.");
        setRendererState("fallback");
      }
    }).catch((error: unknown) => {
      if (!active) return;
      setRendererError(error instanceof Error ? error.message : "The optional focus renderer could not be loaded.");
      setRendererState("fallback");
    });
    return () => {
      active = false;
      if (canvasRef.current && Object.prototype.hasOwnProperty.call(canvasRef.current, "__flowlineController")) {
        delete (canvasRef.current as HTMLCanvasElement & { __flowlineController?: Flowline3DController }).__flowlineController;
      }
      controllerRef.current?.dispose();
      controllerRef.current = undefined;
    };
  }, [captureBuffer, reducedMotion]);

  useEffect(() => {
    if (rendererState === "ready") controllerRef.current?.update(model);
  }, [model, rendererState]);
  return (
    <div className="modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`modal__panel focus-view focus-view--${rendererState}`} role="dialog" aria-modal="true" aria-labelledby="focus-title" aria-busy={rendererState === "loading"}>
        <header className="modal__head">
          <div>
            <span className="micro micro--mint">Focus layer / optional WebGL</span>
            <h2 id="focus-title">Causal slice of the live floor.</h2>
          </div>
          <div className="focus-view__actions">
            <span className={`dot-label dot-label--${rendererState === "ready" ? "mint" : rendererState === "fallback" ? "coral" : "muted"}`}>
              <i />{rendererState === "ready" ? "Renderer live" : rendererState === "loading" ? "Loading focus" : "2D fallback active"}
            </span>
            <button className="modal__close" type="button" onClick={onClose} aria-label="Close focus view">×</button>
          </div>
        </header>
        <div className="focus-view__body">
          <div className="focus-view__viewport" data-renderer-state={rendererState}>
            <canvas ref={canvasRef} className="focus-view__canvas" aria-label="Flowline 3D focus scene. The same state is described in the inspector beside this canvas." />
            {rendererState === "loading" && <p className="focus-view__overlay" role="status">Preparing the focus layer… <small>The 2.5D timeline remains the source of truth.</small></p>}
            {rendererState === "fallback" && (
              <p className="focus-view__overlay" role="status">
                <b>WebGL unavailable</b>
                The floor is still playable in 2D.
                <small>{rendererError}</small>
              </p>
            )}
            <span className="focus-view__stamp">
              <b>Rev {String(model.revision).padStart(2, "0")}</b>
              <b>{model.shockApplied ? "Disruption active" : "Normal shift"}</b>
            </span>
          </div>
          <aside className="focus-view__inspector" aria-label="Semantic focus inspector">
            <div>
              <span className="micro">Inspector</span>
              <strong>{model.focusedStationId === "prep" ? "Prep bay" : "Dispatch bay"}</strong>
              <small>{model.focusSource} focus · revision {model.revision}</small>
            </div>
            <div>
              <span className="micro">Causal path</span>
              <p className="focus-view__path">{model.causalPath.join(" → ")}</p>
            </div>
            <div>
              <span className="micro">Live outcome</span>
              <strong>{model.metrics.onTimeJobs}/{model.metrics.totalJobs} on time</strong>
              <small>{model.metrics.makespan} slot makespan · {model.metrics.totalWaiting} waiting · {model.metrics.dispatchIdle} idle</small>
            </div>
            <p className={`focus-view__finding is-${model.auditSeverity}`} aria-live="polite">{model.auditFinding}</p>
          </aside>
        </div>
        <div className="focus-view__controls">
          <div className="focus-view__group">
            <span className="micro">Station focus</span>
            {model.stations.map((station) => (
              <button type="button" key={station.id} className={station.id === model.focusedStationId ? "is-on" : ""} onClick={() => onFocus({ stationId: station.id, source: "player" })}>
                <b>{station.shortLabel}</b><small>{station.activeCapacity}/{station.capacity}{station.disrupted ? " · offline" : ""}</small>
              </button>
            ))}
          </div>
          <div className="focus-view__group">
            <span className="micro">Job focus</span>
            {model.jobs.map((job) => (
              <button type="button" key={job.id} className={job.selected ? "is-on" : ""} onClick={() => onFocus({ stationId: "dispatch", jobId: job.id, source: "player" })}>
                <b>{job.shortLabel}</b><small>D{job.deadline} · {job.status.replace("-", " ")}</small>
              </button>
            ))}
          </div>
        </div>
        <p className="focus-view__semantic" aria-live="polite">
          {model.jobs.map((job) => `${job.shortLabel} is ${job.status}, queue ${job.queuePosition + 1}, dispatching at slot ${job.dispatchEnd + 1}${job.tardiness ? `, ${job.tardiness} late` : ""}`).join(". ")}.{" "}
          {model.ghostJobs.length ? `A ghost proposal shows ${model.ghostJobs.map((job) => job.shortLabel).join(", ")} in an uncommitted alternative order.` : "No uncommitted ghost plan is active."}
        </p>
      </section>
    </div>
  );
}
