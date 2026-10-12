from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.authstore import add_credential, encrypt, find_by_email, get_auth_db, new_user_id, profile
from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import create_access_token, hash_password, verify_password
from app.models import User
from app.schemas import LoginIn, SignupIn, TokenOut, UserOut, UserUpdate

router = APIRouter(prefix="/auth", tags=["auth"])

# Hash compared against when the e-mail is unknown, so response time does not reveal which e-mails exist.
_DUMMY = hash_password("not-a-real-password")


def _set_cookie(request: Request, response: Response, token: str) -> None:
    """Session cookie the page script cannot read (httpOnly); Secure whenever the request came in over HTTPS."""
    s = get_settings()
    https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").split(",")[0].strip() == "https"
    response.set_cookie(s.cookie_name, token, max_age=s.access_token_minutes * 60, httponly=True, samesite="lax", secure=https, path="/")


@router.post("/signup", response_model=TokenOut, status_code=201)
def signup(body: SignupIn, request: Request, response: Response, db: Session = Depends(get_db), adb: Session = Depends(get_auth_db)):
    email = body.email.lower()
    if find_by_email(adb, email):
        raise HTTPException(409, "An account with this e-mail already exists.")
    uid = new_user_id()
    name = body.full_name.strip()
    # the project database only learns an opaque id; e-mail, name and password hash go to the encrypted credential store
    db.add(User(id=uid, email=f"{uid}@auth.invalid", full_name="", password_hash=""))
    db.commit()
    try:
        add_credential(adb, uid, email, name, hash_password(body.password))
    except Exception:
        adb.rollback()
        db.query(User).filter(User.id == uid).delete()
        db.commit()
        raise HTTPException(409, "An account with this e-mail already exists.")
    token = create_access_token(uid)
    _set_cookie(request, response, token)
    return TokenOut(access_token=token, user=UserOut(id=uid, email=email, full_name=name))


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, request: Request, response: Response, adb: Session = Depends(get_auth_db)):
    cred = find_by_email(adb, body.email)
    ok = verify_password(body.password, cred.password_hash if cred else _DUMMY)
    if not cred or not ok:
        raise HTTPException(401, "Incorrect e-mail or password.")
    token = create_access_token(cred.user_id)
    _set_cookie(request, response, token)
    email, name = profile(cred)
    return TokenOut(access_token=token, user=UserOut(id=cred.user_id, email=email, full_name=name))


@router.post("/logout", status_code=204)
def logout(response: Response):
    response.delete_cookie(get_settings().cookie_name, path="/")


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.put("/me", response_model=UserOut)
def update_me(body: UserUpdate, user: User = Depends(get_current_user), adb: Session = Depends(get_auth_db)):
    from app.core.authstore import Credential

    cred = adb.get(Credential, user.id)
    if not cred:
        raise HTTPException(404, "Account not found.")
    cred.name_enc = encrypt(body.full_name.strip())
    adb.commit()
    user.full_name = body.full_name.strip()
    return user
