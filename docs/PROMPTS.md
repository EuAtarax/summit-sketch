# Prompts for Claude Code

## Setup

1. Create an empty project folder (e.g. `summit-sketch`) and put `CLAUDE.md` in its root and `PLAN.md` and `STYLES.md` in `docs/`. Keep this file outside the project or in `docs/`.
2. Initialize a git repo and create an empty GitHub repo for it.
3. Open the folder in VS Code, start Claude Code, and paste the prompts below one at a time.
4. Start a fresh session for each prompt. The context lives in the files, not the chat.

---

## 1. Setup + data spike

> Read CLAUDE.md, docs/PLAN.md and docs/STYLES.md. Before writing code, give me a short plan for Phase 0 and the first task of Phase 1 (the data spike), and wait for my OK.
>
> Then do Phase 0 completely, including deployment. Then do the data spike: prove from the browser that we can fetch a Terrarium tile with CORS and decode a correct elevation for a known point (e.g. the Zugspitze summit ≈ 2962 m). If the source is unavailable or blocked, stop and propose free alternatives instead of working around it silently.

## 2. Horizon engine

> Continue Phase 1 in docs/PLAN.md: geo math, ElevationSource + SyntheticSource, summit snap, ray casting, crest extraction, ridge linking, workers with progress, radius selector, map picker and the debug renderer. Write the unit tests listed in the plan first and make them pass. Stop at the end with a manual test checklist.

## 3. Validate + tune

> I compared the debug view with a reference panorama for [summit]. Differences I see: [describe, or attach screenshots of both]. Diagnose the likely causes (sampling step, zoom bands, refraction, summit snap, linking thresholds), propose fixes, and implement them. Also report the timing and memory for 200 km on desktop, and suggest optimizations if we miss the targets.

## 4. Style system + Pencil

> Do the first half of Phase 2: ViewTransform, style registry, style picker and shared utilities, then implement the Pencil sketch style exactly as specified in docs/STYLES.md. Keep the debug style available behind `?debug=1`.

## 5. Misty layers + Cartoon

> Implement the Misty layers (with all three palettes) and Cartoon styles from docs/STYLES.md using the painter's fill. Make sure the fragment ends don't show hard vertical edges. Finish Phase 2.

## 6. Peak labels

> Do Phase 3 from docs/PLAN.md. Be gentle with the public Overpass server: one cached request per panorama, with backoff on errors. Show me a case where a peak is correctly hidden behind a nearer one.

## 7. Viewer + export

> Do Phase 4 from docs/PLAN.md. Test the export on iOS Safari limits (16 M pixels). On mobile, use the Web Share API for the file.

## 8. PWA + polish

> Do Phase 5 from docs/PLAN.md. Nominatim search only on submit, max 1 request/s.

## 9. More styles

> Implement the remaining 2D styles from docs/STYLES.md (Phase 6), one commit per style.

## 10. Realistic 3D

> Do Phase 7 from docs/PLAN.md. Start with a small prototype (terrain within 30 km, a single camera view), show me, then extend to the full radius and 360°.

---

## When something looks wrong

> This looks wrong: [what you see, with coordinates, style and radius, plus a screenshot]. Expected: [what you expected]. Find the root cause before changing code, explain it in two sentences, then fix it and add a test that would have caught it.
