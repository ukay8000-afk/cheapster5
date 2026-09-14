"""
Cheapster.in - FastAPI Backend (MVP)
Premium price-comparison + affiliate (Cuelinks) monetization platform.

Run:
    pip install fastapi uvicorn beautifulsoup4 python-dotenv
    uvicorn main:app --reload
"""

import os
import time
import uuid
import sqlite3
import random
import re
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from bs4 import BeautifulSoup  # noqa: F401  (kept for real-scraper swap-in later)

# ── dotenv (optional convenience) ────────────────────────────────────────────
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# =============================================================================
# CONFIG
# =============================================================================
# NEVER hardcode secrets in source. Pull from environment (.env locally,
# real secret manager / hosting-provider env vars in production).
CUELINKS_API_KEY = os.getenv("CUELINKS_API_KEY", "")
CUELINKS_CHANNEL_ID = os.getenv("CUELINKS_CHANNEL_ID", "320109")
CUELINKS_API_URL = "https://linkgen.cuelinks.com/link/generate"  # deep-link generation endpoint

if not CUELINKS_API_KEY:
    print("[WARN] CUELINKS_API_KEY not set. Set it in your environment or a .env file. "
          "Falling back to MOCK deep-link generation.")

DB_PATH = os.getenv("DB_PATH", "cheapster.db")
CACHE_TTL_SECONDS = 12 * 60 * 60  # 12-hour product price cache

# =============================================================================
# APP + CORS
# =============================================================================
app = FastAPI(title="Cheapster.in API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten to your real frontend origin in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =============================================================================
# DATABASE (SQLite for MVP)
# =============================================================================
@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS UsersTable (
                user_id      TEXT PRIMARY KEY,
                auth_provider TEXT NOT NULL,   -- 'google' | 'phone'
                identifier   TEXT NOT NULL,    -- email or phone number
                created_at   TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ClaimsTable (
                id            TEXT PRIMARY KEY,
                user_id       TEXT NOT NULL,
                order_id      TEXT NOT NULL,
                phone_number  TEXT NOT NULL,
                platform      TEXT NOT NULL,
                submitted_at  TEXT NOT NULL,
                payout_status TEXT NOT NULL DEFAULT 'pending',
                FOREIGN KEY (user_id) REFERENCES UsersTable(user_id)
            )
        """)
        # Very simple session table so /auth/logout and header-token checks work
        conn.execute("""
            CREATE TABLE IF NOT EXISTS SessionsTable (
                token      TEXT PRIMARY KEY,
                user_id    TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)


init_db()

# =============================================================================
# MODELS
# =============================================================================
class LoginRequest(BaseModel):
    provider: str = Field(..., description="'google' or 'phone'")
    identifier: str = Field(..., description="Google email OR phone number")
    otp: Optional[str] = Field(None, description="Required if provider == 'phone'")


class LoginResponse(BaseModel):
    session_token: str
    user_id: str
    identifier: str


class SearchRequest(BaseModel):
    query: str


class Product(BaseModel):
    id: str
    title: str
    store: str
    price: float
    mrp: float
    discount_pct: int
    rating: float
    image_url: str
    store_url: str


class SearchResponse(BaseModel):
    query: str
    cached: bool
    results: List[Product]


class CuelinkRequest(BaseModel):
    url: str


class CuelinkResponse(BaseModel):
    monetized_url: str


class ClaimRequest(BaseModel):
    order_id: str
    phone_number: str
    platform: str

    @property
    def is_valid_phone(self) -> bool:
        return bool(re.fullmatch(r"\d{10}", self.phone_number))


class ClaimResponse(BaseModel):
    success: bool
    message: str
    claim_id: Optional[str] = None


# =============================================================================
# AUTH HELPERS (mock session layer — swap for real JWT/OAuth in production)
# =============================================================================
def get_current_user(authorization: Optional[str] = Header(None)) -> Optional[str]:
    """
    Reads 'Authorization: Bearer <session_token>'. Returns user_id or None.
    Guest browsing works fine with no header at all — this never raises on its own.
    """
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.split(" ", 1)[1]
    with get_db() as conn:
        row = conn.execute(
            "SELECT user_id FROM SessionsTable WHERE token = ?", (token,)
        ).fetchone()
    return row["user_id"] if row else None


def require_user(authorization: Optional[str] = Header(None)) -> str:
    user_id = get_current_user(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Login required to submit a claim.")
    return user_id


# =============================================================================
# LOCAL SCRAPER MOCK + 12H CACHE
# =============================================================================
_price_cache: dict = {}  # { query_lower: {"expires": ts, "data": [Product,...]} }

STORE_META = {
    "Amazon": "https://m.media-amazon.com/images/G/31/mobile-apps/logo-min.png",
    "Flipkart": "https://static-assets-web.flixcart.com/fk-p-linchpin-web/fk-cp-zion/img/flipkart-plus_8d85f4.png",
}


def mock_scrape(query: str) -> List[Product]:
    """
    Placeholder for a real BeautifulSoup scraper against Amazon/Flipkart.
    Generates deterministic-ish mock listings so the UI has real data to render.
    Swap the body of this function for genuine HTTP + BeautifulSoup parsing
    once you have compliant access (official APIs / permitted scraping) —
    scraping e-commerce sites directly is often against their Terms of Service.
    """
    seed = sum(ord(c) for c in query) or 1
    rng = random.Random(seed)
    results = []
    for store in ("Amazon", "Flipkart"):
        base_price = rng.randint(999, 49999)
        mrp = int(base_price * rng.uniform(1.1, 1.6))
        discount = round((1 - base_price / mrp) * 100)
        results.append(
            Product(
                id=str(uuid.uuid4()),
                title=f"{query.title()} — {store} Listing",
                store=store,
                price=float(base_price),
                mrp=float(mrp),
                discount_pct=discount,
                rating=round(rng.uniform(3.5, 4.9), 1),
                image_url=STORE_META[store],
                store_url=f"https://www.{store.lower()}.{'in' if store == 'Flipkart' else 'in'}/s?q={query.replace(' ', '+')}",
            )
        )
    return results


def get_cached_or_scrape(query: str) -> (List[Product], bool):
    key = query.strip().lower()
    now = time.time()
    cached = _price_cache.get(key)
    if cached and cached["expires"] > now:
        return cached["data"], True

    fresh = mock_scrape(query)
    _price_cache[key] = {"expires": now + CACHE_TTL_SECONDS, "data": fresh}
    return fresh, False


# =============================================================================
# CUELINKS INTEGRATION
# =============================================================================
def generate_cuelink(raw_url: str) -> str:
    """
    Converts a raw store URL into a monetized Cuelinks deep link.
    Real Cuelinks Deep Link API call is commented in; falls back to a
    deterministic mock link when no API key is configured (e.g. local dev).
    """
    if CUELINKS_API_KEY:
        try:
            import requests
            resp = requests.get(
                CUELINKS_API_URL,
                params={
                    "url": raw_url,
                    "channel_id": CUELINKS_CHANNEL_ID,
                },
                headers={"Authorization": f"Token {CUELINKS_API_KEY}"},
                timeout=6,
            )
            if resp.ok:
                data = resp.json()
                monetized = data.get("link") or data.get("deep_link")
                if monetized:
                    return monetized
        except Exception as exc:  # network issues, non-JSON, etc.
            print(f"[Cuelinks] Live call failed, falling back to mock: {exc}")

    # Mock fallback (also used automatically when CUELINKS_API_KEY is empty)
    separator = "&" if "?" in raw_url else "?"
    return f"{raw_url}{separator}cuelink_channel={CUELINKS_CHANNEL_ID}&ref=cheapster_mock"


# =============================================================================
# ROUTES — AUTH
# =============================================================================
@app.post("/auth/login", response_model=LoginResponse)
def login(payload: LoginRequest):
    if payload.provider not in ("google", "phone"):
        raise HTTPException(400, "provider must be 'google' or 'phone'")

    if payload.provider == "phone":
        if not re.fullmatch(r"\d{10}", payload.identifier):
            raise HTTPException(400, "Phone number must be exactly 10 digits.")
        if not payload.otp:
            raise HTTPException(400, "OTP is required for phone login.")
        # MOCK: any 4-6 digit OTP is accepted. Wire up a real SMS/OTP provider in prod.
        if not re.fullmatch(r"\d{4,6}", payload.otp):
            raise HTTPException(401, "Invalid OTP.")

    with get_db() as conn:
        existing = conn.execute(
            "SELECT user_id FROM UsersTable WHERE auth_provider = ? AND identifier = ?",
            (payload.provider, payload.identifier),
        ).fetchone()

        if existing:
            user_id = existing["user_id"]
        else:
            user_id = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO UsersTable (user_id, auth_provider, identifier, created_at) VALUES (?, ?, ?, ?)",
                (user_id, payload.provider, payload.identifier, datetime.utcnow().isoformat()),
            )

        session_token = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO SessionsTable (token, user_id, created_at) VALUES (?, ?, ?)",
            (session_token, user_id, datetime.utcnow().isoformat()),
        )

    return LoginResponse(session_token=session_token, user_id=user_id, identifier=payload.identifier)


@app.post("/auth/logout")
def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
        with get_db() as conn:
            conn.execute("DELETE FROM SessionsTable WHERE token = ?", (token,))
    return {"success": True, "message": "Logged out."}


@app.delete("/auth/delete-account")
def delete_account(user_id: str = Depends(require_user)):
    with get_db() as conn:
        conn.execute("DELETE FROM ClaimsTable WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM SessionsTable WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM UsersTable WHERE user_id = ?", (user_id,))
    return {"success": True, "message": "Account and associated claims deleted."}


# =============================================================================
# ROUTES — SEARCH / CUELINKS / CLAIMS
# =============================================================================
@app.post("/api/search", response_model=SearchResponse)
def search_products(payload: SearchRequest):
    query = payload.query.strip()
    if not query:
        raise HTTPException(400, "Search query cannot be empty.")
    results, was_cached = get_cached_or_scrape(query)
    return SearchResponse(query=query, cached=was_cached, results=results)


@app.post("/generate-cuelink", response_model=CuelinkResponse)
def cuelink_endpoint(payload: CuelinkRequest):
    if not payload.url.startswith(("http://", "https://")):
        raise HTTPException(400, "A valid absolute URL is required.")
    monetized = generate_cuelink(payload.url)
    return CuelinkResponse(monetized_url=monetized)


@app.post("/submit-claim", response_model=ClaimResponse)
def submit_claim(payload: ClaimRequest, user_id: str = Depends(require_user)):
    if not payload.is_valid_phone:
        raise HTTPException(400, "WhatsApp number must be exactly 10 digits.")
    if not payload.order_id.strip():
        raise HTTPException(400, "Store Order ID is required.")

    claim_id = str(uuid.uuid4())
    with get_db() as conn:
        conn.execute(
            """INSERT INTO ClaimsTable
               (id, user_id, order_id, phone_number, platform, submitted_at, payout_status)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (claim_id, user_id, payload.order_id.strip(), payload.phone_number,
             payload.platform, datetime.utcnow().isoformat(), "pending"),
        )

    return ClaimResponse(
        success=True,
        message="Claim successfully registered.",
        claim_id=claim_id,
    )


@app.get("/")
def root():
    return {"status": "ok", "service": "Cheapster.in API"}
