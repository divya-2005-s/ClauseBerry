"""Ask ClauseBerry: chat sessions and streamed RAG answers (Server-Sent Events)."""
from __future__ import annotations

import json
import sqlite3

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..core.errors import AppError
from ..db.database import get_db, one, rows
from ..security.deps import CurrentUser, ask_rate_limit, current_user
from ..services import rag

router = APIRouter(prefix="/api/chat", tags=["chat"])


class NewSessionIn(BaseModel):
    title: str | None = Field(default=None, max_length=120)


class AskIn(BaseModel):
    question: str = Field(min_length=2, max_length=1000)
    app_slugs: list[str] = Field(default_factory=list, max_length=5)


def _own_session(conn, session_id: int, user_id: int) -> dict:
    s = one(conn, "SELECT * FROM chat_sessions WHERE id=? AND user_id=?", (session_id, user_id))
    if not s:  # same response whether it doesn't exist or belongs to someone else
        raise AppError(404, "not_found", "Conversation not found.")
    return s


def _msg(m: dict) -> dict:
    return {**m, "citations": json.loads(m["citations"]), "meta": json.loads(m["meta"])}


@router.get("/suggestions")
def suggestions(_: CurrentUser = Depends(current_user)):
    return {"items": ["What changed in Instagram's privacy policy recently?",
                      "Which policies explicitly mention training AI models?",
                      "Does LinkedIn share data with third parties for AI?",
                      "Compare how Reddit and X describe data retention.",
                      "Show me the clause about data retention in Spotify's privacy policy.",
                      "What are the main privacy risks in TikTok's latest privacy policy?"]}


@router.get("/sessions")
def list_sessions(user: CurrentUser = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    return {"items": rows(conn, """SELECT s.id, s.title, s.created_at, s.updated_at,
                                          (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id=s.id) AS messages
                                   FROM chat_sessions s WHERE s.user_id=? ORDER BY s.updated_at DESC LIMIT 50""",
                                (user.id,))}


@router.post("/sessions", status_code=201)
def create_session(body: NewSessionIn, user: CurrentUser = Depends(current_user),
                   conn: sqlite3.Connection = Depends(get_db)):
    cur = conn.execute("INSERT INTO chat_sessions(user_id, title) VALUES (?,?)", (user.id, body.title or "New conversation"))
    conn.commit()
    return one(conn, "SELECT * FROM chat_sessions WHERE id=?", (cur.lastrowid,))


@router.get("/sessions/{session_id}")
def get_session(session_id: int, user: CurrentUser = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    s = _own_session(conn, session_id, user.id)
    msgs = rows(conn, "SELECT * FROM chat_messages WHERE session_id=? ORDER BY id", (session_id,))
    return {"session": s, "messages": [_msg(m) for m in msgs]}


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: int, user: CurrentUser = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    _own_session(conn, session_id, user.id)
    conn.execute("DELETE FROM chat_sessions WHERE id=?", (session_id,))
    conn.commit()


@router.post("/sessions/{session_id}/messages")
def ask(session_id: int, body: AskIn, user: CurrentUser = Depends(ask_rate_limit),
        conn: sqlite3.Connection = Depends(get_db)):
    s = _own_session(conn, session_id, user.id)
    history = rows(conn, "SELECT role, content FROM chat_messages WHERE session_id=? ORDER BY id DESC LIMIT 6", (session_id,))[::-1]
    conn.execute("INSERT INTO chat_messages(session_id, role, content) VALUES (?, 'user', ?)", (session_id, body.question))
    if s["title"] == "New conversation":
        conn.execute("UPDATE chat_sessions SET title=? WHERE id=?", (body.question[:80], session_id))
    conn.commit()

    def stream():
        citations, meta, final = [], {}, None
        try:
            for ev in rag.answer_stream(conn, body.question, history, body.app_slugs):
                if ev["type"] == "sources":
                    citations = ev["citations"]
                elif ev["type"] == "meta":
                    meta = {k: v for k, v in ev.items() if k != "type"}
                elif ev["type"] == "done":
                    final = ev
                elif ev["type"] == "error":
                    final = {"content": ev["message"], "follow_ups": [], "error": True}
                yield rag.sse(ev)
        finally:
            if final:
                meta.update(follow_ups=final.get("follow_ups", []), error=final.get("error", False),
                            insufficient_evidence=final.get("insufficient_evidence", False))
                cur = conn.execute("INSERT INTO chat_messages(session_id, role, content, citations, meta) "
                                   "VALUES (?, 'assistant', ?, ?, ?)",
                                   (session_id, final["content"], json.dumps(citations), json.dumps(meta)))
                conn.execute("UPDATE chat_sessions SET updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?",
                             (session_id,))
                conn.commit()
                yield rag.sse({"type": "saved", "message_id": cur.lastrowid})

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
