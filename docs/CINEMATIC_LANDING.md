# Cinematic Odyssey landing page

## Design and behavior

The latest visual direction uses obsidian `#0c0d0e`, antique gold `#c6a66c`, warm readable text `#f0ebdf`, and restrained crimson. Cormorant Garamond headings and DM Sans interface text remain. The shared palette also keeps trading dialogs, portfolio tables, legal pages, and Oracle chat consistent.

`src/pages/CinematicLanding.jsx` presents four sections:

1. Odysseus behind the hero and the current featured market.
2. Athena beside two current open market cards, with access to the full dashboard.
3. Poseidon behind the trade explanation and a working simulated-contract calculator. Scroll-linked ocean lines sit below the content. The calculator carries its selected market, side, and quantity into the existing confirmation dialog.
4. Ithaca and a Greek temple behind a preview of the actual account leaderboard. Practice mode shows only the user's practice score.

Signed-out account mode still requires sign-in for backend records and never substitutes seeded fixtures. The calculator can illustrate contract rules before login; it does not invent a match or place a purchase. Every purchase still requires explicit confirmation through the existing trade flow.

`src/components/OdysseyChapter.jsx` uses Motion for React's `useScroll`, `useTransform`, and `useReducedMotion`, with `LazyMotion`/`m` for rendering. Section progress fades each artwork from 0 to 17% and back to 0, with at most 36 pixels of vertical offset in either direction. On narrow screens the CSS movement is scaled to 40%. Decorative layers have empty image alt text, `aria-hidden`, no pointer events, and no focusable controls. Solid trading panels remain above them.

Reduced motion mounts a separate static artwork branch at 13% opacity, with no `useScroll` component or looping wave animation. Browser scrolling remains native; there is no smooth-scroll engine, pinned section, or scroll hijacking.

Implementation references: [Motion scroll tracking](https://motion.dev/docs/react-use-scroll) and [reduced motion](https://motion.dev/docs/react-use-reduced-motion).

## Generated artwork

The built-in imagegen tool generated the four original marble-inspired artworks with genuine transparency. These are generated interpretations, not photographs of identified museum artifacts. The complete prompts are saved in [ODYSSEY_ART_PROMPTS.json](ODYSSEY_ART_PROMPTS.json).

The final assets are in `public/odyssey/`:

| Figure | Desktop | Mobile |
|---|---|---|
| Odysseus | `odysseus-desktop.webp`, 960 × 1440, about 149 KiB | `odysseus-mobile.webp`, 480 × 720, about 50 KiB |
| Athena | `athena-desktop.webp`, 960 × 1440, about 201 KiB | `athena-mobile.webp`, 480 × 720, about 63 KiB |
| Poseidon | `poseidon-desktop.webp`, 960 × 1440, about 199 KiB | `poseidon-mobile.webp`, 480 × 720, about 65 KiB |
| Ithaca | `ithaca-desktop.webp`, 1440 × 720, about 202 KiB | `ithaca-mobile.webp`, 720 × 360, about 56 KiB |

`picture` selects the mobile versions below 641 pixels. Only the hero is eager/high priority; the remaining art is lazy/async. The original PNGs are copied into ignored `assets/odyssey/originals/`. `node scripts/prepare-odyssey-assets.mjs` regenerates WebP encodings using Sharp as a development-only tool. The deployed site needs only the committed WebP files; Sharp and the original PNGs are not shipped in the browser bundle.

## Checks performed

`npm run check:cinematic` uses a real headless Chromium browser against the local Vite server and saves screenshots/report to ignored `artifacts/cinematic/`.

- Desktop and mobile screenshots were inspected, including all four chapters. Athena's desktop gutter and Ithaca's mobile position were adjusted after the first visual review.
- No document overflow at 320, 390, 768, or 1440 pixels. The calculator input stays inside the viewport.
- All four image stages load, select mobile sources at mobile width, remain at 17% opacity when centered, and cannot intercept actions. Hero position changes with scrolling and fades out after leaving its section.
- Reduced-motion mode shows four static layers, without transforms or artwork animations. Keyboard Tab/Enter activates the visible skip link and focuses the main content.
- Primary action text contrast is approximately 8.10:1; the tested YES contract button is approximately 10.43:1. This is a check of those controls, not a claim of a full accessibility audit.
- A 25-coin NO practice prediction preserves the calculator quantity/side through confirmation, changes the wallet from 1,000 to 975, and appears in Portfolio. A 5-coin YES prediction is also completed on mobile, with the balance changing from 975 to 970.
- Markets filtering, portfolio, leaderboard, legal navigation, the practice Oracle page, and the mobile sign-in dialog are exercised. No browser JavaScript errors were observed.

Existing practice/account DOM checks, page rendering, Oracle chat checks, unit tests, and the production build are also run for this change. Account DOM checks use controlled responses. These browser tests use an isolated browser-local practice wallet and do not create real accounts, spend deployed-account coins, or settle real markets. Live signed-in Supabase and Gemini verification still require their missing session/key configuration. No frontend deployment or Git push is performed by these changes.
