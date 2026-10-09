from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.projects import _latest, project_out
from app.core.db import get_db
from app.models import Project, Report, Room, User
from app.schemas import ReportOut
from app.services.estimate_service import compute_estimate, save_estimate

router = APIRouter(tags=["dashboard"])

DEMO_ROOMS = [
    ("Living Room", "living", 5.0, 4.0, 1, 2, 2, 1.0, 0.0), ("Master Bedroom", "bedroom", 4.0, 3.5, 1, 1, 2, 5.0, 0.0),
    ("Kitchen", "kitchen", 3.0, 3.0, 1, 1, 1, 0.0, 4.0), ("Bathroom", "bathroom", 2.0, 1.5, 1, 1, 1, 3.0, 4.0),
    ("Bedroom 2", "bedroom", 4.0, 3.0, 2, 1, 2, 0.0, 0.0), ("Study", "study", 3.0, 3.0, 2, 1, 1, 4.0, 0.0),
    ("Bathroom 2", "bathroom", 2.0, 1.5, 2, 1, 1, 7.0, 0.0),
]


@router.post("/demo/seed", status_code=201)
def seed_demo(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Create a clearly-labelled demo project (is_demo=true) for exploring the app."""
    p = Project(owner_id=user.id, name="DEMO – Two-storey residence", description="Demonstration data. Dimensions are illustrative only.",
                owner_name=user.full_name, building_type="residential", location="Demo location", floors=2, currency="INR",
                budget=2_500_000, length=10.0, width=8.0, height=3.0, wall_thickness=0.23, slab_thickness=0.15, is_demo=True)
    for name, rt, l, w, fl, d, win, x, y in DEMO_ROOMS:
        p.rooms.append(Room(name=name, room_type=rt, length=l, width=w, height=3.0, floor_number=fl, doors=d, windows=win, pos_x=x, pos_y=y))
    db.add(p)
    db.commit()
    db.refresh(p)
    save_estimate(db, user.id, p, compute_estimate(db, user.id, p))
    db.refresh(p)
    return project_out(p)


@router.get("/dashboard")
def dashboard(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    projects = db.query(Project).filter(Project.owner_id == user.id).order_by(Project.updated_at.desc()).all()
    ests = [(p, _latest(p)) for p in projects if _latest(p)]
    cat: dict[str, float] = {}
    qty: dict[str, dict] = {}
    for _, e in ests:
        for c in e.summary.get("by_category", []):
            cat[c["category"]] = cat.get(c["category"], 0.0) + c["cost"]
        for row in e.items:
            it = row.data
            if it["key"] in ("concrete", "mortar", "plaster"):
                continue  # intermediate quantities; keep chart readable
            q = qty.setdefault(it["key"], {"name": it["name"], "unit": it["unit"], "quantity": 0.0})
            q["quantity"] += it["gross_quantity"]
    per_sqft = [e.summary["cost_per_sqft"] for _, e in ests if e.summary.get("cost_per_sqft")]
    reports = db.query(Report).filter(Report.owner_id == user.id).order_by(Report.created_at.desc()).limit(5).all()
    return {
        "total_projects": len(projects),
        "saved_estimates": len(ests),
        "total_estimated_cost": sum(e.total_material_cost for _, e in ests),
        "avg_cost_per_sqft": sum(per_sqft) / len(per_sqft) if per_sqft else None,
        "has_demo_data": any(p.is_demo for p in projects),
        "recent_projects": [project_out(p) for p in projects[:5]],
        "recent_reports": [ReportOut.model_validate(r) for r in reports],
        "cost_distribution": [{"category": k, "cost": v} for k, v in cat.items()],
        "material_quantities": list(qty.values()),
    }
