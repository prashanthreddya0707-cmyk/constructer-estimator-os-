"""DB-facing pricing helpers: which price applies to which user."""
from __future__ import annotations

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import Material, PriceRecord, Project
from app.services.pricing.costing import PriceInfo


def visible_materials(db: Session, user_id: str) -> list[Material]:
    return (
        db.query(Material)
        .filter(or_(Material.owner_id.is_(None), Material.owner_id == user_id))
        .order_by(Material.created_at, Material.name)
        .all()
    )


def effective_price(material: Material, user_id: str) -> PriceRecord | None:
    """The user's own newest price wins over the shared sample price."""
    own = [p for p in material.prices if p.owner_id == user_id]
    if own:
        return max(own, key=lambda p: p.updated_at)
    shared = [p for p in material.prices if p.owner_id is None]
    return max(shared, key=lambda p: p.updated_at) if shared else None


def build_price_lookup(db: Session, user_id: str, selections: dict | None) -> tuple[dict[str, PriceInfo], dict[str, list[dict]]]:
    """Return (price info per estimate key, priced alternatives per estimate key)."""
    mats = visible_materials(db, user_id)
    by_key: dict[str, list[Material]] = {}
    for m in mats:
        by_key.setdefault(m.estimate_key, []).append(m)
    lookup: dict[str, PriceInfo] = {}
    alternatives: dict[str, list[dict]] = {}
    for key, group in by_key.items():
        alts = []
        for m in group:
            p = effective_price(m, user_id)
            alts.append({"id": m.id, "label": f"{m.name}" + (f" ({m.grade})" if m.grade else ""),
                         "unit_price": p.unit_price if p else None, "is_sample": bool(p and p.is_sample)})
        alternatives[key] = alts
        chosen_id = (selections or {}).get(key)
        chosen = next((a for a in alts if a["id"] == chosen_id), None) or alts[0]
        lookup[key] = PriceInfo(chosen["id"], chosen["label"], chosen["unit_price"], chosen["is_sample"])
    return lookup, alternatives
