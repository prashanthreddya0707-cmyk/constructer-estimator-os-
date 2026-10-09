"""Quantity take-off orchestration. Pure functions: building geometry in, quantities out.

All results are rule-based preliminary planning estimates (not machine-learning predictions).
"""
from __future__ import annotations

from . import calculators as c
from .models import (
    DEFAULT_WASTAGE,
    Assumptions,
    BuildingInput,
    EstimateItem,
    EstimationError,
    Geometry,
)

ITEM_ORDER = [
    "cement", "sand", "aggregates", "steel", "concrete", "bricks", "blocks",
    "mortar", "plaster", "tiles", "paint",
]
ITEM_META = {
    "cement": ("Cement", "Cement & Binders", "bag (50 kg)"),
    "sand": ("Sand", "Aggregates", "m³"),
    "aggregates": ("Coarse Aggregate", "Aggregates", "m³"),
    "steel": ("Reinforcement Steel", "Reinforcement", "kg"),
    "concrete": ("Concrete (RCC slabs)", "Concrete", "m³"),
    "bricks": ("Bricks", "Masonry", "nos"),
    "blocks": ("Blocks", "Masonry", "nos"),
    "mortar": ("Masonry Mortar", "Mortar & Plaster", "m³"),
    "plaster": ("Plaster", "Mortar & Plaster", "m³"),
    "tiles": ("Floor Tiles", "Flooring", "nos"),
    "paint": ("Paint", "Paint & Finishes", "litre"),
}


def validate_building(b: BuildingInput) -> None:
    c._pos(b.length, "Building length")
    c._pos(b.width, "Building width")
    c._pos(b.height, "Floor-to-ceiling height")
    c._pos(b.wall_thickness, "Wall thickness")
    c._pos(b.slab_thickness, "Slab thickness")
    if not isinstance(b.floors, int) or b.floors < 1:
        raise EstimationError("Number of floors must be a whole number of at least 1.")
    if b.built_up_area is not None:
        c._pos(b.built_up_area, "Built-up area")
    for r in b.rooms:
        c._pos(r.length, f"Room '{r.name}' length")
        c._pos(r.width, f"Room '{r.name}' width")
        c._pos(r.height, f"Room '{r.name}' height")
        if r.floor_number < 1 or r.floor_number > b.floors:
            raise EstimationError(f"Room '{r.name}' is on floor {r.floor_number}, outside 1..{b.floors}.")
        if r.doors < 0 or r.windows < 0:
            raise EstimationError(f"Room '{r.name}' has a negative door/window count.")


def room_area(r) -> float:
    return r.area_override if r.area_override else c.floor_area(r.length, r.width)


def compute_geometry(b: BuildingInput, a: Assumptions) -> Geometry:
    validate_building(b)
    warnings: list[str] = []
    footprint = b.built_up_area or c.floor_area(b.length, b.width)
    ext_perim = 2 * (b.length + b.width)
    if b.built_up_area and abs(b.built_up_area - b.length * b.width) / (b.length * b.width) > 0.01:
        warnings.append(
            "Built-up area was entered manually and differs from length × width; "
            "wall perimeters still use length and width."
        )
    by_floor: dict[int, float] = {}
    int_len_total = 0.0
    for fl in range(1, b.floors + 1):
        rooms = [r for r in b.rooms if r.floor_number == fl]
        area = sum(room_area(r) for r in rooms)
        by_floor[fl] = area
        if rooms:
            p_rooms = sum(2 * (r.length + r.width) for r in rooms)
            int_len = max(0.0, (p_rooms - ext_perim) / 2.0)  # shared walls counted once
            int_len_total += int_len
            if area > footprint * 1.10:
                warnings.append(
                    f"Floor {fl}: room areas ({area:.1f} m²) exceed the floor area ({footprint:.1f} m²) by more than 10 %."
                )
            elif area < footprint * 0.70:
                warnings.append(
                    f"Floor {fl}: configured rooms cover only {area / footprint * 100:.0f} % of the floor area; "
                    "internal wall length may be under-estimated."
                )
    if not b.rooms:
        warnings.append("No rooms configured: internal partition walls, openings and room-wise tiling cannot be estimated.")
    return Geometry(
        floor_area=footprint,
        total_built_up_area=footprint * b.floors,
        external_perimeter=ext_perim,
        internal_wall_length_per_floor=int_len_total / b.floors if b.floors else 0.0,
        rooms_area_by_floor=by_floor,
        warnings=warnings,
    )


def compute_quantities(
    b: BuildingInput,
    a: Assumptions | None = None,
    wastage: dict | None = None,
) -> tuple[Geometry, list[EstimateItem], list[str]]:
    a = a or Assumptions()
    geo = compute_geometry(b, a)
    warnings = list(geo.warnings)
    w = {**DEFAULT_WASTAGE, **{k: v for k, v in (wastage or {}).items() if v is not None}}
    n_floors = b.floors
    H = b.height

    # ---- Walls -----------------------------------------------------------------------
    t_ext = b.wall_thickness
    room_ts = [r.wall_thickness for r in b.rooms if r.wall_thickness]
    t_int = sum(room_ts) / len(room_ts) if room_ts else a.internal_wall_thickness
    ext_gross = geo.external_perimeter * H * n_floors
    int_h = (sum(r.height for r in b.rooms) / len(b.rooms)) if b.rooms else H
    int_len_total = 0.0
    for fl in range(1, n_floors + 1):
        rooms = [r for r in b.rooms if r.floor_number == fl]
        if rooms:
            int_len_total += max(0.0, (sum(2 * (r.length + r.width) for r in rooms) - geo.external_perimeter) / 2.0)
    int_gross = int_len_total * int_h
    doors = sum(r.doors for r in b.rooms)
    windows = sum(r.windows for r in b.rooms)
    door_area = doors * a.door_w * a.door_h
    window_area = windows * a.window_w * a.window_h
    if window_area > ext_gross * 0.9 or (int_gross > 0 and door_area > int_gross):
        warnings.append("Opening areas are very large compared with the wall area; check door/window counts.")
    window_area = min(window_area, ext_gross)
    door_area = min(door_area, int_gross)
    # Windows assumed in external walls; doors assumed in internal partitions.
    ext_vol = max(0.0, (ext_gross - window_area) * t_ext)
    int_vol = max(0.0, (int_gross - door_area) * t_int)
    if b.rooms and doors == 0 and windows == 0:
        warnings.append("No doors or windows entered: masonry, plaster and paint are likely over-estimated.")

    def units(kind: str, vol: float):
        if kind == "block":
            dims = (a.block_l, a.block_w, a.block_h)
        else:
            dims = (a.brick_l, a.brick_w, a.brick_h)
        n = c.masonry_unit_count(vol, *dims, a.mortar_joint)
        return n, c.mortar_wet_volume(vol, n, *dims)

    ext_n, ext_mort = units(a.external_masonry, ext_vol)
    int_n, int_mort = units(a.internal_masonry, int_vol)
    brick_n = (ext_n if a.external_masonry == "brick" else 0) + (int_n if a.internal_masonry == "brick" else 0)
    block_n = (ext_n if a.external_masonry == "block" else 0) + (int_n if a.internal_masonry == "block" else 0)
    mortar_wet = ext_mort + int_mort
    masonry_vol = ext_vol + int_vol

    # ---- Concrete & steel -------------------------------------------------------------
    slab_vol = c.concrete_volume(geo.floor_area, 1.0, b.slab_thickness) * n_floors  # footprint x T x floors
    frame_vol = slab_vol * a.frame_concrete_pct / 100.0
    conc_vol = slab_vol + frame_vol
    steel_kg = c.steel_weight(conc_vol, a.steel_kg_per_m3)

    # ---- Plaster & paint --------------------------------------------------------------
    wall_faces = max(0.0, 2 * (ext_gross - window_area) + 2 * (int_gross - door_area))
    rooms_area_total = sum(geo.rooms_area_by_floor.values())
    ceiling_area = (rooms_area_total if rooms_area_total > 0 else geo.total_built_up_area) if a.plaster_ceilings else 0.0
    plaster_area = wall_faces + ceiling_area
    plaster_wet = plaster_area * a.plaster_thickness
    paint_area = plaster_area

    # ---- Tiles -------------------------------------------------------------------------
    tile_notes: list[str] = []
    if b.rooms:
        sel = [r for r in b.rooms if not a.tiled_room_types or r.room_type in a.tiled_room_types]
        tile_area = sum(room_area(r) for r in sel)
        tile_notes.append(f"Tiled rooms: {len(sel)} of {len(b.rooms)} (net room floor areas).")
    else:
        tile_area = geo.total_built_up_area
        tile_notes.append("No rooms configured: the whole built-up area is assumed to be tiled.")

    # ---- Cement / sand / aggregate from site-mixed concrete, mortar and plaster ---------
    mix = a.concrete_mix
    cement_bags = sand_m3 = agg_m3 = 0.0
    cement_src: list[str] = []
    sand_src: list[str] = []
    if a.concrete_supply == "site_mix":
        dry = conc_vol * a.wet_to_dry_concrete
        bags, (s, g) = c.binder_split(dry, mix, a.cement_density, a.cement_bag_kg)
        cement_bags += bags; sand_m3 += s; agg_m3 += g
        cement_src.append(f"concrete {bags:.1f}"); sand_src.append(f"concrete {s:.2f}")
        agg_dry_note = f"{g:.2f} m³ from concrete"
    else:
        agg_dry_note = "0 m³ (concrete supplied as ready-mix)"
    for label, wet, ratio in (("masonry mortar", mortar_wet, a.mortar_sand_ratio), ("plaster", plaster_wet, a.plaster_sand_ratio)):
        dry = wet * a.wet_to_dry_mortar
        bags, (s,) = c.binder_split(dry, (1.0, ratio), a.cement_density, a.cement_bag_kg)
        cement_bags += bags; sand_m3 += s
        cement_src.append(f"{label} {bags:.1f}"); sand_src.append(f"{label} {s:.2f}")

    # ---- Assemble items ------------------------------------------------------------------
    raw: dict[str, tuple[float, str, list[str], bool, str]] = {}
    mix_s = f"{mix[0]:g}:{mix[1]:g}:{mix[2]:g}"
    conc_assump = [
        f"Slab thickness {b.slab_thickness:g} m on {n_floors} floor(s), footprint {geo.floor_area:.2f} m²",
        f"Frame allowance {a.frame_concrete_pct:g} % (columns/beams/footings not detailed)",
    ]
    raw["concrete"] = (
        conc_vol,
        "V = Footprint × Slab thickness × Floors" + (" × (1 + frame allowance)" if a.frame_concrete_pct else ""),
        conc_assump, a.concrete_supply == "ready_mix",
        "Costed only when ready-mix supply is selected; otherwise priced through cement, sand and aggregate.",
    )
    raw["cement"] = (
        cement_bags,
        "Σ over concrete, mortar, plaster: Dry volume × cement part / Σ parts × density ÷ bag weight",
        [f"Concrete mix {mix_s}; mortar 1:{a.mortar_sand_ratio:g}; plaster 1:{a.plaster_sand_ratio:g}",
         f"Wet→dry factors {a.wet_to_dry_concrete} (concrete), {a.wet_to_dry_mortar} (mortar/plaster)",
         f"Cement density {a.cement_density:g} kg/m³, bag {a.cement_bag_kg:g} kg"],
        True, "Sources (bags, net): " + "; ".join(cement_src),
    )
    raw["sand"] = (
        sand_m3,
        "Σ Dry volume × sand part / Σ parts (concrete, mortar, plaster)",
        [f"Mixes as for cement; sand proportions {mix[1]:g} (concrete), {a.mortar_sand_ratio:g} (mortar), {a.plaster_sand_ratio:g} (plaster)"],
        True, "Sources (m³, net): " + "; ".join(sand_src),
    )
    raw["aggregates"] = (
        agg_m3,
        "Dry concrete volume × aggregate part / Σ parts",
        [f"Concrete mix {mix_s}", f"Dry volume = wet × {a.wet_to_dry_concrete}"],
        True, agg_dry_note,
    )
    raw["steel"] = (
        steel_kg, "Weight = Concrete volume × steel intensity",
        [f"Steel intensity {a.steel_kg_per_m3:g} kg/m³ of concrete (engineer to confirm from structural design)"],
        True, "Slab reinforcement estimate only; columns, beams and footings need structural drawings.",
    )
    wall_assump = [
        f"External wall {t_ext:g} m ({a.external_masonry}), internal wall {t_int:g} m ({a.internal_masonry})",
        f"Wall height {H:g} m; external perimeter {geo.external_perimeter:.2f} m × {n_floors} floor(s)",
        f"Internal wall length ≈ (Σ room perimeters − external perimeter) ÷ 2 per floor = {int_len_total:.2f} m total (shared walls counted once)",
        f"Openings deducted: {windows} window(s) × {a.window_w:g}×{a.window_h:g} m (external), {doors} door(s) × {a.door_w:g}×{a.door_h:g} m (internal)",
        f"Net masonry volume {masonry_vol:.2f} m³; mortar joint {a.mortar_joint * 1000:g} mm",
    ]
    raw["bricks"] = (
        brick_n,
        f"Count = ⌈Net masonry volume ÷ ((l+j)(w+j)(h+j))⌉, unit {a.brick_l:g}×{a.brick_w:g}×{a.brick_h:g} m",
        wall_assump, True, "" if brick_n else "Not used (blocks selected for all walls).",
    )
    raw["blocks"] = (
        block_n,
        f"Count = ⌈Net masonry volume ÷ ((l+j)(w+j)(h+j))⌉, unit {a.block_l:g}×{a.block_w:g}×{a.block_h:g} m",
        wall_assump, True, "" if block_n else "Not used (bricks selected for all walls).",
    )
    raw["mortar"] = (
        mortar_wet, "Wet mortar = Masonry volume − (unit count × unit volume)",
        [f"Mix 1:{a.mortar_sand_ratio:g}", f"Net masonry volume {masonry_vol:.2f} m³"],
        False, "Quantity only; cost is captured through cement and sand.",
    )
    raw["plaster"] = (
        plaster_wet, "Plaster volume = Plastered area × thickness",
        [f"Plastered area {plaster_area:.1f} m² (both wall faces net of openings{' + ceilings' if a.plaster_ceilings else ''})",
         f"Thickness {a.plaster_thickness * 1000:g} mm; mix 1:{a.plaster_sand_ratio:g}"],
        False, "Quantity only; cost is captured through cement and sand.",
    )
    tile_area_each = a.tile_l * a.tile_w
    raw["tiles"] = (
        float(c.tile_count(tile_area, a.tile_l, a.tile_w)),
        "N = ⌈Net floor area ÷ Area per tile⌉ (wastage applied to area before rounding)",
        [f"Net tiled area {tile_area:.2f} m²; tile {a.tile_l:g}×{a.tile_w:g} m = {tile_area_each:.3f} m²", *tile_notes,
         "Wall tiling (e.g. bathrooms, kitchens) is not included"],
        True, "",
    )
    raw["paint"] = (
        c.paint_quantity(paint_area, a.paint_coats, a.paint_coverage),
        "Paint = Net paintable area × Coats ÷ Coverage per litre",
        [f"Net paintable area {paint_area:.1f} m²; {a.paint_coats} coat(s); coverage {a.paint_coverage:g} m²/L/coat",
         "Primer and external weather coat are not itemised"],
        True, "",
    )

    items: list[EstimateItem] = []
    for key in ITEM_ORDER:
        net, formula, assumptions, counts, note = raw[key]
        pct = float(w.get(key, 0.0))
        if key in ("bricks", "blocks", "cement"):  # whole units are purchased
            gross = float(c.ceil_count(c.apply_wastage(net, pct)))
        elif key == "tiles":
            gross = float(c.ceil_count(c.apply_wastage(tile_area, pct) / tile_area_each))
        else:
            gross = c.apply_wastage(net, pct)
        name, cat, unit = ITEM_META[key]
        if key in ("bricks", "blocks") and net == 0:
            continue
        items.append(EstimateItem(
            key=key, name=name, category=cat, unit=unit, net_quantity=net, wastage_pct=pct,
            gross_quantity=gross, formula=formula, assumptions=assumptions,
            counts_toward_cost=counts, note=note,
        ))
    return geo, items, warnings
