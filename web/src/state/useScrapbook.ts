import { useEffect, useState } from "preact/hooks";
import type { ScrapbookSnapshot, ScrapbookStore } from "./scrapbookStore";

export function useScrapbook(store: ScrapbookStore): ScrapbookSnapshot {
  const [snapshot, setSnapshot] = useState(() => store.snapshot());
  useEffect(() => {
    setSnapshot(store.snapshot());
    return store.subscribe(() => setSnapshot(store.snapshot()));
  }, [store]);
  return snapshot;
}
