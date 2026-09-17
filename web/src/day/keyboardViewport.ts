export interface TimelineRect {
  top: number;
  bottom: number;
  width: number;
}

export interface VisualViewportMetrics {
  height: number;
  offsetTop: number;
}

export interface TimelineVisibility {
  scale: number;
  topInset: number;
  visibleHeight: number;
  bottomOcclusion: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function timelineVisibility(
  rect: TimelineRect,
  clientWidth: number,
  clientHeight: number,
  viewport?: VisualViewportMetrics | null
): TimelineVisibility {
  const scale = clientWidth > 0 && rect.width > 0 ? rect.width / clientWidth : 1;
  if (!viewport || viewport.height <= 0) {
    return { scale, topInset: 0, visibleHeight: clientHeight, bottomOcclusion: 0 };
  }

  const viewportTop = viewport.offsetTop;
  const viewportBottom = viewportTop + viewport.height;
  const visibleTop = Math.max(rect.top, viewportTop);
  const visibleBottom = Math.min(rect.bottom, viewportBottom);
  const topInset = clamp((visibleTop - rect.top) / scale, 0, clientHeight);
  const visibleHeight = clamp((visibleBottom - visibleTop) / scale, 0, clientHeight - topInset);
  const bottomOcclusion = clamp(clientHeight - topInset - visibleHeight, 0, clientHeight);

  return { scale, topInset, visibleHeight, bottomOcclusion };
}
