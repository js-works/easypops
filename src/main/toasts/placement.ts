// -------------------------------------------------------------------
// Stack placement: split a Placement into axes and anchor the container's inline styles.
// -------------------------------------------------------------------

import type { Placement } from "./options.js";

export function splitPlacement(placement: Placement): {
  vertical: "top" | "bottom";
  horizontal: "start" | "center" | "end";
} {
  const [vertical, horizontal] = placement.split("-") as [
    "top" | "bottom",
    "start" | "center" | "end",
  ];
  return { vertical, horizontal };
}

// Anchor the container. Applied as inline styles so two controllers can live in
// different corners; the newest toast always sits nearest the anchored
// edge (column for bottom, column-reverse for top).
export function applyPlacement(container: HTMLElement, placement: Placement) {
  const { vertical, horizontal } = splitPlacement(placement);
  const s = container.style;

  s.flexDirection = vertical === "top" ? "column-reverse" : "column";
  s.top = vertical === "top" ? "20px" : "auto";
  s.bottom = vertical === "bottom" ? "20px" : "auto";

  if (horizontal === "center") {
    // Center is symmetric, so use physical left/right — and CLEAR the logical
    // insets. Mixing them is a trap: inset-inline-start resolves to `left` in
    // LTR and, being assigned after `left` here, its "auto" would override the
    // "50%" and defeat the centering entirely.
    s.insetInlineStart = "";
    s.insetInlineEnd = "";
    s.left = "50%";
    s.right = "auto";
    s.transform = "translateX(-50%)";
    s.alignItems = "center";
  } else {
    // Corners use logical insets (RTL-aware); clear the physical ones so they
    // don't linger and conflict.
    s.left = "";
    s.right = "";
    s.transform = "none";
    s.insetInlineEnd = horizontal === "end" ? "20px" : "auto";
    s.insetInlineStart = horizontal === "start" ? "20px" : "auto";
    s.alignItems = horizontal === "end" ? "flex-end" : "flex-start";
  }
}
