export type EventVisualDensity = "compact" | "regular" | "roomy";

export const EVENT_REGULAR_MIN_HEIGHT = 42;
export const EVENT_ROOMY_MIN_HEIGHT = 64;

export interface EventVisualLayout {
  density: EventVisualDensity;
  showMetadata: boolean;
}

/** Choose Timeline information density from the actual rendered card height. */
export function eventVisualLayout(height: number): EventVisualLayout {
  if (height < EVENT_REGULAR_MIN_HEIGHT) {
    return { density: "compact", showMetadata: false };
  }
  if (height < EVENT_ROOMY_MIN_HEIGHT) {
    return { density: "regular", showMetadata: true };
  }
  return { density: "roomy", showMetadata: true };
}
