import { describe, expect, it, vi } from "vitest";
import { installAppPinchGuard, shouldPreventMultiTouch } from "../../src/app/pinchGuard";

class TouchLikeEvent extends Event {
  constructor(type: string, readonly touches: { length: number }) {
    super(type, { cancelable: true });
  }
}

describe("app pinch guard", () => {
  it("distinguishes multi-touch without consuming single-finger gestures", () => {
    expect(shouldPreventMultiTouch(1)).toBe(false);
    expect(shouldPreventMultiTouch(2)).toBe(true);
  });

  it("cancels multi-touch and WebKit gesture events, then removes its listeners", () => {
    const target = new EventTarget();
    const remove = installAppPinchGuard(target);
    const oneFinger = new TouchLikeEvent("touchmove", { length: 1 });
    const twoFingers = new TouchLikeEvent("touchmove", { length: 2 });
    const gesture = new Event("gesturestart", { cancelable: true });

    target.dispatchEvent(oneFinger);
    target.dispatchEvent(twoFingers);
    target.dispatchEvent(gesture);
    expect(oneFinger.defaultPrevented).toBe(false);
    expect(twoFingers.defaultPrevented).toBe(true);
    expect(gesture.defaultPrevented).toBe(true);

    remove();
    const afterRemove = new TouchLikeEvent("touchmove", { length: 2 });
    const preventDefault = vi.spyOn(afterRemove, "preventDefault");
    target.dispatchEvent(afterRemove);
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
