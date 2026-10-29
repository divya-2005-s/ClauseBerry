"""Fetch current policy pages and store genuinely new versions (polite, idempotent).

Rules:
- Only documents with a configured source_url (pipeline/catalog.py) are fetched.
- At most once per document per 20 hours unless --force is given.
- robots.txt is honoured; disallowed URLs are recorded as 'skipped', never fetched.
- Only public HTTP(S) targets are fetched; redirects are checked and robots.txt failures block the policy request.
- Identifying User-Agent, timeouts, retries with exponential backoff, one request at a time with a delay.
- No CAPTCHA, login or access-control circumvention. JavaScript-rendered pages that return too little text
  are recorded as 'failed' (insufficient content) — a failed fetch is never interpreted as a deleted policy.
- A fetched text is stored only if its normalised text differs from the latest clean version.

Usage:  python -m pipeline.fetch_policies [--force] [--only reddit,spotify] [--dry-run]
"""
from __future__ import annotations

import argparse
import ipaddress
import os
import random
import re
import socket
import time
import urllib.robotparser
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from .common import connect, get_logger, migrate, pipeline_run, utcnow
from .textnorm import normalize, sha256, word_count

log = get_logger("fetch")
USER_AGENT = os.environ.get(
    "FETCH_USER_AGENT", "ClauseBerryBot/1.0 (+https://github.com/; policy-change research; contact: set FETCH_CONTACT)")
MIN_INTERVAL = timedelta(hours=20)
MIN_WORDS = 300
MAX_REDIRECTS = 5
_robots: dict[str, urllib.robotparser.RobotFileParser | bool] = {}


class UnsafeTargetError(ValueError):
    pass


class RobotsUnavailableError(RuntimeError):
    pass


def _validate_public_url(url: str) -> None:
    try:
        parts = urlparse(url)
    except ValueError as exc:
        raise UnsafeTargetError("malformed policy URL") from exc
    if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password:
        raise UnsafeTargetError("unsupported or malformed policy URL")
    try:
        port = parts.port
    except ValueError as exc:
        raise UnsafeTargetError("invalid policy URL port") from exc
    host = parts.hostname
    try:
        addresses = {ipaddress.ip_address(host)}
    except ValueError:
        try:
            addresses = {
                ipaddress.ip_address(address[4][0].split("%", 1)[0])
                for address in socket.getaddrinfo(host, port or (443 if parts.scheme == "https" else 80),
                                                  type=socket.SOCK_STREAM)
            }
        except (OSError, ValueError) as exc:
            raise UnsafeTargetError("policy URL host could not be resolved safely") from exc
    if not addresses or any(not address.is_global for address in addresses):
        raise UnsafeTargetError("policy URL must resolve only to public IP addresses")


def _get_with_safe_redirects(client: httpx.Client, url: str, timeout: int) -> httpx.Response:
    for redirect_count in range(MAX_REDIRECTS + 1):
        _validate_public_url(url)
        response = client.get(url, timeout=timeout, follow_redirects=False)
        if response.status_code not in (301, 302, 303, 307, 308):
            return response
        location = response.headers.get("location")
        if not location:
            return response
        if redirect_count == MAX_REDIRECTS:
            raise httpx.TooManyRedirects("too many redirects")
        next_url = urljoin(url, location)
        try:
            current_scheme = urlparse(url).scheme
            next_scheme = urlparse(next_url).scheme
        except ValueError as exc:
            raise UnsafeTargetError("malformed redirect URL") from exc
        if current_scheme == "https" and next_scheme != "https":
            raise UnsafeTargetError("HTTPS policy URL redirected to an insecure scheme")
        url = next_url
    raise httpx.TooManyRedirects("too many redirects")


def robots_allows(client: httpx.Client, url: str) -> bool:
    _validate_public_url(url)
    parts = urlparse(url)
    base = f"{parts.scheme}://{parts.netloc}"
    if base not in _robots:
        rp = urllib.robotparser.RobotFileParser()
        try:
            r = _get_with_safe_redirects(client, f"{base}/robots.txt", timeout=15)
            if r.status_code in (404, 410):
                rp.parse([])
            elif r.status_code in (401, 403):
                _robots[base] = False
                return False
            elif 200 <= r.status_code < 300:
                rp.parse(r.text.splitlines())
            else:
                raise RobotsUnavailableError(f"robots.txt returned HTTP {r.status_code}")
        except (httpx.HTTPError, UnsafeTargetError) as exc:
            raise RobotsUnavailableError("robots.txt could not be fetched safely") from exc
        _robots[base] = rp
    rp = _robots[base]
    return rp is not False and rp.can_fetch(USER_AGENT, url)


def html_to_markdown(html: str) -> str:
    """Convert a policy page to lightweight Markdown similar to the archive's format."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "nav", "footer", "header", "form", "button", "iframe"]):
        tag.decompose()
    root = soup.find("main") or soup.find("article") or soup.body or soup
    lines: list[str] = []
    for el in root.find_all(["h1", "h2", "h3", "h4", "p", "li", "td"]):
        text = " ".join(el.get_text(" ", strip=True).split())
        if not text or (el.name == "td" and len(text) < 3):
            continue
        if el.name.startswith("h"):
            lines.append(f"\n{'#' * int(el.name[1])} {text}\n")
        elif el.name == "li":
            lines.append(f"* {text}")
        else:
            lines.append(text)
    md = "\n".join(lines)
    return re.sub(r"\n{3,}", "\n\n", md).strip()


def fetch(client: httpx.Client, url: str, retries: int = 3) -> tuple[int | None, str | None, str | None]:
    last_err = None
    for attempt in range(retries):
        try:
            r = _get_with_safe_redirects(client, url, timeout=30)
            if r.status_code == 200:
                return 200, r.text, None
            if r.status_code in (401, 403, 451):
                return r.status_code, None, f"access restricted (HTTP {r.status_code}); not retried"
            last_err = f"HTTP {r.status_code}"
            if r.status_code < 500 and r.status_code != 429:
                return r.status_code, None, last_err
        except (httpx.HTTPError, UnsafeTargetError) as exc:
            last_err = f"{type(exc).__name__}: {exc}"[:300]
            if isinstance(exc, UnsafeTargetError):
                break
        time.sleep(min(60, 2 ** (attempt + 1) + random.random()))
    return None, None, last_err


def main(force: bool = False, only: list[str] | None = None, dry_run: bool = False) -> None:
    conn = connect()
    migrate(conn)
    docs = conn.execute(
        """SELECT d.id, d.document_type, d.source_url, a.slug, a.name FROM documents d JOIN apps a ON a.id=d.app_id
           WHERE d.source_url IS NOT NULL ORDER BY a.name, d.document_type""").fetchall()
    if only:
        docs = [d for d in docs if d["slug"] in only]
    with pipeline_run(conn, "fetch_policies") as stats, httpx.Client(headers={"User-Agent": USER_AGENT, "Accept": "text/html"}) as client:
        stats.update(new_version=0, unchanged=0, failed=0, skipped=0, failures=0)
        for d in docs:
            last = conn.execute("SELECT MAX(attempted_at) FROM fetch_log WHERE document_id=? AND status!='skipped'",
                                (d["id"],)).fetchone()[0]
            if last and not force and datetime.fromisoformat(last.replace("Z", "+00:00")) > datetime.now(timezone.utc) - MIN_INTERVAL:
                stats["skipped"] += 1
                continue

            def record(status: str, http_status=None, detail=None, version_id=None):
                stats[status] += 1
                if status == "failed":
                    stats["failures"] += 1
                if not dry_run:
                    conn.execute("INSERT INTO fetch_log(document_id, url, attempted_at, status, http_status, detail, version_id) "
                                 "VALUES (?,?,?,?,?,?,?)", (d["id"], d["source_url"], utcnow(), status, http_status, detail, version_id))
                    conn.commit()
                log.info("%-12s %-16s %s %s", d["name"], d["document_type"], status, detail or "")

            try:
                allowed = robots_allows(client, d["source_url"])
            except UnsafeTargetError as exc:
                record("failed", detail=str(exc))
                continue
            except RobotsUnavailableError:
                record("failed", detail="robots.txt unavailable; fetch blocked")
                continue
            if not allowed:
                record("skipped", detail="disallowed by robots.txt")
                continue
            code, html, err = fetch(client, d["source_url"])
            if not html:
                record("failed", code, err)
                continue
            text = html_to_markdown(html)
            if word_count(text) < MIN_WORDS:
                record("failed", code, f"insufficient content ({word_count(text)} words; page may require JavaScript)")
                continue
            latest = conn.execute("""SELECT pv.normalized_hash FROM v_latest_version lv JOIN policy_versions pv ON pv.id=lv.id
                                     WHERE lv.document_id=?""", (d["id"],)).fetchone()
            nh = sha256(normalize(text))
            if latest and latest[0] == nh:
                record("unchanged", code)
            elif dry_run:
                record("new_version", code, "dry run: not stored")
            else:
                now = datetime.now(timezone.utc)
                cur = conn.execute(
                    """INSERT OR IGNORE INTO policy_versions(document_id, version_date, version_datetime, word_count, text,
                           content_hash, normalized_hash, source, source_ref, retrieved_at)
                       VALUES (?,?,?,?,?,?,?, 'fetched', ?, ?)""",
                    (d["id"], now.strftime("%Y-%m-%d"), now.strftime("%Y-%m-%dT%H:%M:%S+00:00"), word_count(text), text,
                     sha256(text), nh, d["source_url"], utcnow()))
                conn.commit()
                record("new_version", code, version_id=cur.lastrowid)
            time.sleep(2 + random.random() * 2)  # be gentle: sequential with a pause
    log.info("Fetch complete: %s", stats)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="ignore the once-per-day limit (manual runs only)")
    ap.add_argument("--only", default="", help="comma-separated app slugs")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    main(a.force, [s for s in a.only.split(",") if s] or None, a.dry_run)
