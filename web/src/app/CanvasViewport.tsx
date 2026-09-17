import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

const CANVAS_WIDTH = 402;

interface CanvasViewportProps {
  children: ComponentChildren;
  height?: number;
  fitViewportHeight?: boolean;
  fitWholeViewport?: boolean;
}

export interface CanvasViewportMetrics {
  scale: number;
  canvasHeight: number;
}

export function canvasViewportMetrics(
  viewportWidth: number,
  viewportHeight: number,
  height = 874,
  fitViewportHeight = false,
  fitWholeViewport = false
): CanvasViewportMetrics {
  const scale = Math.min(
    1,
    viewportWidth / CANVAS_WIDTH,
    fitWholeViewport ? viewportHeight / height : 1
  );
  return {
    scale,
    canvasHeight: fitViewportHeight ? Math.min(height, viewportHeight / scale) : height
  };
}

export function CanvasViewport({ children, height = 874, fitViewportHeight = false, fitWholeViewport = false }: CanvasViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const measure = () => {
    const fitParent = fitViewportHeight || fitWholeViewport;
    const parentRect = fitParent
      ? viewportRef.current?.parentElement?.getBoundingClientRect()
      : null;
    const parentHasSize = Boolean(parentRect && parentRect.width > 0 && parentRect.height > 0);
    const availableHeight = parentHasSize ? parentRect!.height : window.innerHeight;
    return canvasViewportMetrics(
      parentHasSize ? parentRect!.width : window.innerWidth,
      availableHeight,
      height,
      fitViewportHeight,
      fitWholeViewport
    );
  };
  const [metrics, setMetrics] = useState(measure);

  useLayoutEffect(() => {
    const updateMetrics = () => setMetrics(measure());
    const parent = viewportRef.current?.parentElement;
    const resizeObserver = parent && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(updateMetrics)
      : null;
    if (parent && resizeObserver) resizeObserver.observe(parent);
    window.addEventListener("resize", updateMetrics);
    updateMetrics();
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateMetrics);
    };
  }, [height, fitViewportHeight, fitWholeViewport]);

  return (
    <div
      ref={viewportRef}
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
