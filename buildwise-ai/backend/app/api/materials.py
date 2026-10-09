from __future__ import annotations

import csv
import io
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.db import get_db
from app.models import Material, PriceRecord, User
from app.schemas import MaterialCreate, MaterialOut, MaterialUpdate, PriceCreate, PriceOut, PriceUpdate
from app.services.estimation import ITEM_ORDER
from app.services.pricing.service import effective_price, visible_materials

router = APIRouter(tags=["materials"])


def material_out(m: Material, user_id: str) -> MaterialOut:
    p = effective_price(m, user_id)
    return MaterialOut.model_validate({
        **{c.name: getattr(m, c.name) for c in Material.__table__.columns},
        "editable": m.owner_id == user_id,
        "unit_price": p.unit_price if p else None, "currency": p.currency if p else None,
        "supplier": p.supplier if p else "", "location": p.location if p else "",
        "price_is_sample": bool(p and p.is_sample), "price_id": p.id if p else None,
        "last_updated": p.updated_at if p else None,
    })


def _own_material(db: Session, user: User, mid: str, require_owner: bool = True) -> Material:
    m = db.get(Material, mid)
    if not m or (m.owner_id not in (None, user.id)):
        raise HTTPException(404, "Material not found.")
    if require_owner and m.owner_id != user.id:
        raise HTTPException(403, "Sample catalogue materials are read-only. Add your own price record or create a custom material.")
    return m


@router.get("/materials", response_model=list[MaterialOut])
def list_materials(estimate_key: str | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ms = visible_materials(db, user.id)
    if estimate_key:
        ms = [m for m in ms if m.estimate_key == estimate_key]
    return [material_out(m, user.id) for m in ms]


@router.post("/materials", response_model=MaterialOut, status_code=201)
def create_material(body: MaterialCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    m = Material(owner_id=user.id, **body.model_dump(include=set(MaterialUpdate.model_fields)))
    if body.unit_price is not None:
        m.prices.append(PriceRecord(owner_id=user.id, unit_price=body.unit_price, currency=body.currency,
                                    supplier=body.supplier, location=body.location, is_sample=False))
    db.add(m)
    db.commit()
    db.refresh(m)
    return material_out(m, user.id)


@router.put("/materials/{material_id}", response_model=MaterialOut)
def update_material(material_id: str, body: MaterialUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    m = _own_material(db, user, material_id)
    for k, v in body.model_dump().items():
        setattr(m, k, v)
    db.commit()
    return material_out(m, user.id)


@router.delete("/materials/{material_id}", status_code=204)
def delete_material(material_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    m = _own_material(db, user, material_id)
    # Drop any project selections that point at this material.
    from app.models import Project
    for p in db.query(Project).filter(Project.owner_id == user.id).all():
        if m.id in (p.material_selections or {}).values():
            p.material_selections = {k: v for k, v in p.material_selections.items() if v != m.id}
    db.delete(m)
    db.commit()


# ---- prices --------------------------------------------------------------------------------------
@router.get("/prices", response_model=list[PriceOut])
def list_prices(material_id: str | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(PriceRecord).filter((PriceRecord.owner_id == user.id) | (PriceRecord.owner_id.is_(None)))
    if material_id:
        q = q.filter(PriceRecord.material_id == material_id)
    return q.order_by(PriceRecord.updated_at.desc()).all()


@router.post("/prices", response_model=PriceOut, status_code=201)
def create_price(body: PriceCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    m = _own_material(db, user, body.material_id, require_owner=False)
    rec = PriceRecord(material_id=m.id, owner_id=user.id, unit_price=body.unit_price, currency=body.currency,
                      supplier=body.supplier, location=body.location, is_sample=False)
    db.add(rec)
    db.commit()
    return rec


def _own_price(db: Session, user: User, pid: str) -> PriceRecord:
    rec = db.get(PriceRecord, pid)
    if not rec or rec.owner_id != user.id:
        raise HTTPException(404, "Price record not found (sample prices cannot be edited; add your own).")
    return rec


@router.put("/prices/{price_id}", response_model=PriceOut)
def update_price(price_id: str, body: PriceUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rec = _own_price(db, user, price_id)
    rec.unit_price, rec.supplier, rec.location = body.unit_price, body.supplier, body.location
    rec.updated_at = datetime.now(timezone.utc)
    db.commit()
    return rec


@router.delete("/prices/{price_id}", status_code=204)
def delete_price(price_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.delete(_own_price(db, user, price_id))
    db.commit()


@router.post("/prices/import")
async def import_prices(file: UploadFile = File(...), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """CSV columns: estimate_key,name,category,brand,grade,unit,unit_price,supplier,location (header required)."""
    raw = await file.read()
    if len(raw) > 1_000_000:
        raise HTTPException(413, "CSV file is too large (max 1 MB).")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(422, "CSV must be UTF-8 encoded.")
    reader = csv.DictReader(io.StringIO(text))
    required = {"estimate_key", "name", "unit", "unit_price"}
    if not reader.fieldnames or not required <= {f.strip() for f in reader.fieldnames}:
        raise HTTPException(422, f"CSV must have a header with at least: {', '.join(sorted(required))}.")
    created, errors = 0, []
    for line_no, row in enumerate(reader, start=2):
        try:
            row = {k.strip(): (v or "").strip() for k, v in row.items() if k}
            key = row["estimate_key"].lower()
            if key not in ITEM_ORDER:
                raise ValueError(f"estimate_key must be one of {', '.join(ITEM_ORDER)}")
            price = float(row["unit_price"])
            if price < 0:
                raise ValueError("unit_price must not be negative")
            if not row["name"] or not row["unit"]:
                raise ValueError("name and unit are required")
            m = Material(owner_id=user.id, estimate_key=key, name=row["name"][:160], category=(row.get("category") or key.title())[:80],
                         brand=row.get("brand", "")[:120], grade=row.get("grade", "")[:120], unit=row["unit"][:30])
            m.prices.append(PriceRecord(owner_id=user.id, unit_price=price, supplier=row.get("supplier", "")[:160], location=row.get("location", "")[:160]))
            db.add(m)
            created += 1
        except (ValueError, KeyError) as e:
            errors.append({"line": line_no, "message": str(e)})
    db.commit()
    return {"created": created, "errors": errors}
