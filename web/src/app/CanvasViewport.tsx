import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

const CANVAS_WIDTH = 402;

interface CanvasViewportProps {
  children: ComponentChildren;
  height?: number;
  fitViewportHeight?: boolean;
}

export interface CanvasViewportMetrics {
  scale: number;
  canvasHeight: number;
}

export function canvasViewportMetrics(viewportWidth: number, viewportHeight: number, height = 874, fitViewportHeight = false): CanvasViewportMetrics {
  const scale = Math.min(1, viewportWidth / CANVAS_WIDTH);
  return {
    scale,
    canvasHeight: fitViewportHeight ? Math.min(height, viewportHeight / scale) : height
  };
}

export function CanvasViewport({ children, height = 874, fitViewportHeight = false }: CanvasViewportProps) {
  const measure = () => canvasViewportMetrics(window.innerWidth, window.visualViewport?.height ?? window.innerHeight, height, fitViewportHeight);
  const [metrics, setMetrics] = useState(measure);

  useEffect(() => {
    const updateMetrics = () => setMetrics(measure());
    window.addEventListener("resize", updateMetrics);
    window.visualViewport?.addEventListener("resize", updateMetrics);
    return () => {
      window.removeEventListener("resize", updateMetrics);
      window.visualViewport?.removeEventListener("resize", updateMetrics);
    };
  }, [height, fitViewportHeight]);

  return (
    <div
      class="canvas-viewport"
      style={{
        width: `${CANVAS_WIDTH * metrics.scale}px`,
        height: `${metrics.canvasHeight * metrics.scale}px`
      }}
    >
      <div class="scaled-canvas" style={{ height: `${metrics.canvasHeight}px`, transform: `scale(${metrics.scale})` }}>
        {children}
      </div>
    </div>
  );
}
