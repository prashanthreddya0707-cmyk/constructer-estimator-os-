"""Transparent, rule-based waste-optimisation recommendations.

No machine learning is used. Savings are computed only when both quantities and prices exist.
The `Rule` list is the extension point where historical data / trained models can be plugged in later.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Callable, Optional

HIGH_WASTAGE = {"default": 10.0, "tiles": 12.0, "steel": 8.0, "cement": 5.0}


@dataclass
class Recommendation:
    id: str
    title: str
    explanation: str
    material: Optional[str]
    reason: str
    suggested_action: str
    potential_benefit: str
    potential_savings: Optional[float] = None
    severity: str = "info"  # info | warning | critical

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class OptimizationContext:
    items: list[dict]  # serialised estimate items
    summary: dict
    warnings: list[str]
    currency: str
    has_rooms: bool
    rooms_with_openings: bool
    budget: Optional[float]
    purchase_quantities: dict
    alternatives: dict = field(default_factory=dict)  # estimate key -> [{id,label,unit_price}] priced alternatives


def _fmt(v: float) -> str:
    return f"{v:,.0f}"


def rule_high_wastage(ctx):
    for it in ctx.items:
        limit = HIGH_WASTAGE.get(it["key"], HIGH_WASTAGE["default"])
        if it["wastage_pct"] > limit and it["gross_quantity"] > 0:
            extra = it["gross_quantity"] - it["net_quantity"]
            sav = extra * it["unit_price"] if it.get("unit_price") and it.get("counts_toward_cost") else None
            yield Recommendation(
                f"wastage-{it['key']}", f"High wastage allowance for {it['name']}",
                f"The configured wastage is {it['wastage_pct']:g} %, above the {limit:g} % review threshold used by BuildWise AI.",
                it["name"], "Large allowances increase the quantity you order and the cost.",
                "Confirm the allowance with your site engineer or supplier and reduce it if cutting/handling losses are controlled.",
                (f"Each unit of wastage removed avoids buying part of {extra:,.2f} {it['unit']} of extra material."
                 + (f" Up to {ctx.currency} {_fmt(sav)} is tied up in the allowance." if sav else "")),
                sav, "warning",
            )


def rule_missing_rooms(ctx):
    if not ctx.has_rooms:
        yield Recommendation(
            "missing-rooms", "No rooms configured",
            "Room layouts are missing, so partition walls, door/window openings and tiled areas are approximated.",
            None, "Estimate reliability is reduced without room dimensions.",
            "Add rooms with their dimensions, door counts and window counts, then recalculate.",
            "More reliable masonry, plaster, paint and tile quantities (not quantified).", None, "warning",
        )
    elif not ctx.rooms_with_openings:
        yield Recommendation(
            "missing-openings", "Door and window counts are missing",
            "No doors or windows were entered, so no opening area is deducted from walls.",
            "Bricks / Plaster / Paint", "Masonry, plaster and paint quantities are likely over-estimated.",
            "Enter door and window counts for each room.", "Avoids ordering for wall area that will be open (not quantified).", None, "warning",
        )


def _warning_title(w: str) -> str:
    if "cover only" in w:
        return "Rooms cover only part of the floor area"
    if "exceed the floor area" in w:
        return "Room areas exceed the floor area"
    if "Opening areas" in w:
        return "Door and window sizes look too large"
    if "Built-up area was entered manually" in w:
        return "Manual built-up area differs from length × width"
    return "Review input dimensions"


def rule_warnings(ctx):
    for i, w in enumerate(ctx.warnings):
        if "No rooms configured" in w or "No doors or windows" in w:
            continue  # covered by dedicated rules
        yield Recommendation(
            f"data-quality-{i}", _warning_title(w), w, None,
            "Inconsistent inputs reduce estimate reliability.",
            "Re-check the room and building dimensions against the drawings.", "More reliable quantities (not quantified).", None, "warning",
        )


def rule_tiles_check(ctx):
    for it in ctx.items:
        if it["key"] == "tiles" and it["gross_quantity"] > 0:
            yield Recommendation(
                "verify-tiles", "Verify room dimensions before ordering tiles",
                f"The estimate needs about {it['gross_quantity']:,.0f} tiles including {it['wastage_pct']:g} % wastage.",
                it["name"], "Tile layout, cuts and pattern change the real requirement; small measurement errors multiply over many tiles.",
                "Measure finished room sizes on site and confirm the tile size and layout pattern before ordering a full batch (and keep spares from one batch for colour match).",
                "Avoids over- or under-ordering of tiles (not quantified).", None, "info",
            )


def rule_missing_prices(ctx):
    missing = ctx.summary.get("missing_price_keys") or []
    names = [it["name"] for it in ctx.items if it["key"] in missing]
    if names:
        yield Recommendation(
            "missing-prices", "Unit prices are missing",
            "Costs cannot be calculated for: " + ", ".join(names) + ".",
            ", ".join(names), "Total cost excludes these materials until a price exists.",
            "Add locally verified prices in Material Prices and select the material for this project.",
            "A complete cost estimate.", None, "critical",
        )


def rule_sample_prices(ctx):
    sample = [it["name"] for it in ctx.items if it.get("price_is_sample") and it.get("counts_toward_cost")]
    if sample:
        yield Recommendation(
            "sample-prices", "Estimate uses sample prices",
            "These lines use built-in sample prices, not verified market rates: " + ", ".join(sample) + ".",
            ", ".join(sample), "Sample prices are placeholders for demonstration.",
            "Replace them with quotations or locally verified rates before relying on the cost.",
            "A cost estimate that reflects your local market.", None, "warning",
        )


def rule_alternatives(ctx):
    for it in ctx.items:
        if not (it.get("unit_price") and it.get("counts_toward_cost")):
            continue
        alts = [a for a in ctx.alternatives.get(it["key"], []) if a["unit_price"] is not None and a["id"] != it.get("material_id")]
        if not alts:
            continue
        best = min(alts, key=lambda a: a["unit_price"])
        if best["unit_price"] < it["unit_price"]:
            sav = (it["unit_price"] - best["unit_price"]) * it["gross_quantity"]
            yield Recommendation(
                f"alt-{it['key']}", f"Lower-priced alternative available for {it['name']}",
                f"'{best['label']}' is priced at {ctx.currency} {best['unit_price']:,.2f}/{it['unit']} versus {ctx.currency} {it['unit_price']:,.2f} for the current selection.",
                it["name"], "A lower unit price may reduce cost for the same quantity.",
                "Compare specifications, grade and durability in Material Catalogue before switching. Lowest price does not mean equal quality.",
                f"Up to {ctx.currency} {_fmt(sav)} at the current quantity, if the alternative meets your specification.", sav, "info",
            )


def rule_purchase_mismatch(ctx):
    for it in ctx.items:
        planned = (ctx.purchase_quantities or {}).get(it["key"])
        if planned is None or it["gross_quantity"] <= 0:
            continue
        diff = planned - it["gross_quantity"]
        pct = diff / it["gross_quantity"] * 100
        if abs(pct) >= 10:
            over = diff > 0
            sav = diff * it["unit_price"] if over and it.get("unit_price") and it.get("counts_toward_cost") else None
            yield Recommendation(
                f"purchase-{it['key']}", f"Planned purchase differs from requirement: {it['name']}",
                f"Planned purchase is {planned:,.2f} {it['unit']} against a requirement of {it['gross_quantity']:,.2f} {it['unit']} ({pct:+.0f} %).",
                it["name"], "Over-buying creates surplus waste; under-buying causes delays and extra deliveries.",
                "Reconcile the purchase plan with the estimate, or update the estimate if the design has changed.",
                (f"Surplus worth about {ctx.currency} {_fmt(sav)} could be avoided." if sav else "Avoids shortage or surplus."),
                sav, "warning" if over else "critical",
            )


def rule_inventory(ctx):
    big = sorted([i for i in ctx.items if i.get("cost")], key=lambda i: i["cost"], reverse=True)[:3]
    if big:
        yield Recommendation(
            "inventory-review", "Review existing inventory before ordering",
            "The highest-cost lines are " + ", ".join(i["name"] for i in big) + ".",
            ", ".join(i["name"] for i in big), "Leftover stock from earlier work may cover part of the requirement.",
            "Check unused stock on site or at the supplier and deduct it before placing orders.",
            "Avoids duplicate purchases; savings depend on inventory not tracked by BuildWise AI.", None, "info",
        )


def rule_budget(ctx):
    b, s = ctx.budget, ctx.summary
    if b and s.get("project_total", 0) > b:
        over = s["project_total"] - b
        yield Recommendation(
            "over-budget", "Estimate exceeds the project budget",
            f"Estimated total {ctx.currency} {_fmt(s['project_total'])} is above the budget of {ctx.currency} {_fmt(b)}.",
            None, f"The estimate is over budget by {ctx.currency} {_fmt(over)}.",
            "Review the highest-cost materials, wastage allowances and alternatives, or revisit the budget.",
            "Closing the gap requires design/material changes (not quantified).", None, "critical",
        )


RULES: list[Callable[[OptimizationContext], object]] = [
    rule_budget, rule_missing_prices, rule_missing_rooms, rule_warnings, rule_sample_prices,
    rule_high_wastage, rule_alternatives, rule_tiles_check, rule_purchase_mismatch, rule_inventory,
]

_ORDER = {"critical": 0, "warning": 1, "info": 2}


def generate_recommendations(ctx: OptimizationContext) -> list[dict]:
    out: list[Recommendation] = []
    for rule in RULES:
        out.extend(rule(ctx))
    out.sort(key=lambda r: _ORDER[r.severity])
    return [r.to_dict() for r in out]
