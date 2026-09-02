# Flowline rendering and performance evidence

Date: 2026-09-02
Package: `submissions/flowline`
Build: production Vite preview from the current working tree
Browser: Chromium 151.0.7922.137 headless, SwiftShader WebGL
Hardware class: local Linux workstation; not a representative mobile device
Status: implementation evidence only; desktop p95 gate remains on hold

## What was measured

The browser harness opened the package, entered the arena, opened the focus layer,
and alternated the two station-focus controls for ten seconds. Alternating focus
keeps the guided camera transition active so the renderer is measured while it is
doing work. Five independent samples were collected for each viewport. The normal
route used `preserveDrawingBuffer: false`; the screenshot-only route can opt into
`?flowline-capture=1` and was not used for the performance numbers.

The committed scene at first render contained 24 geometries, 0 textures, 26 draw
calls, and 910 triangles. A pending ghost proposal increased draw calls only while
that visual state was active; no new domain simulator or renderer loop was created.

## Results

| Viewport | Samples | Median FPS per sample | p95 frame time per sample | Long tasks >50 ms | Overflow |
| --- | ---: | --- | --- | ---: | ---: |
| 1440 × 900 | 5 × 10 s | 59.88, 59.88, 59.88, 59.88, 59.88 | 33.30, 33.30, 33.30, 33.30, 33.30 ms | 0 in every sample | 0 in every sample |
| 390 × 844 | 5 × 10 s | 59.88, 59.88, 59.88, 59.88, 59.88 | 16.80, 16.70, 16.70, 16.70, 16.80 ms | 0 in every sample | 0 in every sample |

Internal target: median at least 55 FPS and p95 frame time at most 20 ms.

- Mobile meets both measured targets in this environment.
- Desktop meets the median target but not the p95 target. The repeated 33.3 ms
  cadence appears in a low-triangle SwiftShader/headless run, so it is not enough
  evidence to call the scene slow or fast on real hardware. It is nevertheless a
  hard-gate hold, not a pass.
- No long task above 50 ms was observed during these samples.

## Lazy loading and lifecycle evidence

- A fresh production navigation requested no `flowline-3d` or Three.js resource
  before the focus button was opened.
- Opening focus requested the separate `assets/flowline-3d-Cre6ogYv.js` chunk and
  reported `renderer live`.
- The 1440px canvas measured 542 × 400 CSS pixels; the 390px canvas measured
  322 × 300 CSS pixels. Both routes had zero document overflow.
- The browser journey showed the 2.5D timeline and semantic inspector while the
  WebGL scene was present.
- Twenty open/close cycles completed without uncaught exceptions and ended with
  zero canvas elements. The renderer source explicitly cancels the animation
  handle, disconnects `ResizeObserver` and `IntersectionObserver`, removes the
  visibility listener, disposes geometries/materials/render lists, disposes the
  renderer, and releases the WebGL context.
- A forced WebGL-unavailable run showed `focus-view--fallback`, the message “The
  floor is still playable in 2D.”, the timeline still present, and zero overflow.
- A reduced-motion run reported `prefers-reduced-motion: reduce`, rendered one
  settled frame without a transition loop, kept the timeline present, and had zero
  overflow.

## Interpretation boundary

This evidence does not prove performance on every device, a hosted URL, or genuine
natural-language agent invocation. It also does not replace a real-device cold and
warm-cache run. The 2.5D DOM path remains the playable release fallback until the
desktop p95 result is repeated on representative hardware.

The focus layer is therefore currently classified as:

> visually implemented, locally verified, performance-approved on mobile, and
> performance-held on desktop pending representative hardware evidence.
