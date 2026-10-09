from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_owned_project, get_owned_report
from app.core.db import get_db
from app.models import Project, Report, User
from app.schemas import ReportOut, RoomOut
from app.services.estimate_service import compute_estimate, save_estimate
from app.services.estimation import EstimationError
from app.services.floorplan.storage import report_storage
from app.services.reports.pdf import build_report_pdf

router = APIRouter(tags=["reports"])


@router.post("/projects/{project_id}/report", response_model=ReportOut, status_code=201)
def create_report(p: Project = Depends(get_owned_project), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Always regenerates from current saved project data so the PDF can never be stale or empty."""
    try:
        payload = compute_estimate(db, user.id, p)
    except EstimationError as e:
        raise HTTPException(422, f"Cannot generate a report: {e}")
    est = save_estimate(db, user.id, p, payload)
    db.refresh(p)
    data = {
        "project": {c.name: getattr(p, c.name) for c in Project.__table__.columns},
        "rooms": [RoomOut.model_validate(r).model_dump() for r in p.rooms],
        "estimate": payload, "recommendations": payload["recommendations"],
        "generated_at": datetime.now(timezone.utc).strftime("%d %B %Y, %H:%M UTC"), "user_name": user.full_name,
    }
    pdf = build_report_pdf(data)
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", p.name).strip("_")[:50] or "project"
    key = f"{uuid.uuid4().hex}.pdf"
    report_storage().save(key, pdf)
    rep = Report(project_id=p.id, owner_id=user.id, estimate_id=est.id, file_name=f"BuildWise_{safe}_{datetime.now().strftime('%Y%m%d')}.pdf",
                 storage_key=key, size_bytes=len(pdf), total_cost=payload["summary"]["material_total"], currency=p.currency)
    db.add(rep)
    db.commit()
    return rep


@router.get("/reports", response_model=list[ReportOut])
def list_reports(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Report).filter(Report.owner_id == user.id).order_by(Report.created_at.desc()).all()


@router.get("/reports/{rid}/download")
def download_report(rep: Report = Depends(get_owned_report)):
    st = report_storage()
    if not st.exists(rep.storage_key):
        raise HTTPException(404, "The report file is no longer available. Generate it again.")
    return Response(st.read(rep.storage_key), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{rep.file_name}"'})


@router.delete("/reports/{rid}", status_code=204)
def delete_report(rep: Report = Depends(get_owned_report), db: Session = Depends(get_db)):
    report_storage().delete(rep.storage_key)
    db.delete(rep)
    db.commit()
