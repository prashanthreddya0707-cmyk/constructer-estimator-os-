"""Reusable construction quantity formulas. Every function is pure and unit-tested."""
from __future__ import annotations

import math

from .models import EstimationError


def _pos(value: float, name: str) -> float:
    if value is None or not isinstance(value, (int, float)) or math.isnan(value) or value <= 0:
        raise EstimationError(f"{name} must be a positive number (got {value!r}).")
    return float(value)


def _nonneg(value: float, name: str) -> float:
    if value is None or math.isnan(value) or value < 0:
        raise EstimationError(f"{name} must be zero or positive (got {value!r}).")
    return float(value)


def floor_area(length: float, width: float) -> float:
    """A = L x W"""
    return _pos(length, "Length") * _pos(width, "Width")


def concrete_volume(length: float, width: float, thickness: float) -> float:
    """V = L x W x T"""
    return _pos(length, "Length") * _pos(width, "Width") * _pos(thickness, "Thickness")


def apply_wastage(net: float, wastage_pct: float) -> float:
    """Quantity including wastage allowance: net x (1 + w/100)."""
    _nonneg(net, "Net quantity")
    if wastage_pct is None or wastage_pct < 0 or wastage_pct > 100:
        raise EstimationError(f"Wastage must be between 0 and 100 % (got {wastage_pct!r}).")
    return net * (1 + wastage_pct / 100.0)


def ceil_count(x: float) -> int:
    # Guard against float noise such as 100.00000000000001 -> 101
    return int(math.ceil(round(x, 9)))


def tile_count(net_floor_area: float, tile_l: float, tile_w: float) -> int:
    """N = Ceiling(Net Floor Area / Area Per Tile)"""
    _nonneg(net_floor_area, "Net floor area")
    return ceil_count(net_floor_area / (_pos(tile_l, "Tile length") * _pos(tile_w, "Tile width")))


def paint_quantity(net_paintable_area: float, coats: int, coverage_per_unit: float) -> float:
    """Paint = Net Paintable Area x Coats / Coverage Per Unit"""
    _nonneg(net_paintable_area, "Paintable area")
    if coats < 1:
        raise EstimationError("Number of coats must be at least 1.")
    return net_paintable_area * coats / _pos(coverage_per_unit, "Paint coverage")


def effective_unit_volume(l: float, w: float, h: float, joint: float) -> float:
    """Brick/block volume including the mortar joint on each dimension."""
    _nonneg(joint, "Mortar joint")
    return (_pos(l, "Unit length") + joint) * (_pos(w, "Unit width") + joint) * (_pos(h, "Unit height") + joint)


def masonry_unit_count(net_masonry_volume: float, l: float, w: float, h: float, joint: float) -> int:
    """Count = Ceiling(Net Masonry Volume / Effective Unit Volume)"""
    _nonneg(net_masonry_volume, "Masonry volume")
    return ceil_count(net_masonry_volume / effective_unit_volume(l, w, h, joint))


def mortar_wet_volume(net_masonry_volume: float, unit_count: float, l: float, w: float, h: float) -> float:
    """Wet mortar = masonry volume - volume occupied by the units themselves."""
    return max(0.0, net_masonry_volume - unit_count * l * w * h)


def binder_split(dry_volume: float, parts: tuple[float, ...], cement_density: float, bag_kg: float):
    """Split a dry volume among mix parts. Returns (cement_bags, [volume per non-cement part in m3])."""
    total = sum(parts)
    cement_m3 = dry_volume * parts[0] / total
    bags = cement_m3 * cement_density / bag_kg
    others = [dry_volume * p / total for p in parts[1:]]
    return bags, others


def steel_weight(concrete_m3: float, kg_per_m3: float) -> float:
    return _nonneg(concrete_m3, "Concrete volume") * _nonneg(kg_per_m3, "Steel kg per m3")


def material_cost(quantity: float, unit_price: float) -> float:
    """Cost = Quantity x Unit Price"""
    return _nonneg(quantity, "Quantity") * _nonneg(unit_price, "Unit price")
