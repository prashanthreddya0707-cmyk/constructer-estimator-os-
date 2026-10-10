# Estimation methodology

All quantities are **rule-based planning estimates** computed by `backend/app/services/estimation`. Defaults are typical planning values, *not* site-verified; every assumption is shown in the UI/PDF and can be edited.
Units: metres, square metres, cubic metres. Net quantity = exact requirement; **quantity incl. wastage = net × (1 + wastage %/100)** (bricks, blocks, cement bags rounded up to whole units; tiles rounded up after applying wastage to area).

| Item | Method |
|---|---|
| Floor area | `A = L × W` (or manual override per floor). Total built-up = A × floors |
| Concrete (slabs) | `V = footprint × slab thickness × floors` (+ optional frame allowance %) |
| Steel | `weight = concrete volume × kg/m³` (default 80 kg/m³ — confirm with structural design) |
| Walls | External: perimeter × height × floors. Internal length per floor ≈ (Σ room perimeters − external perimeter) ÷ 2, so shared walls count once. Windows deducted from external walls, doors from internal walls |
| Bricks / blocks | `count = ⌈net masonry volume ÷ ((l+j)(w+j)(h+j))⌉` with mortar joint `j` |
| Mortar | `wet volume = masonry volume − count × unit volume` |
| Plaster | `area × thickness`; area = both wall faces net of openings (+ ceilings, optional) |
| Cement / sand / aggregate | wet→dry factor (1.54 concrete, 1.27 mortar/plaster), split by mix parts (default concrete 1:1.5:3, mortar 1:6, plaster 1:4); cement = m³ × 1440 kg/m³ ÷ 50 kg bags. With ready-mix selected, concrete is priced directly and its constituents are quantity-free |
| Tiles | `N = ⌈net floor area ÷ area per tile⌉` (default 0.6 × 0.6 m) over tiled rooms |
| Paint | `litres = paintable area × coats ÷ coverage` (default 2 coats, 10 m²/L) |
| Cost | `cost = quantity incl. wastage × unit price`. Missing prices are flagged, never assumed zero in totals silently |

Not included: columns, beams, footings (use the frame allowance), wall tiling, primer/external coats, plumbing, electrical, labour (optional separate category).
Concrete, mortar and plaster are **quantity-only** lines unless ready-mix is chosen, to avoid counting cement and sand twice.

## Doors and windows

Openings are deducted from wall areas (both for bricks/blocks and for plaster/paint faces). Source, in order:

1. **Saved 3D layout** – exact door/window sizes stored by the Studio (`projects.layout.summary`). Used only if the stored plan signature equals the current plan (`plan_signature` in Python is the same function as `planSignature` in TypeScript); otherwise it is ignored as stale.
2. **Counts-based fallback** – the per-room door/window counts with default sizes: entrance 1.0 × 2.1 m, internal 0.9 × 2.1 m, bathroom 0.75 × 2.0 m, windows 1.2 × 1.2 m, plus one main entrance.

Shared interior walls are counted once; an interior door is deducted from that single wall. The Estimation page states which source was used and how many doors/windows were deducted. Furniture is never included in any quantity.
