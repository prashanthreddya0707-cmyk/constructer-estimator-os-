from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session, selectinload

from app.core.authstore import Credential, get_auth_db, profile
from app.core.config import get_settings
from app.core.db import get_db
from app.core.ratelimit import hit
from app.core.security import decode_token
from app.core.supa import verify_access_token
from app.models import FloorPlan, Project, Report, User

bearer = HTTPBearer(auto_error=False)


def _extract_token(request: Request, creds: HTTPAuthorizationCredentials | None) -> str | None:
    """Authorization header first, then (local provider only) the httpOnly session cookie."""
    if creds:
        return creds.credentials
    return request.cookies.get(get_settings().cookie_name) if get_settings().auth_provider == "local" else None


def get_current_user(
    request: Request, creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db), adb: Session = Depends(get_auth_db),
):
    """Identify the caller. Supabase mode: verify the Supabase Auth access token and bind this request's database session to
    that user (Row Level Security). Local mode: the existing signed token + encrypted credential store."""
    unauth = HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated. Please log in.", headers={"WWW-Authenticate": "Bearer"})
    token = _extract_token(request, creds)
    if not token:
        raise unauth
    if get_settings().auth_provider == "supabase":
        ident = verify_access_token(token)
        if not ident:
            raise unauth
        db.info["rls_claims"] = ident.claims
        return ident
    decoded = decode_token(token)
    uid, version = decoded if decoded else (None, 0)
    user = db.get(User, uid) if uid else None
    cred = adb.get(Credential, uid) if user else None
    if not user or not cred or (cred.token_version or 0) != version:    # unknown user, or the token was invalidated by a logout
        raise unauth
    # Detach before filling in the decrypted profile, so e-mail/name are never written back to the project database.
    db.expunge(user)
    user.email, user.full_name = profile(cred)
    return user


def throttle_expensive(user=Depends(get_current_user)) -> None:
    """PDF generation, estimate recalculation and plan analysis: limited per signed-in user (not per IP, so shared networks are fine)."""
    s = get_settings()
    hit("expensive", user.id, s.expensive_user_limit, 60)


def get_owned_project(project_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Project:
    """Server-side ownership check. Returns 404 (not 403) so IDs of other users' projects are not revealed."""
    p = db.get(Project, project_id, options=[selectinload(Project.rooms), selectinload(Project.estimates)])  # 3 queries, not N+1
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
