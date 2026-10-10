from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_owned_floorplan, get_owned_project
from app.core.config import get_settings
from app.core.db import get_db
from app.models import FloorPlan, Project, User
from app.schemas import CalibrationIn, FloorPlanOut
from app.services.floorplan import processing
from app.services.floorplan.storage import upload_storage

router = APIRouter(tags=["floorplans"])


@router.get("/projects/{project_id}/floorplans", response_model=list[FloorPlanOut])
def list_floorplans(p: Project = Depends(get_owned_project)):
    return p.floorplans


@router.post("/projects/{project_id}/floorplans", response_model=FloorPlanOut, status_code=201)
async def upload_floorplan(file: UploadFile = File(...), p: Project = Depends(get_owned_project),
                           user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    max_bytes = get_settings().max_upload_mb * 1024 * 1024
    data = await file.read(max_bytes + 1)  # never read more than the limit + 1 byte
    try:
        ctype, w, h = processing.validate_upload(file.filename or "", data, max_bytes)
    except processing.UploadError as e:
        raise HTTPException(422 if "large" not in str(e) else 413, str(e))
    key = f"{uuid.uuid4().hex}{'.pdf' if ctype == 'application/pdf' else '.png' if ctype == 'image/png' else '.jpg'}"
    upload_storage().save(key, data)  # file bytes live on disk/storage, not in the DB
    fp = FloorPlan(project_id=p.id, owner_id=user.id, original_name=(file.filename or "floorplan")[:255], content_type=ctype,
                   size_bytes=len(data), storage_key=key, width_px=w, height_px=h)
    db.add(fp)
    db.commit()
    return fp


@router.get("/floorplans/{fid}/file")
def get_floorplan_file(fp: FloorPlan = Depends(get_owned_floorplan)):
    st = upload_storage()
    if not st.exists(fp.storage_key):
        raise HTTPException(404, "The stored floor-plan file is no longer available. Please upload it again.")
    return Response(st.read(fp.storage_key), media_type=fp.content_type,
                    headers={"Content-Disposition": f'inline; filename="{fp.storage_key}"', "X-Content-Type-Options": "nosniff"})


@router.put("/floorplans/{fid}/calibration", response_model=FloorPlanOut)
def calibrate(body: CalibrationIn, fp: FloorPlan = Depends(get_owned_floorplan), db: Session = Depends(get_db)):
    if fp.content_type == "application/pdf":
        raise HTTPException(422, "Scale calibration is available for image floor plans only. Export the PDF page as PNG/JPG or enter dimensions manually.")
    for v, lim in ((body.x1, fp.width_px), (body.x2, fp.width_px), (body.y1, fp.height_px), (body.y2, fp.height_px)):
        if lim and not (0 <= v <= lim):
            raise HTTPException(422, "Calibration points must lie inside the image.")
    try:
        scale = processing.compute_scale(body.x1, body.y1, body.x2, body.y2, body.real_length_m)
    except processing.UploadError as e:
        raise HTTPException(422, str(e))
    fp.scale_m_per_px = scale
    fp.calibration = body.model_dump()
    db.commit()
    return fp


@router.post("/floorplans/{fid}/analyze")
def analyze(fp: FloorPlan = Depends(get_owned_floorplan)):
    """Optional OpenCV pre-processing. Returns a base64 overlay; a visual aid only."""
    import base64
    if fp.content_type == "application/pdf":
        raise HTTPException(422, "Image analysis is available for JPG/PNG floor plans only.")
    st = upload_storage()
    if not st.exists(fp.storage_key):
        raise HTTPException(404, "The stored floor-plan file is no longer available.")
    try:
        res = processing.analyze_image(st.read(fp.storage_key))
    except processing.UploadError as e:
        raise HTTPException(422, str(e))
    return {
        "overlay_png_base64": base64.b64encode(res["overlay_png"]).decode(),
        "edges_png_base64": base64.b64encode(res["edges_png"]).decode(),
        "contour_count": res["contour_count"], "image_size": res["image_size"], "disclaimer": res["disclaimer"],
    }


@router.post("/floorplans/{fid}/detect-rooms")
def detect(fp: FloorPlan = Depends(get_owned_floorplan)):
    """Suggest room rectangles from the image. Heuristic: the user must review and confirm before anything is created."""
    import base64
    if fp.content_type == "application/pdf":
        raise HTTPException(422, "Room detection works on JPG/PNG plans. Export the PDF page as an image, or enter rooms manually.")
    st = upload_storage()
    if not st.exists(fp.storage_key):
        raise HTTPException(404, "The stored floor-plan file is no longer available.")
    try:
        res = processing.detect_rooms(st.read(fp.storage_key))
    except processing.UploadError as e:
        raise HTTPException(422, str(e))
    return {
        "rooms": res["rooms"], "image_size": res["image_size"], "warnings": res["warnings"], "disclaimer": res["disclaimer"],
        "overlay_png_base64": base64.b64encode(res["overlay_png"]).decode(), "scale_m_per_px": fp.scale_m_per_px,
    }


@router.delete("/floorplans/{fid}", status_code=204)
def delete_floorplan(fp: FloorPlan = Depends(get_owned_floorplan), db: Session = Depends(get_db)):
    upload_storage().delete(fp.storage_key)
    db.delete(fp)
    db.commit()
