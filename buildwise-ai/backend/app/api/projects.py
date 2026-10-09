from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_owned_project
from app.core.db import get_db
from app.models import Estimate, Project, Room, User
from app.schemas import (
    EstimateRequest, ProjectConfigUpdate, ProjectCreate, ProjectDetail, ProjectOut, ProjectUpdate, RoomIn, RoomOut,
)
from app.services.estimate_service import compute_estimate, estimate_to_payload, save_estimate
from app.services.estimation import EstimationError

from datetime import datetime, timezone

router = APIRouter(tags=["projects"])


def _now():
    return datetime.now(timezone.utc)


def _latest(p: Project) -> Estimate | None:
    return p.estimates[0] if p.estimates else None


def project_out(p: Project, detail: bool = False):
    est = _latest(p)
    footprint = p.built_up_area or p.length * p.width
    data = {
        **{c.name: getattr(p, c.name) for c in Project.__table__.columns},
        "room_count": len(p.rooms), "floor_area": footprint, "total_built_up_area": footprint * p.floors,
        "latest_total_cost": est.total_material_cost if est else None, "has_estimate": est is not None,
    }
    if detail:
        data["rooms"] = [RoomOut.model_validate(r) for r in p.rooms]
        data["floorplans"] = list(p.floorplans)
        return ProjectDetail.model_validate(data)
    return ProjectOut.model_validate(data)


def _validate_rooms_vs_floors(rooms, floors: int):
    for r in rooms:
        if r.floor_number > floors:
            raise HTTPException(422, f"Room '{r.name}' is on floor {r.floor_number}, but the project has {floors} floor(s).")


@router.get("/projects", response_model=list[ProjectOut])
def list_projects(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ps = db.query(Project).filter(Project.owner_id == user.id).order_by(Project.updated_at.desc()).all()
    return [project_out(p) for p in ps]


@router.post("/projects", response_model=ProjectDetail, status_code=201)
def create_project(body: ProjectCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    data = body.model_dump(exclude={"rooms"})
    p = Project(owner_id=user.id, **data)
    for r in body.rooms:
        p.rooms.append(Room(**r.model_dump()))
    db.add(p)
    db.commit()
    db.refresh(p)
    return project_out(p, detail=True)


@router.get("/projects/{project_id}", response_model=ProjectDetail)
def get_project(p: Project = Depends(get_owned_project)):
    return project_out(p, detail=True)


@router.put("/projects/{project_id}", response_model=ProjectDetail)
def update_project(body: ProjectUpdate, p: Project = Depends(get_owned_project), db: Session = Depends(get_db)):
    _validate_rooms_vs_floors(p.rooms, body.floors)
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return project_out(p, detail=True)


@router.put("/projects/{project_id}/config", response_model=ProjectDetail)
def update_config(body: ProjectConfigUpdate, p: Project = Depends(get_owned_project), db: Session = Depends(get_db)):
    """Estimation configuration: assumptions, wastage, material selections, extra costs, planned purchases."""
    for field in ("assumptions", "wastage", "material_selections", "extra_costs", "purchase_quantities"):
        val = getattr(body, field)
        if val is not None:
            merged = {**(getattr(p, field) or {}), **val} if field != "extra_costs" else val
            if field in ("material_selections", "purchase_quantities"):
                merged = {k: v for k, v in merged.items() if v is not None}
            setattr(p, field, merged)
    if body.wastage:
        for k, v in body.wastage.items():
            if not 0 <= v <= 100:
                raise HTTPException(422, f"Wastage for '{k}' must be between 0 and 100 %.")
    db.commit()
    db.refresh(p)
    return project_out(p, detail=True)


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(p: Project = Depends(get_owned_project), db: Session = Depends(get_db)):
    from app.services.floorplan.storage import report_storage, upload_storage
    for f in p.floorplans:
        upload_storage().delete(f.storage_key)
    for r in p.reports:
        report_storage().delete(r.storage_key)
    db.delete(p)
    db.commit()


# ---- rooms ---------------------------------------------------------------------------------
@router.get("/projects/{project_id}/rooms", response_model=list[RoomOut])
def list_rooms(p: Project = Depends(get_owned_project)):
    return p.rooms


@router.post("/projects/{project_id}/rooms", response_model=RoomOut, status_code=201)
def add_room(body: RoomIn, p: Project = Depends(get_owned_project), db: Session = Depends(get_db)):
    _validate_rooms_vs_floors([body], p.floors)
    r = Room(project_id=p.id, **body.model_dump())
    db.add(r)
    p.updated_at = _now()
    db.commit()
    return r


def _room(db: Session, p: Project, room_id: str) -> Room:
    r = db.get(Room, room_id)
    if not r or r.project_id != p.id:
        raise HTTPException(404, "Room not found.")
    return r


@router.put("/projects/{project_id}/rooms/{room_id}", response_model=RoomOut)
def update_room(room_id: str, body: RoomIn, p: Project = Depends(get_owned_project), db: Session = Depends(get_db)):
    _validate_rooms_vs_floors([body], p.floors)
    r = _room(db, p, room_id)
    for k, v in body.model_dump().items():
        setattr(r, k, v)
    p.updated_at = _now()
    db.commit()
    return r


@router.delete("/projects/{project_id}/rooms/{room_id}", status_code=204)
def delete_room(room_id: str, p: Project = Depends(get_owned_project), db: Session = Depends(get_db)):
    db.delete(_room(db, p, room_id))
    p.updated_at = _now()
    db.commit()


# ---- estimate -------------------------------------------------------------------------------
@router.post("/projects/{project_id}/estimate")
def run_estimate(body: EstimateRequest | None = None, p: Project = Depends(get_owned_project),
                 user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    body = body or EstimateRequest()
    overrides = body.model_dump(exclude={"persist"}, exclude_none=True)
    try:
        payload = compute_estimate(db, user.id, p, overrides)
    except EstimationError as e:
        raise HTTPException(422, str(e))
    if body.persist and not overrides:
        est = save_estimate(db, user.id, p, payload)
        db.refresh(p)
        out = estimate_to_payload(est, p)
        out["alternatives"] = payload["alternatives"]
        out["persisted"] = True
        return out
    payload["persisted"] = False
    return payload


@router.get("/projects/{project_id}/estimate")
def get_estimate(p: Project = Depends(get_owned_project)):
    est = _latest(p)
    if not est:
        raise HTTPException(404, "No estimate has been calculated for this project yet.")
    return {**estimate_to_payload(est, p), "persisted": True}


@router.get("/projects/{project_id}/recommendations")
def get_recommendations(p: Project = Depends(get_owned_project), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Recommendations for the *current* project data (recomputed, then stored with the estimate)."""
    try:
        payload = compute_estimate(db, user.id, p)
    except EstimationError as e:
        raise HTTPException(422, str(e))
    save_estimate(db, user.id, p, payload)
    return payload["recommendations"]
