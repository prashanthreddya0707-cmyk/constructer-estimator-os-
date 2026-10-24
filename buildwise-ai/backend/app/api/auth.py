from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import _extract_token, bearer, get_current_user
from app.core import ratelimit
from app.core.authstore import (
    Credential, add_credential, bump_token_version, email_lookup, encrypt, find_by_email, get_auth_db, new_user_id, profile,
)
from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import create_access_token, decode_token, hash_password, verify_password
from app.models import User
from app.schemas import LoginIn, SignupIn, TokenOut, UserOut, UserUpdate

router = APIRouter(prefix="/auth", tags=["auth"])

# Hash compared against when the e-mail is unknown, so response time does not reveal which e-mails exist.
_DUMMY = hash_password("not-a-real-password")


def _local_only() -> None:
    """Sign-up, login and logout are done by Supabase Auth (in the browser) when AUTH_PROVIDER=supabase."""
    if get_settings().auth_provider == "supabase":
        raise HTTPException(410, "Accounts are handled by Supabase Auth in this deployment.")


def _set_cookie(request: Request, response: Response, token: str) -> None:
    """Session cookie the page script cannot read (httpOnly); Secure whenever the request came in over HTTPS."""
    s = get_settings()
    https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").split(",")[0].strip() == "https"
    response.set_cookie(s.cookie_name, token, max_age=s.access_token_minutes * 60, httponly=True, samesite="lax", secure=https, path="/")


@router.post("/signup", response_model=TokenOut, status_code=201)
def signup(body: SignupIn, request: Request, response: Response, db: Session = Depends(get_db), adb: Session = Depends(get_auth_db)):
    _local_only()
    s = get_settings()
    ratelimit.hit("signup_ip", ratelimit.client_ip(request), s.signup_ip_limit, 3600)
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
    token = create_access_token(uid, 0)
    _set_cookie(request, response, token)
    return TokenOut(access_token=token, user=UserOut(id=uid, email=email, full_name=name))


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, request: Request, response: Response, adb: Session = Depends(get_auth_db)):
    _local_only()
    s = get_settings()
    ip = ratelimit.client_ip(request)
    ident = f"{email_lookup(body.email)}|{ip}"
    ratelimit.hit("login_ip", ip, s.login_ip_limit, 300)
    ratelimit.blocked("login_fail", ident, s.login_fail_limit, 900)      # too many wrong passwords for this account from here
    cred = find_by_email(adb, body.email)
    ok = verify_password(body.password, cred.password_hash if cred else _DUMMY)
    if not cred or not ok:
        ratelimit.record("login_fail", ident)
        raise HTTPException(401, "Incorrect e-mail or password.")
    ratelimit.forget("login_fail", ident)
    token = create_access_token(cred.user_id, cred.token_version or 0)
    _set_cookie(request, response, token)
    email, name = profile(cred)
    return TokenOut(access_token=token, user=UserOut(id=cred.user_id, email=email, full_name=name))


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, creds=Depends(bearer), adb: Session = Depends(get_auth_db)):
    """Clears the cookie and invalidates the session on the server: the same token no longer works anywhere."""
    response.delete_cookie(get_settings().cookie_name, path="/")
    if get_settings().auth_provider == "supabase":
        return  # the browser signs out of Supabase Auth itself
    token = _extract_token(request, creds)
    decoded = decode_token(token) if token else None
    if decoded:
        cred = adb.get(Credential, decoded[0])
        if cred and (cred.token_version or 0) == decoded[1]:
            bump_token_version(adb, decoded[0])


@router.get("/me", response_model=UserOut)
def me(user=Depends(get_current_user), db: Session = Depends(get_db)):
    if get_settings().auth_provider == "supabase":
        row = db.execute(text("select full_name from public.profiles where id = :i"), {"i": user.id}).first()
        if row is None:   # first sign-in: create the profile row (RLS lets a user insert only their own)
            db.execute(text("insert into public.profiles (id, full_name) values (:i, :n) on conflict (id) do nothing"),
                       {"i": user.id, "n": user.full_name[:120]})
            db.commit()
        elif row[0]:
            user.full_name = row[0]
    return user


@router.put("/me", response_model=UserOut)
def update_me(body: UserUpdate, user=Depends(get_current_user), adb: Session = Depends(get_auth_db), db: Session = Depends(get_db)):
    name = body.full_name.strip()
    if get_settings().auth_provider == "supabase":
        from sqlalchemy import text

        db.execute(text("insert into public.profiles (id, full_name) values (:i, :n) on conflict (id) do update set full_name = excluded.full_name"),
                   {"n": name, "i": user.id})  # RLS: only the user's own row
        db.commit()
        user.full_name = name
        return user
    cred = adb.get(Credential, user.id)
    if not cred:
        raise HTTPException(404, "Account not found.")
    cred.name_enc = encrypt(name)
    adb.commit()
    user.full_name = name
    return user
