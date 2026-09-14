import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

const CANVAS_WIDTH = 402;

interface CanvasViewportProps {
  children: ComponentChildren;
  height?: number;
}

export function CanvasViewport({ children, height = 874 }: CanvasViewportProps) {
  const [scale, setScale] = useState(() => Math.min(1, window.innerWidth / CANVAS_WIDTH));

  useEffect(() => {
    const updateScale = () => setScale(Math.min(1, window.innerWidth / CANVAS_WIDTH));
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  return (
    <div
      class="canvas-viewport"
      style={{
        width: `${CANVAS_WIDTH * scale}px`,
        height: `${height * scale}px`
      }}
    >
      <div class="scaled-canvas" style={{ transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}
