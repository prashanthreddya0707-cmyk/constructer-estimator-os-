from __future__ import annotations

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import decode_token
from app.models import FloorPlan, Project, Report, User

bearer = HTTPBearer(auto_error=False)


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)
) -> User:
    unauth = HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated. Please log in.", headers={"WWW-Authenticate": "Bearer"})
    if not creds:
        raise unauth
    uid = decode_token(creds.credentials)
    user = db.get(User, uid) if uid else None
    if not user:
        raise unauth
    return user


def get_owned_project(project_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Project:
    """Server-side ownership check. Returns 404 (not 403) so IDs of other users' projects are not revealed."""
    p = db.get(Project, project_id)
    if not p or p.owner_id != user.id:
        raise HTTPException(404, "Project not found.")
    return p


def get_owned_floorplan(fid: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> FloorPlan:
    f = db.get(FloorPlan, fid)
    if not f or f.owner_id != user.id:
        raise HTTPException(404, "Floor plan not found.")
    return f


def get_owned_report(rid: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Report:
    r = db.get(Report, rid)
    if not r or r.owner_id != user.id:
        raise HTTPException(404, "Report not found.")
    return r
