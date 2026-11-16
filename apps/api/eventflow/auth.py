"""Sign-in and roles for the product mode (decision #135). Off by default, so the booth and the kiosk stay open.

    EVENTFLOW_AUTH=off  (default)  anyone may plan and decide; decisions carry the anonymous label the client sends
    EVENTFLOW_AUTH=on              POST /auth/login gives a bearer token; deciding needs the planner role

Roles, lowest first: viewer (read scenarios, plans, chains) · planner (approve or reject, start chains) · admin
(add users). The first account registered on an empty store becomes the admin; after that only an admin can add
users. Passwords are stored as PBKDF2-SHA256 hashes with a per-user salt (standard library, no extra package);
tokens are random, stored server side with an expiry, and can be revoked (POST /auth/logout). Nothing here
leaves the machine.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import os
import re
import secrets

from fastapi import HTTPException, Request

from .store import store

ROLES = ("viewer", "planner", "admin")
TOKEN_HOURS = 12
_ITER = 240_000
USERNAME = re.compile(r"^[a-z0-9][a-z0-9._-]{2,39}$")


def enabled() -> bool:
    return os.environ.get("EVENTFLOW_AUTH", "off").strip().lower() in ("on", "1", "true", "yes")


def hash_password(pw: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, _ITER)
    return f"pbkdf2_sha256${_ITER}${salt.hex()}${dk.hex()}"


def check_password(pw: str, stored: str) -> bool:
    try:
        _, it, salt, want = stored.split("$")
        got = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), bytes.fromhex(salt), int(it)).hex()
        return hmac.compare_digest(got, want)
    except (ValueError, TypeError):
        return False


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def register(username: str, password: str, role: str, by: dict | None) -> dict:
    username = username.strip().lower()
    if not USERNAME.match(username):
        raise HTTPException(422, "username: 3–40 lower-case letters, digits, dot, dash or underscore")
    if len(password) < 10:
        raise HTTPException(422, "password: at least 10 characters")
    if role not in ROLES:
        raise HTTPException(422, f"role must be one of {ROLES}")
    s = store()
    first = not s.list("users", limit=1)
    if not first and (by is None or by["role"] != "admin"):
        raise HTTPException(403, "only an admin can add users")
    if s.get("users", username):
        raise HTTPException(409, "that username is taken")
    user = {"username": username, "role": "admin" if first else role, "pw": hash_password(password),
            "created": _now().isoformat(timespec="seconds")}
    s.put("users", username, user, owner=by["username"] if by else username)
    return {"username": username, "role": user["role"], "created": user["created"]}


def login(username: str, password: str) -> dict:
    u = store().get("users", username.strip().lower())
    if u is None or not check_password(password, u["pw"]):
        raise HTTPException(401, "wrong username or password")
    token = secrets.token_urlsafe(32)
    exp = _now() + dt.timedelta(hours=TOKEN_HOURS)
    store().put("sessions", hashlib.sha256(token.encode()).hexdigest(), {"username": u["username"], "expires": exp.isoformat()},
                owner=u["username"])
    return {"token": token, "token_type": "bearer", "expires": exp.isoformat(timespec="seconds"), "username": u["username"], "role": u["role"]}


def _token(request: Request) -> str | None:
    h = request.headers.get("authorization", "")
    return h[7:].strip() if h.lower().startswith("bearer ") else None


def current_user(request: Request) -> dict | None:
    """The signed-in user, or None (no token, unknown, or expired). Tokens are stored only as their SHA-256."""
    tok = _token(request)
    if not tok:
        return None
    key = hashlib.sha256(tok.encode()).hexdigest()
    sess = store().get("sessions", key)
    if sess is None or dt.datetime.fromisoformat(sess["expires"]) < _now():
        return None
    u = store().get("users", sess["username"])
    return {"username": u["username"], "role": u["role"]} if u else None


def logout(request: Request) -> None:
    tok = _token(request)
    if tok:
        store().delete("sessions", hashlib.sha256(tok.encode()).hexdigest())


def require_role(request: Request, role: str) -> dict | None:
    """With auth on: the signed-in user if their role is at least `role`, else 401/403. With auth off: None."""
    if not enabled():
        return None
    u = current_user(request)
    if u is None:
        raise HTTPException(401, "sign in first (POST /auth/login)", headers={"WWW-Authenticate": "Bearer"})
    if ROLES.index(u["role"]) < ROLES.index(role):
        raise HTTPException(403, f"needs the {role} role")
    return u
