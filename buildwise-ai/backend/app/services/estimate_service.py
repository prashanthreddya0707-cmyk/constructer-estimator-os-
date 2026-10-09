"""Glue between the DB and the pure estimation / pricing / optimisation modules."""
from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import Estimate, EstimateItemRow, Project, Recommendation
from app.services.estimation import Assumptions, BuildingInput, RoomInput, compute_quantities
from app.services.optimization.engine import OptimizationContext, generate_recommendations
from app.services.pricing.costing import apply_prices, summarize
from app.services.pricing.service import build_price_lookup


def building_from_project(p: Project) -> BuildingInput:
    return BuildingInput(
        length=p.length, width=p.width, height=p.height, floors=p.floors,
        wall_thickness=p.wall_thickness, slab_thickness=p.slab_thickness, built_up_area=p.built_up_area,
        rooms=[
            RoomInput(
                name=r.name, room_type=r.room_type, length=r.length, width=r.width, height=r.height,
                floor_number=r.floor_number, wall_thickness=r.wall_thickness, doors=r.doors,
                windows=r.windows, area_override=r.area_override,
            )
            for r in p.rooms
        ],
    )


def compute_estimate(db: Session, user_id: str, p: Project, overrides: dict | None = None) -> dict:
    """Compute (without saving) a full estimate payload for the project."""
    ov = overrides or {}
    assumptions_d = {**(p.assumptions or {}), **(ov.get("assumptions") or {})}
    wastage = {**(p.wastage or {}), **(ov.get("wastage") or {})}
    selections = {**(p.material_selections or {}), **{k: v for k, v in (ov.get("material_selections") or {}).items()}}
    extra = ov.get("extra_costs") if ov.get("extra_costs") is not None else (p.extra_costs or {})
    a = Assumptions.from_dict(assumptions_d)

    geo, items, warnings = compute_quantities(building_from_project(p), a, wastage)
    lookup, alternatives = build_price_lookup(db, user_id, selections)
    apply_prices(items, lookup, ready_mix=(a.concrete_supply == "ready_mix"))
    summary = summarize(items, geo.total_built_up_area, p.budget, extra)
    item_dicts = [asdict(i) for i in items]
    ctx = OptimizationContext(
        items=item_dicts, summary=summary, warnings=warnings, currency=p.currency,
        has_rooms=bool(p.rooms), rooms_with_openings=any(r.doors or r.windows for r in p.rooms),
        budget=p.budget, purchase_quantities={k: v for k, v in (p.purchase_quantities or {}).items() if v is not None},
        alternatives=alternatives,
    )
    return {
        "project_id": p.id,
        "currency": p.currency,
        "geometry": asdict(geo),
        "summary": summary,
        "assumptions": a.to_dict(),
        "warnings": warnings,
        "items": item_dicts,
        "recommendations": generate_recommendations(ctx),
        "alternatives": alternatives,
    }


def save_estimate(db: Session, user_id: str, p: Project, payload: dict) -> Estimate:
    """Persist as the project's current estimate (replaces the previous one)."""
    for old in list(p.estimates):
        db.delete(old)
    db.flush()
    est = Estimate(
        project_id=p.id, owner_id=user_id, summary=payload["summary"], geometry=payload["geometry"],
        assumptions=payload["assumptions"], warnings=payload["warnings"],
        total_material_cost=payload["summary"]["material_total"],
        total_area_sqm=payload["geometry"]["total_built_up_area"], currency=p.currency,
    )
    for i, it in enumerate(payload["items"]):
        est.items.append(EstimateItemRow(position=i, data=it))
    for i, r in enumerate(payload["recommendations"]):
        est.recommendations.append(Recommendation(position=i, data=r))
    db.add(est)
    db.commit()
    db.refresh(est)
    return est


def estimate_to_payload(est: Estimate, p: Project) -> dict:
    created = est.created_at if est.created_at.tzinfo else est.created_at.replace(tzinfo=timezone.utc)
    upd = p.updated_at if p.updated_at.tzinfo else p.updated_at.replace(tzinfo=timezone.utc)
    return {
        "id": est.id, "project_id": est.project_id, "currency": est.currency, "created_at": created.isoformat(),
        "stale": upd > created, "geometry": est.geometry, "summary": est.summary, "assumptions": est.assumptions,
        "warnings": est.warnings, "items": [r.data for r in est.items], "recommendations": [r.data for r in est.recommendations],
    }
