# JoyoFit Studio

A watch-face editor for the Huawei Watch Fit 4 and Fit 4 Pro (408 × 480, screen code `HWHD13`). It runs in the browser,
renders every digit, hand, ring and icon to a bitmap, and writes a `.hwt` package that JoyoFit installs from
**Watch faces → Install from file**. Nothing is uploaded: the Worker only serves static files.

Live: https://joyofit-studio.dzulfikar-at.workers.dev

Stack: Vite 8, React 19, Tailwind v4, zustand, `@cloudflare/vite-plugin` (a Worker with static assets, no bindings),
and [`packages/hwt`](../packages/hwt) for the `.hwt` format. Design: JoyoRogo's tokens and components (paper canvas,
borderless white cards, big radii, Plus Jakarta Sans) with JoyoFit's ink-teal primary and per-metric data colors from
`src/theme.ts`. The copied JoyoRogo files say where they came from in a header comment (`src/ui/*`, `src/styles.css`).

## Develop

```sh
cd web
bun install
bun run dev            # http://localhost:3100
bun run typecheck
bun run test           # vitest, runs in node with @napi-rs/canvas
bunx playwright install chromium   # once
bun run test:e2e       # Playwright against a local dev server on :4173
STUDIO_URL=https://joyofit-studio.dzulfikar-at.workers.dev bun run test:e2e   # the same tests against a deployment
bun run build          # tsc --noEmit && vite build, output in dist/
bunx wrangler deploy --dry-run
bun run deploy         # build + wrangler deploy
```

`wrangler.jsonc` pins the Cloudflare account and the Worker name `joyofit-studio`. The Vite plugin writes
`dist/wrangler.json` and a `.wrangler/deploy/config.json` redirect, so `wrangler deploy` ships `dist/`.
`@joyofit/hwt` is an alias to `../packages/hwt/src/index.ts` (Vite, Vitest and `tsconfig.json`); there is no workspace
dependency and no copy of the codec.

## How it works

```
model/        Project JSON (elements bottom to top), assets (IndexedDB), project file import/export
render/       canvas.ts      OffscreenCanvas in the browser, @napi-rs/canvas in tests (setCanvasFactory)
              glyphs.ts      digit sets 0-9 + colon, word sets (weekday, month, AM/PM): the sprites
              shapes.ts      hand shapes, icons, ring and track sprites
              layout.ts      where each sprite of a time / date / widget element goes (shared by preview and export)
              scene.ts       draws a project for a simulated watch state; bounds for selection
editor/       zustand store (history, autosave), Stage (canvas, drag, resize, guides), panels, dialogs
templates/    six starter faces, built from the same element factories
export/       support.ts     what may be exported, from the codec's value-id evidence
              build.ts       project -> .hwt, plus the layout sidecar
```

The preview draws the same bitmaps the export encodes, so what the editor shows is what the watch is given. Text is
rendered once to digit images in the chosen font (a digit sequence on the watch advances by image width and has no
spacing setting, so letter spacing is baked into the images). Fonts are `@fontsource` packages (SIL OFL), loaded per
weight on demand and never from a third party at run time.

### Export mapping

| Editor element | In the `.hwt` | Ids |
|---|---|---|
| Background | `BACKGROUND` element: image(s) at 0,0 (split into bands when one image would pass 750 KB), plus a black image for the always-on display | none |
| Image / sticker | `SINGLE_RES` in a `BACKGROUND` element, cropped to the screen (positions cannot be negative) | none |
| Digital time | `TIME` element: hour and minute `COMBINED_RES` (ten digit images each), colon `SINGLE_RES` | hour 12, minute 13 (verified) |
| Seconds | two `SELECTED_RES` (6 and 10 images) | 63, 64 (inferred) |
| Date | weekday `SELECTED_RES` (slot 0 repeats Monday, Monday first), day `COMBINED_RES`, month `SELECTED_RES` (slot 0 repeats January) | 52, 17, 51 (verified) |
| Hands | `HAND_RES` in a `TIME` element; rotation box is a square centred on the pivot, as far across as the tip is from it | second 154 (verified); hour 150, minute 153 (inferred) |
| Steps, heart rate, battery widgets | `WIDGET` element with a container (`data_type` 10, 11, 17): icon `SINGLE_RES` + number `COMBINED_RES` | 0, 2, 9 (verified) |
| Progress rings | container with the track as `SINGLE_RES` and the full arc as `ARC_RES`, angles from start and sweep | steps 161, battery 163 (inferred) |
| AM/PM marker, calories | not exported: **preview only** | no id known |

Every element is marked **verified**, **unconfirmed** (inferred ids, exported only while "Include unconfirmed elements"
is on in the export dialog) or **preview only** (never exported, listed in the checklist). The levels come from
`VALUE_TYPES[].evidence` in the codec, so they follow the codec as it learns ids.

The always-on display is a black screen with the time, date and hour and minute hands at 45 percent brightness. The
export dialog reports the share of lit pixels against Huawei's 20 percent guideline.

Files written: `<Name>.hwt` (letters and digits only), `<Name>.layout.json` (the layout and image table, for
troubleshooting) and `<Name>.project.json` (the project with its images embedded).

### What the tests cover

- `render/*.test.ts`: digit and word sprites (cell size, ink height, baseline, color, outline, caching), layout of time,
  date and widgets, hand and ring sprites, hand angles.
- `export/build.test.ts`: export a template, re-read it with `readHwt`, check header, image table (`verifyWatchface`),
  thumbnail size, every layout image reference, value ids, element gating, banding, cropping, file name.
- `export/replay.test.ts`: reads the exported layout back the way the layout format describes (layers in order, digits by
  value, hands rotated about the pivot, arcs clipped to the ratio) and compares the result with the editor's preview for
  all six templates.
- `e2e/studio.spec.ts` (Playwright): load, add a time element, export, parse the download; project JSON and debug
  downloads; drag, undo, redo and autosave; resize handle; templates; preview-only marking; photo upload.

## Not confirmed on a watch

No face from this editor has been installed on a Fit 4 yet. Open items, all listed in the export checklist:

- Whether the Fit 4 accepts an unsigned face at all (see `protocol/README.md`).
- Layout details that no sample settles: whether a face without always-on layers shows a blank AOD, whether widget layers
  need their container, label and z-order rules between element types, `res_preview` for time and date, how single-digit
  hours and days are padded (the preview pads with a zero), and `createHwt` writing a flat package.
- The inferred ids above, and a calories value id.
- The rounded corner of the preview mask is an approximation.
