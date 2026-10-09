"""Plain dataclasses used by the estimation engine (no DB / HTTP dependencies)."""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Optional


class EstimationError(ValueError):
    """Raised for invalid / non-physical estimation inputs."""


@dataclass
class RoomInput:
    name: str
    room_type: str
    length: float
    width: float
    height: float
    floor_number: int = 1
    wall_thickness: Optional[float] = None
    doors: int = 0
    windows: int = 0
    area_override: Optional[float] = None


@dataclass
class BuildingInput:
    length: float
    width: float
    height: float  # floor-to-ceiling, metres
    floors: int
    wall_thickness: float  # external wall, metres
    slab_thickness: float
    built_up_area: Optional[float] = None  # manual footprint override per floor (m2)
    rooms: list[RoomInput] = field(default_factory=list)


@dataclass
class Assumptions:
    # Masonry
    external_masonry: str = "brick"  # "brick" | "block"
    internal_masonry: str = "brick"
    internal_wall_thickness: float = 0.115
    brick_l: float = 0.19
    brick_w: float = 0.09
    brick_h: float = 0.09
    block_l: float = 0.40
    block_w: float = 0.10
    block_h: float = 0.20
    mortar_joint: float = 0.01  # metres
    door_w: float = 1.0
    door_h: float = 2.1
    window_w: float = 1.2
    window_h: float = 1.2
    # Mortar / plaster mixes (cement : sand)
    mortar_sand_ratio: float = 6.0
    plaster_sand_ratio: float = 4.0
    plaster_thickness: float = 0.012
    plaster_ceilings: bool = True
    wet_to_dry_mortar: float = 1.27
    # Concrete
    concrete_mix: tuple = (1.0, 1.5, 3.0)  # cement : sand : aggregate
    wet_to_dry_concrete: float = 1.54
    frame_concrete_pct: float = 0.0  # allowance for columns/beams/footings, % of slab concrete
    concrete_supply: str = "site_mix"  # "site_mix" | "ready_mix"
    steel_kg_per_m3: float = 80.0
    # Densities / packaging
    cement_density: float = 1440.0  # kg/m3
    cement_bag_kg: float = 50.0
    # Tiles
    tile_l: float = 0.6
    tile_w: float = 0.6
    tiled_room_types: Optional[list] = None  # None => every room
    # Paint
    paint_coats: int = 2
    paint_coverage: float = 10.0  # m2 per litre per coat

    @classmethod
    def from_dict(cls, data: dict | None) -> "Assumptions":
        base = cls()
        for k, v in (data or {}).items():
            if hasattr(base, k) and v is not None:
                setattr(base, k, tuple(v) if k == "concrete_mix" else v)
        return base

    def to_dict(self) -> dict:
        d = asdict(self)
        d["concrete_mix"] = list(self.concrete_mix)
        return d


DEFAULT_WASTAGE = {
    "cement": 3.0,
    "steel": 5.0,
    "concrete": 2.0,
    "bricks": 5.0,
    "blocks": 5.0,
    "mortar": 5.0,
    "sand": 5.0,
    "aggregates": 5.0,
    "tiles": 7.0,
    "paint": 5.0,
    "plaster": 5.0,
}


@dataclass
class EstimateItem:
    key: str
    name: str
    category: str
    unit: str
    net_quantity: float
    wastage_pct: float
    gross_quantity: float
    formula: str
    assumptions: list[str]
    unit_price: Optional[float] = None
    cost: Optional[float] = None
    counts_toward_cost: bool = True  # False => quantity-only (priced via constituents)
    note: str = ""
    material_id: Optional[str] = None
    material_label: Optional[str] = None
    price_is_sample: bool = False


@dataclass
class Geometry:
    floor_area: float  # per floor, m2
    total_built_up_area: float
    external_perimeter: float
    internal_wall_length_per_floor: float
    rooms_area_by_floor: dict
    warnings: list[str] = field(default_factory=list)
