export function shouldPreventMultiTouch(touchCount: number): boolean {
  return touchCount > 1;
}

export function installAppPinchGuard(target: EventTarget): () => void {
  const preventGesture = (event: Event) => event.preventDefault();
  const preventMultiTouch = (event: Event) => {
    const touches = (event as TouchEvent).touches;
    if (touches && shouldPreventMultiTouch(touches.length)) event.preventDefault();
  };
  const options: AddEventListenerOptions = { passive: false };

  target.addEventListener("touchstart", preventMultiTouch, options);
  target.addEventListener("touchmove", preventMultiTouch, options);
  target.addEventListener("gesturestart", preventGesture, options);
  target.addEventListener("gesturechange", preventGesture, options);
  target.addEventListener("gestureend", preventGesture, options);

  return () => {
    target.removeEventListener("touchstart", preventMultiTouch, options);
    target.removeEventListener("touchmove", preventMultiTouch, options);
    target.removeEventListener("gesturestart", preventGesture, options);
    target.removeEventListener("gesturechange", preventGesture, options);
    target.removeEventListener("gestureend", preventGesture, options);
  };
}
