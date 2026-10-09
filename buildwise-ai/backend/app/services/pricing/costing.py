"""Apply unit prices to quantity items and summarise costs. Pure functions."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app.services.estimation.models import EstimateItem
from app.services.estimation.units import SQM_PER_SQFT
from app.services.estimation import calculators as c


@dataclass
class PriceInfo:
    material_id: str
    label: str
    unit_price: Optional[float]
    is_sample: bool = False


EXTRA_KEYS = ("labour", "transportation", "contingency", "other")


def apply_prices(items: list[EstimateItem], lookup: dict[str, PriceInfo], ready_mix: bool = False) -> None:
    """Fill unit_price / cost on each item in place. Missing prices leave cost = None."""
    for it in items:
        info = lookup.get(it.key)
        if info:
            it.material_id = info.material_id
            it.material_label = info.label
            it.price_is_sample = info.is_sample
            it.unit_price = info.unit_price
        # concrete is costed only for ready-mix supply
        if it.key == "concrete":
            it.counts_toward_cost = ready_mix
        if it.unit_price is not None and it.gross_quantity is not None:
            it.cost = c.material_cost(it.gross_quantity, it.unit_price) if it.counts_toward_cost else 0.0
        else:
            it.cost = None


def compute_extras(extra_costs: dict | None, material_total: float) -> list[dict]:
    """Optional categories. Included in totals only when enabled AND value > 0."""
    out = []
    for key in EXTRA_KEYS:
        cfg = (extra_costs or {}).get(key) or {}
        enabled = bool(cfg.get("enabled"))
        value = float(cfg.get("value") or 0)
        mode = cfg.get("mode", "fixed")
        amount = material_total * value / 100.0 if mode == "percent" else value
        out.append({
            "key": key, "enabled": enabled, "mode": mode, "value": value,
            "amount": amount if enabled and value > 0 else 0.0,
            "included": enabled and value > 0,
        })
    return out


def summarize(items: list[EstimateItem], total_area_sqm: float, budget: Optional[float], extra_costs: dict | None) -> dict:
    costed = [i for i in items if i.counts_toward_cost]
    missing = [i.key for i in costed if i.cost is None and i.gross_quantity > 0]
    material_total = sum(i.cost or 0.0 for i in costed)
    by_cat: dict[str, float] = {}
    for i in costed:
        by_cat[i.category] = by_cat.get(i.category, 0.0) + (i.cost or 0.0)
    extras = compute_extras(extra_costs, material_total)
    extras_total = sum(e["amount"] for e in extras)
    project_total = material_total + extras_total
    per_sqm = material_total / total_area_sqm if total_area_sqm > 0 else None
    per_sqft = material_total / (total_area_sqm / SQM_PER_SQFT) if total_area_sqm > 0 else None
    # Budget is compared with the total that is actually computed (materials + enabled extras).
    variance = (budget - project_total) if budget else None
    return {
        "material_total": material_total,
        "by_category": [{"category": k, "cost": v} for k, v in by_cat.items()],
        "extras": extras,
        "extras_total": extras_total,
        "project_total": project_total,
        "cost_per_sqm": per_sqm,
        "cost_per_sqft": per_sqft,
        "budget": budget,
        "budget_variance": variance,  # positive = under budget
        "budget_used_pct": (project_total / budget * 100) if budget else None,
        "missing_price_keys": missing,
        "complete": not missing,
    }
