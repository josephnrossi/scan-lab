# Scan Lab — v6 red-team UX audit (novice, iPhone portrait)

Audited v5 (commit b3a02a2) on WebKit iPhone 15 (393×659 CSS px) and iPhone SE (375×667), with and without an API key, every mode: home, photo taken, result. That is 95 screenshots, saved in `/workspace/scan-lab-shots/v6-audit-before/`. An automated pass on every screen also logged tap targets under 44 pt and anything wider than the screen.

Severity: **P1** blocks or confuses a first-time user · **P2** slows them down or adds clutter · **P3** polish.

## 1. Finding things / mode menu
| # | Sev | Finding | Evidence |
|---|---|---|---|
| 1.1 | P1 | **11 modes shown at once** in a 2-row, 6+5 tab grid (Auto, Food, Materials, Defects, Count, Color, Compare, Glass, Measure, Docs, Voice), with no grouping, icons or order of importance. A novice has to read all 11 to work out which one they need. | `iphone15-auto-1-home.png` |
| 1.2 | P2 | One-word, jargon-ish names: "Materials" (what does it do?), "Defects" (it's a damage check), "Docs" (receipts / business cards), "Glass" (stained-glass pattern), "Color" (colour match / paint). | all `*-1-home` |
| 1.3 | P2 | Auto is the default, but nothing says it's the recommended choice or that it covers food *and* objects. | `auto-1-home` |
| 1.4 | P2 | Measure adds a **second** segmented control (Flat / 3D photos / 3D scan file) under the mode grid, giving three rows of tabs before the camera. "3D scan file" is jargon. | `measure-1-home` |
| 1.5 | P3 | The bottom bar has 4 tabs, and "Receipts" is only a filtered view of Docs scans that are already in History. That's a duplicate place to look. | `view-receipts` |

## 2. Capture flow and buried actions
| # | Sev | Finding | Evidence |
|---|---|---|---|
| 2.1 | P1 | **After taking or picking a photo, the main button (Analyze / Count / Make stained-glass pattern…) is below the fold, hidden behind the tab bar.** The user sees the photo and a shutter and has to discover they must scroll. This affects every photo mode on both phones. | `food-2-photo`, `glass-2-photo` |
| 2.2 | P1 | The "Hint (optional)" field peeks out *under* the translucent tab bar. You can see it and it overlaps the tab labels, but you can't reach it without scrolling. | `auto-1-home` (iPhone 15 and SE) |
| 2.3 | P2 | Retake is hidden: you have to "tap the photo to retake". There's no Retake button, and the hint overlay sits on top of the photo. | `food-2-photo` |
| 2.4 | P2 | The shutter jumps position: it's centred when "📏 Scale" is shown (Auto / Food / Materials) but pushed to the right edge in the other modes. That's inconsistent muscle memory. | `measure-1-home` vs `auto-1-home` |
| 2.5 | P2 | "📏 Scale" is unclear (it adds a second photo with a coin or hand for size) and takes a prime spot for a rarely used option. | `auto-1-home` |
| 2.6 | P3 | "Start camera" plus a shutter that also opens the camera app: two ways to start, no explanation. | `00-first-run` |

## 3. Results and the action bar
| # | Sev | Finding | Evidence |
|---|---|---|---|
| 3.1 | P1 | **Every mode ends differently.** Glass, Count, Color, Compare and Measure say "Save to History"; Docs says "Save"; Food, Materials, Defects and Voice save silently with no button. Exports are labelled "⤓ SVG", "⇩ CSV", "⤓ Image", "⤓ PNG", "⧉ Copy text", "＋ Contact (.vcf)" and sit in different places. There's no "New photo" at the end of any result. | `*-full.png` |
| 3.2 | P1 | When a result opens, the page scrolls so the result **title sits under the sticky header** (e.g. "Stained-glass pattern", "Count", the Docs title are cut off). | `glass-3-result`, `count-3-result`, `docs-3-result` |
| 3.3 | P2 | Measure shows up to 7 export buttons in a row (PNG, PDF, OBJ, STL, GLB, Save, Use as glass size). | `measure-full` |
| 3.4 | P3 | History rows: a big red "Delete" on every row next to the open target is easy to hit by accident (undo exists). | `view-history` |

## 4. Stained glass (most crowded screen)
| # | Sev | Finding | Evidence |
|---|---|---|---|
| 4.1 | P1 | **The result page is 4,100 px tall** (about 6 screens on iPhone 15, 6.6 on SE). In order: intro paragraph, preview, 5 view buttons, fill toggle, subject row (3 buttons), 15 controls (Method, Detail, Simplify, Lines, Width, Height, Units, Frame, Frame width, Frame glass, plus hidden stylized ones), a long stats card, recognisability card, legend, 4 export buttons, build guide. | `glass-full.png` |
| 4.2 | P2 | The 5 view buttons (Original / Pattern / Overlay / Side by side / Cut lines) plus the 2-way colour toggle make 7 similar-looking buttons right under the preview. | `glass-3-result` |
| 4.3 | P2 | The intro paragraph is 5 lines of method detail ("colour zones… merged into its most similar neighbour…"). | `glass-3-result` |
| 4.4 | P2 | Jargon: "Simplify" vs "Detail" (both change piece count), "Lines" (lead vs copper foil), "Frame glass". | `glass-full` |

## 5. Settings / API key
| # | Sev | Finding | Evidence |
|---|---|---|---|
| 5.1 | P1 | **The key setup is a developer form**: Provider, Base URL, Model ("must accept images"), API key, a "Whisper fallback" disclosure, then Save / Test / Remove key. A novice only needs one field. Where to get a key is the *last* line, in grey small print, and it's not a link. | `settings.png` |
| 5.2 | P2 | No guidance before the first error. AI modes (Auto, Food, Materials, Defects, Docs) only say "API key needed" *after* you take a photo and tap Analyze. | errors test |
| 5.3 | P2 | "Remove key" (destructive, red) sits right next to Save. | `settings.png` |
| 5.4 | P3 | The "Voice: Whisper fallback (optional)" summary is an 18 px-tall tap target, under 44 pt. | audit report |

## 6. Empty states, errors and first run
| # | Sev | Finding |
|---|---|---|
| 6.1 | P2 | First run gives no orientation: no hint of what the app does, which mode to start with, or that most modes work without a key. |
| 6.2 | P2 | Empty states are short but passive ("No scans yet…"), with no button to start a scan. |
| 6.3 | P3 | Disclaimers are long (Auto: 3 lines of spectrometer detail under the button). They need to stay, but shorter. |

## 7. Tap targets and overflow (automated)
- No horizontal overflow on any screen on either phone. ✓
- Under 44 pt: thumbnail remove "✕" (28×28) in Docs, Defects and Compare page strips; Docs line-item inputs (40 px tall); the "Whisper fallback" summary (18 px).
- The mode grid buttons are 44 px tall, but the two rows take 150 px of the most valuable screen space.

## Fix plan (v6)
1. **One clean mode picker.** A single "mode" button shows the current mode (icon + plain name + one-line description) and opens a sheet of plain-named tiles in 4 groups, most-used first: *Identify* (✨ Auto, recommended · 🍽 Food & calories · 🧪 What's it made of) · *Make & measure* (🪟 Stained glass · 📏 Measure size · 🔢 Count items · 🎨 Color match) · *Check & compare* (🔍 Damage check · ⇆ Compare photos) · *Paper & audio* (🧾 Receipts & docs · 🎙 Voice recorder). Tiles that need a key are marked "Grok".
2. **Same capture flow everywhere**: [Photos] [Shutter, always centred] [Retake]. After a photo, the main button is docked above the tab bar, so it's visible without scrolling. Hint and scale photo move to a "More options" disclosure.
3. **Same action bar on every result**: Save (or "Saved ✓") · Share / export (menu) · New photo. Scroll to results without hiding the title.
4. **Stained glass**: preview, then Pattern / Side by side / Original, then **Detail** and size summary only. Everything else (Simplify, Method/Stylized, colours toggle, Overlay/Cut lines, subject, size, lines, frame) goes under **Advanced**. Stats are collapsed.
5. **Settings becomes a 3-step guided setup** with a link button to https://console.x.ai: open console → create key → paste + Save & test. Provider, Base URL, Model and Whisper go under Advanced. Remove key appears only when a key exists, away from Save.
6. **First-run hints shown once**: a welcome card in the camera area, a one-time Glass tip, and a "Needs a Grok key · Set up" line in AI modes when no key is set.
7. **Remove redundancy**: Receipts moves from the tab bar into History; the retake overlay is replaced by a Retake button; disclaimers are shortened (still present); remove "✕" buttons become 44 pt.

## What shipped in v6 (after)
Re-measured with the same script (`/workspace/scan-lab-shots/v6-audit-after` has the screenshots):

| Screen (iPhone 15) | Before | After |
|---|---|---|
| Home: visible buttons | 21 (11 mode tabs) | 9 (one mode button) |
| Home: page height | 904 px (hint hidden under tab bar) | 763 px |
| Main action after a photo | below the fold, behind the tab bar | docked above the tab bar, no scrolling (hit-tested in every photo mode) |
| Stained-glass result height | 4,108 px | 2,390 px (−42%) |
| Stained-glass default controls | ~20 | Detail slider + 3 views; the rest under **Advanced** |
| Settings fields shown | 5 + Whisper | 1 (API key) in a 3-step guide with a console.x.ai link |
| Tap targets < 44 pt | ✕ thumbnails, Docs inputs, Whisper summary | none |

Not changed on purpose: every capability, every export, Voice's consent gate and no-verdict rules, the estimate disclaimers (shorter, still on every AI result), and the original-photo comparison (Side by side and Original are now one tap under the preview).
