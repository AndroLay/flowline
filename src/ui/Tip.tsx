import { useCallback, useEffect, useState, type FocusEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";

/**
 * What one popup says. Every line is handed in by whoever owns the fact — a panel here
 * never derives a number of its own, so it cannot disagree with the board it is drawn on.
 */
export type TipContent = {
  name: string;
  lines: string[];
  /** What picking the thing does, when picking it does anything. */
  action?: string;
  /** Ties the heading to the state it reports: `at-risk`, `missed`, `offline`, `deadline`. */
  state?: string;
};

type Placed = TipContent & {
  x: number;
  y: number;
  side: "top" | "bottom";
  align: "start" | "center" | "end";
  /** Widest this panel may draw here. Alignment alone cannot keep a wide panel on screen. */
  maxWidth: number;
  /** True when the keyboard opened it, which is the one case a scroll must not close. */
  pinned: boolean;
  /** True when a finger opened it: a touch leaves the moment it lands, so leaving cannot close it. */
  touch: boolean;
  /** The thing described. Only this element's own leave or blur is allowed to close it. */
  anchor: HTMLElement;
};

/**
 * What one surface hands to its parts: call it with the facts a part owns and spread the
 * result onto that part. Handing this down instead of a second hook is what keeps exactly
 * one panel open per surface, however many things on it can be pointed at.
 */
export type TipBinder = (content: TipContent) => {
  onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: PointerEvent<HTMLElement>) => void;
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  onBlur: (event: FocusEvent<HTMLElement>) => void;
};

/** The widest a panel is ever allowed to be, and the margin it keeps from a window edge. */
const MAX_PANEL = 272;
const EDGE = 12;

/**
 * One popup, delivered from outside every clipping ancestor.
 *
 * The arena cannot parent a panel to the thing it describes: `.board` and `.bays` clip
 * their own overflow on purpose — that clip is what keeps the 2.5D extrusion faces inside
 * the panel — so a panel hanging off a slab would be cut in half. A single fixed panel in
 * a portal escapes all of that, and the same mechanism then serves the 3D floor, so both
 * surfaces answer a cursor in one voice.
 *
 * It opens on pointer enter and on focus, and closes on leave, blur or Escape. A finger is
 * the exception: a touch leaves its target the instant it lifts, so a touch-opened panel
 * stays until the next tap outside it. Nothing here runs per pointer move or per frame.
 */
export function useTip() {
  const [placed, setPlaced] = useState<Placed>();

  const open = useCallback((element: HTMLElement, content: TipContent, how: { pinned?: boolean; touch?: boolean } = {}) => {
    const box = element.getBoundingClientRect();
    const view = window.innerWidth;
    // Kept a panel's margin away from either edge, so the anchor point itself is never so
    // close to the edge that no width can satisfy it.
    const x = Math.min(Math.max(Math.round(box.left + box.width / 2), 2 * EDGE), view - 2 * EDGE);
    // Below the halfway line a panel opens upward, so it never leaves the window on the
    // side the pointer came from.
    const above = box.top > window.innerHeight * 0.44;
    // Centred costs width near an edge: the panel can only be twice its distance to the
    // nearer side. Where that costs nothing it stays centred on the target; where it would,
    // the panel is pinned to the edge instead and keeps its full width. Either way the
    // ceiling below is what a panel can actually occupy from here, so it cannot overrun the
    // window the way a fixed guess at its width could.
    const roomy = Math.min(MAX_PANEL, view - 2 * EDGE);
    const centred = 2 * Math.min(x - EDGE, view - x - EDGE);
    const align = centred >= roomy ? "center" : x < view / 2 ? "start" : "end";
    setPlaced((current) => ({
      ...content,
      pinned: how.pinned ?? false,
      // A tap on something focusable fires focus straight after the touch, and that second
      // opening must not forget a finger started it.
      touch: how.touch ?? (current?.anchor === element ? current.touch : false),
      anchor: element,
      x,
      y: Math.round(above ? box.top - 9 : box.bottom + 9),
      side: above ? "top" : "bottom",
      align,
      maxWidth: align === "center" ? roomy : Math.min(roomy, align === "start" ? view - x : x),
    }));
  }, []);

  /**
   * Close only if this element still owns what is open. Moving between two targets with a
   * finger interleaves the events — the next panel is already up before the last target's
   * leave and blur arrive — so a leave from a target that no longer owns the panel is a
   * no-op rather than a panel that vanishes on arrival.
   */
  const closeFrom = useCallback((element: HTMLElement) => {
    setPlaced((current) => (current && current.anchor !== element ? current : undefined));
  }, []);

  useEffect(() => {
    if (!placed) return undefined;
    function dismiss(event: KeyboardEvent) {
      if (event.key === "Escape") setPlaced(undefined);
    }
    // The panel is fixed to the viewport and placed once, from the box the pointer
    // actually reached, so anything that moves that box out from under it closes it
    // rather than leaving a panel pointing at nothing. A keyboard-opened panel is exempt
    // from the scroll rule: focusing a target scrolls it into view, and closing on that
    // would shut every panel the Tab key opens. Both listeners exist only while a panel
    // is open, and neither runs per pointer move or per frame.
    const drop = () => setPlaced(undefined);
    // A finger-opened panel has no pointer left to leave with, so the next tap outside the
    // thing it describes is what dismisses it. The tap that opened it lands inside, which
    // is why opening and dismissing on the same gesture cannot happen.
    const elsewhere = (event: Event) => {
      if (!placed.anchor.contains(event.target as Node)) setPlaced(undefined);
    };
    window.addEventListener("keydown", dismiss, { capture: true });
    window.addEventListener("resize", drop, { passive: true });
    if (!placed.pinned) window.addEventListener("scroll", drop, { capture: true, passive: true });
    if (placed.touch) window.addEventListener("pointerdown", elsewhere, { capture: true, passive: true });
    return () => {
      window.removeEventListener("keydown", dismiss, { capture: true });
      window.removeEventListener("resize", drop);
      window.removeEventListener("scroll", drop, { capture: true });
      window.removeEventListener("pointerdown", elsewhere, { capture: true });
    };
  }, [placed]);

  /** Spread onto whatever the panel describes. It adds no class and no markup. */
  const tipProps = useCallback<TipBinder>((content) => ({
    onPointerEnter: (event: PointerEvent<HTMLElement>) => open(event.currentTarget, content, { touch: event.pointerType === "touch" }),
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType !== "touch") closeFrom(event.currentTarget);
    },
    onFocus: (event: FocusEvent<HTMLElement>) => open(event.currentTarget, content, { pinned: event.currentTarget.matches(":focus-visible") }),
    onBlur: (event: FocusEvent<HTMLElement>) => closeFrom(event.currentTarget),
  }), [closeFrom, open]);

  const dock = placed
    ? createPortal(
        <div
          className={`tip${placed.state ? ` is-${placed.state}` : ""}`}
          style={{ left: `${placed.x}px`, top: `${placed.y}px`, maxWidth: `${placed.maxWidth}px` }}
          data-side={placed.side}
          data-align={placed.align}
          // Every sentence in here is already in the accessible name of the thing the
          // panel describes, so announcing it twice is the only thing left to avoid.
          aria-hidden="true"
        >
          <b>{placed.name}</b>
          {placed.lines.map((line) => <small key={line}>{line}</small>)}
          {placed.action && <em>{placed.action}</em>}
        </div>,
        document.body,
      )
    : null;

  return { tipProps, dock };
}

/** The same sentences the panel shows, for a reader who is not hovering anything. */
export function tipSentence(content: TipContent): string {
  return `${content.name}. ${content.lines.join(". ")}.${content.action ? ` ${content.action}.` : ""}`;
}
