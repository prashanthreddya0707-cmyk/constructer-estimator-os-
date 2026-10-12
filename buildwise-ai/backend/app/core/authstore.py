"""Separate, encrypted credential store.

User credentials live in their own SQLite file (``auth.db``), apart from the project data:
  * the e-mail address and the name are encrypted (Fernet: AES-128-CBC + HMAC-SHA256) with a key that is NOT in the file,
  * the password is only ever stored as a salted scrypt hash,
  * the e-mail is found again through a keyed hash (HMAC-SHA256), so it can be looked up without being readable.
The main database keeps only an opaque user id (needed for ownership of projects).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import uuid
from datetime import datetime, timezone

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import DateTime, String
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from app.core.config import get_settings
from app.core.db import _make_engine, enable_rls


class AuthBase(DeclarativeBase):
    pass


class Credential(AuthBase):
    __tablename__ = "credentials"
    user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email_lookup: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    email_enc: Mapped[str] = mapped_column(String(600))
    name_enc: Mapped[str] = mapped_column(String(600))
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


engine = _make_engine(get_settings().auth_database_url)
AuthSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_auth_db():
    db = AuthSession()
    try:
        yield db
    finally:
        db.close()


# ---- crypto helpers ---------------------------------------------------------------------------------------------
def _master() -> bytes:
    return hashlib.sha256(get_settings().auth_secret.encode()).digest()


def _fernet() -> Fernet:
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(b"enc|" + _master()).digest()))


def encrypt(text: str) -> str:
    return _fernet().encrypt(text.encode()).decode()


def decrypt(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:  # wrong key: never crash a request over unreadable profile data
        return ""


def email_lookup(email: str) -> str:
    return hmac.new(hashlib.sha256(b"idx|" + _master()).digest(), email.strip().lower().encode(), hashlib.sha256).hexdigest()


# ---- operations --------------------------------------------------------------------------------------------------
def find_by_email(db: Session, email: str) -> Credential | None:
    return db.query(Credential).filter(Credential.email_lookup == email_lookup(email)).first()


def add_credential(db: Session, user_id: str, email: str, full_name: str, password_hash: str) -> Credential:
    c = Credential(user_id=user_id, email_lookup=email_lookup(email), email_enc=encrypt(email.strip().lower()),
                   name_enc=encrypt(full_name), password_hash=password_hash)
    db.add(c)
    db.commit()
    return c


def profile(c: Credential) -> tuple[str, str]:
    return decrypt(c.email_enc), decrypt(c.name_enc)


def init_auth_db() -> None:
    AuthBase.metadata.create_all(bind=engine)
    enable_rls(engine, AuthBase.metadata)


def migrate_legacy_users() -> int:
    """Move users that still hold plain e-mail/name/hash in the main database into the encrypted store (idempotent)."""
    from app.core.db import SessionLocal
    from app.models import User

    moved = 0
    with SessionLocal() as main, AuthSession() as auth:
        for u in main.query(User).filter(User.password_hash != "").all():
            if auth.get(Credential, u.id) is None:
                auth.add(Credential(user_id=u.id, email_lookup=email_lookup(u.email), email_enc=encrypt(u.email.lower()),
                                    name_enc=encrypt(u.full_name), password_hash=u.password_hash))
                auth.commit()
            u.email, u.full_name, u.password_hash = f"{u.id}@auth.invalid", "", ""
            moved += 1
        main.commit()
    return moved


def new_user_id() -> str:
    return str(uuid.uuid4())
