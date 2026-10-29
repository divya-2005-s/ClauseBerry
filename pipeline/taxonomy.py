"""Controlled vocabulary, AI-clause detection and the rule-based (heuristic) change analyzer.

The heuristic analyzer exists so ClauseBerry works without an LLM key. Its output is always stored
with analyzer='heuristic' and shown in the UI as rule-based, never as AI-generated.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .textnorm import sentences, sha256

# --------------------------------------------------------------------------- categories
CATEGORIES: dict[str, str] = {
    "data_collection": "Data collection",
    "data_sharing": "Data sharing",
    "data_retention": "Data retention",
    "ai_training": "AI training",
    "advertising_tracking": "Advertising & tracking",
    "user_rights": "User rights",
    "security": "Security",
    "international_transfers": "International transfers",
    "legal_obligations": "Legal terms & obligations",
    "other": "Other",
}

CHANGE_DIRECTIONS = ("expanded_permission", "reduced_permission", "clarification", "editorial", "mixed")

RISK_LEVELS = {1: "minimal", 2: "low", 3: "medium", 4: "high", 5: "critical"}

# Documented in docs/architecture.md#risk-rubric
RISK_RUBRIC = {
    1: "Editorial: formatting, dates, contact details or wording with no change to what data is handled or how.",
    2: "Minor: clarifies or reorganises existing practices; no new data, recipients or purposes.",
    3: "Moderate: changes the scope of collection, sharing, retention or user rights in a limited way, "
       "or makes substantial changes whose effect is unclear.",
    4: "High: expands collection, sharing, advertising/tracking or automated/AI processing of user data, "
       "or narrows user rights or legal remedies (e.g. arbitration, liability waivers).",
    5: "Critical: newly permits training AI models on user content or data, selling or broadly sharing "
       "sensitive data (biometric, health, precise location, minors' data), or removes key user rights.",
}

_LEXICON: dict[str, list[str]] = {
    "data_collection": [r"\bcollect", r"\binformation (we|you) (provide|give)", r"\bdevice (information|identifiers?)",
                        r"\blocation", r"\bcontacts?\b", r"\bcamera\b", r"\bmicrophone", r"\bbiometric",
                        r"\bface (geometry|recognition)", r"\bmetadata\b", r"\bcookies?\b", r"\bsensor"],
    "data_sharing": [r"\bshar(e|es|ed|ing)\b", r"\bthird[- ]part(y|ies)", r"\bpartners?\b", r"\bdisclos",
                     r"\baffiliates?\b", r"\bvendors?\b", r"\bservice providers?\b", r"\bsell\b|\bsale of\b",
                     r"\btransfer(red)? to\b", r"\bfamily of companies\b", r"\bmeta companies\b"],
    "data_retention": [r"\bretain", r"\bretention", r"\bdelet(e|ion)", r"\bstore(d)? for\b", r"\bkeep (your|this)",
                       r"\bas long as\b", r"\bdays?\b.*\bafter\b"],
    "ai_training": [r"\bartificial intelligence\b", r"\bmachine learning\b", r"\bgenerative\b", r"\bAI\b",
                    r"\b(large )?language models?\b", r"\btrain(ing|ed)? (our |the )?(models?|AI|algorithms)"],
    "advertising_tracking": [r"\badvertis", r"\bads\b", r"\bpersonali[sz]ed\b", r"\bpixel", r"\bSDKs?\b",
                             r"\bmeasurement\b", r"\bmarketing\b", r"\btargeted\b", r"\bcross[- ]site\b", r"\btracking\b"],
    "user_rights": [r"\bright to\b", r"\byour (rights|choices)\b", r"\bopt[- ]?out\b", r"\bopt[- ]?in\b",
                    r"\baccess (your|and)\b", r"\bportability\b", r"\bobject\b", r"\bwithdraw (your )?consent",
                    r"\bcorrect(ion)?\b", r"\bappeal\b", r"\bcontrols?\b", r"\bsettings\b"],
    "security": [r"\bsecur(e|ity)\b", r"\bencrypt", r"\bbreach", r"\bunauthori[sz]ed\b", r"\bsafeguards?\b",
                 r"\bend-to-end\b"],
    "international_transfers": [r"\binternational\b", r"\bcross[- ]border\b", r"\bstandard contractual clauses\b",
                                r"\badequacy\b", r"\bdata privacy framework\b", r"\boutside (of )?(the |your )?(EEA|country|European)",
                                r"\btransfer(s|red)? .{0,30}(countries|outside)"],
    "legal_obligations": [r"\barbitration\b", r"\bclass action\b", r"\bliabilit", r"\bindemnif", r"\bgoverning law\b",
                          r"\bjurisdiction\b", r"\bdispute", r"\blaw enforcement\b", r"\bsubpoena", r"\bterminat",
                          r"\bwarrant(y|ies)\b", r"\blicen[cs]e\b", r"\broyalty[- ]free\b"],
}
_LEX = {k: [re.compile(p, re.I) for p in v] for k, v in _LEXICON.items()}

_SENSITIVE = re.compile(r"\b(biometric|face (geometry|recognition)|voiceprint|health|precise (geo)?location|"
                        r"sexual orientation|religio|racial|ethnic|children'?s data|minors?'? (data|information)|"
                        r"under (13|16|18))", re.I)
_SELL = re.compile(r"\b(sell|sale of) (your )?(personal )?(data|information)\b", re.I)
_RIGHTS_REMOVAL = re.compile(r"\b(waive|class action|binding arbitration|you (may|can) not (sue|bring)|"
                             r"limit(ation)? of liability|sole discretion)\b", re.I)
_EXPAND = re.compile(r"\b(we (may|will|can) (now )?(also )?(collect|share|use|disclose|process|retain|combine)|"
                     r"in order to (develop|improve|train)|share .{0,40} with|third[- ]party|partners?)\b", re.I)
_DATE_ONLY = re.compile(r"^(last (updated|modified|revised)|effective( date)?|date of last revision)\b[:\s]*.*$|"
                        r"^(january|february|march|april|may|june|july|august|september|october|november|december)"
                        r"\s+\d{1,2},?\s+\d{4}\.?$", re.I)

# --------------------------------------------------------------------------- AI clauses
_AI_TERM = r"(artificial intelligence|\bAI\b|A\.I\.|machine[- ]learning|generative|(large )?language models?|LLMs?|neural network|algorithms?|models?)"
_EXPLICIT_TRAINING = [
    re.compile(r"\btrain(s|ed|ing)?\b.{0,100}" + _AI_TERM, re.I),
    re.compile(_AI_TERM + r".{0,100}\btrain(s|ed|ing)?\b", re.I),
    re.compile(r"\b(develop|improv|build)(e|es|ed|ing)?\b.{0,40}\b(generative AI|AI models?|artificial intelligence models?|"
               r"machine learning models?|language models?|AI (features|technolog(y|ies)|systems?))", re.I),
]
_TRAINING_STAFF = re.compile(r"\b(employees?|staff|personnel|contractors?)\b.{0,40}\btrain", re.I)
_AI_PROVIDER = re.compile(r"\b((third[- ]party|external|partner|outside) .{0,40}(AI|artificial intelligence|model|LLM) "
                          r"(provider|service|partner|vendor|compan)|AI (providers?|partners?|vendors?)|OpenAI|Anthropic|"
                          r"Mistral|ChatGPT|Gemini|Copilot)", re.I)
_AUTOMATED = re.compile(r"\b(automated (decision|processing|systems?|means|tools?|technolog)|profiling|"
                        r"machine[- ]learning|algorithm(s|ic)?)\b", re.I)
_GENERAL_AI = re.compile(r"\b(artificial intelligence|AI|A\.I\.|generative|chatbots?|language models?|LLMs?|"
                         r"Meta AI|My AI|AI[- ](powered|features?|tools?|assistants?|generated))\b")
_AI_PREFILTER = re.compile(r"(\bAI\b|A\.I\.|artificial|machine|generative|language model|LLM|automat|algorithm|"
                           r"chatbot|OpenAI|Anthropic|profiling|train)", re.I)

AI_KINDS = {
    "explicit_training": "Explicit model-training language",
    "ai_provider_sharing": "Sharing with AI providers",
    "automated_processing": "Automated processing / ML",
    "general_ai": "General AI mention",
}


def classify_ai_sentence(s: str) -> str | None:
    """Return the most specific AI clause kind for a sentence, or None.

    `explicit_training` requires training language and an AI/model term in the same sentence and
    excludes staff-training sentences. Mentioning AI alone is only `general_ai`.
    """
    if not _AI_PREFILTER.search(s):
        return None
    has_ai = bool(_GENERAL_AI.search(s) or re.search(r"machine[- ]learning|algorithm|model", s, re.I))
    if has_ai and any(p.search(s) for p in _EXPLICIT_TRAINING) and not _TRAINING_STAFF.search(s):
        if re.search(r"\btrain", s, re.I) or re.search(r"generative AI|AI models?|language models?|machine learning models?", s, re.I):
            return "explicit_training"
    if _AI_PROVIDER.search(s) and re.search(r"\b(shar|provid|disclos|send|transfer|process)", s, re.I):
        return "ai_provider_sharing"
    if _GENERAL_AI.search(s):
        return "general_ai"
    if _AUTOMATED.search(s):
        return "automated_processing"
    return None


def detect_ai_clauses(text: str, max_len: int = 700) -> list[tuple[str, str, str]]:
    """Return (kind, evidence_sentence, clause_hash) for every AI-related sentence in a policy text."""
    out, seen = [], set()
    for s in sentences(text):
        kind = classify_ai_sentence(s)
        if not kind:
            continue
        h = sha256(s.lower())[:24]
        if h in seen:
            continue
        seen.add(h)
        out.append((kind, s[:max_len], h))
    return out


# --------------------------------------------------------------------------- heuristic analyzer
@dataclass
class Analysis:
    summary: str
    category: str
    secondary_categories: list[str]
    risk_score: int
    risk_level: str
    ai_training_mentioned: bool
    ai_training_evidence: str | None
    change_direction: str
    reasoning: str
    confidence: float | None = None
    signals: dict = field(default_factory=dict)


def _category_hits(text: str) -> dict[str, int]:
    return {cat: sum(len(p.findall(text)) for p in pats) for cat, pats in _LEX.items()}


def _first_substantive(lines: list[str], limit: int = 220) -> str | None:
    for line in lines:
        if len(line.split()) >= 6 and not _DATE_ONLY.match(line):
            return line if len(line) <= limit else line[: limit - 1].rsplit(" ", 1)[0] + "…"
    return None


def heuristic_analyze(document_type: str, added: str, removed: str, words_added: int, words_removed: int) -> Analysis:
    added_lines = [l for l in added.splitlines() if l.strip()]
    removed_lines = [l for l in removed.splitlines() if l.strip()]
    substantive_added = [l for l in added_lines if not _DATE_ONLY.match(l)]
    substantive_removed = [l for l in removed_lines if not _DATE_ONLY.match(l)]
    total = words_added + words_removed

    hits_add, hits_rem = _category_hits(added), _category_hits(removed)
    combined = {k: hits_add[k] * 1.0 + hits_rem[k] * 0.6 for k in hits_add}

    ai_new = [s for s in sentences(added) if classify_ai_sentence(s) == "explicit_training"]
    ai_old = {s.lower() for s in sentences(removed) if classify_ai_sentence(s) == "explicit_training"}
    ai_added = [s for s in ai_new if s.lower() not in ai_old]
    if ai_added:
        combined["ai_training"] += 6

    ranked = sorted((k for k, v in combined.items() if v > 0), key=lambda k: combined[k], reverse=True)
    category = ranked[0] if ranked else "other"
    if not substantive_added and not substantive_removed:
        category = "other"
    secondary = [k for k in ranked[1:4] if combined[k] >= max(2.0, combined[category] * 0.35)]

    # Direction
    expand_add = len(_EXPAND.findall(added))
    expand_rem = len(_EXPAND.findall(removed))
    if total < 15 or (not substantive_added and not substantive_removed):
        direction = "editorial"
    elif expand_add > expand_rem + 1 and words_added > words_removed * 1.2:
        direction = "expanded_permission"
    elif expand_rem > expand_add + 1 and words_removed > words_added * 1.2:
        direction = "reduced_permission"
    elif total < 120:
        direction = "clarification"
    else:
        direction = "mixed"

    # Risk score, following RISK_RUBRIC
    reasons: list[str] = []
    if direction == "editorial":
        score = 1
        reasons.append(f"Only {total} words changed and no substantive privacy wording was added or removed.")
    elif direction == "clarification" and max(hits_add.values(), default=0) < 3:
        score = 2
        reasons.append(f"A small edit ({words_added} words added, {words_removed} removed) with few privacy-relevant terms.")
    else:
        score = 3 if total >= 60 else 2
        reasons.append(f"{words_added} words added and {words_removed} removed; main topic: {CATEGORIES[category].lower()}.")
    if direction == "expanded_permission" and category in ("data_collection", "data_sharing", "advertising_tracking", "ai_training"):
        score = max(score, 4)
        reasons.append("Added wording expands what the service may collect, use or share.")
    if _RIGHTS_REMOVAL.search(added) and not _RIGHTS_REMOVAL.search(removed):
        score = max(score, 4)
        reasons.append("New wording limits legal remedies or liability (e.g. arbitration, waivers).")
    if _SENSITIVE.search(added) and (hits_add["data_sharing"] + hits_add["data_collection"]) >= 2 and total >= 40:
        score = max(score, 4)
        reasons.append("Added text refers to sensitive data categories together with collection or sharing.")
    if _SELL.search(added) and not _SELL.search(removed):
        score = 5
        reasons.append("Added text refers to selling personal data.")
    if ai_added:
        score = max(score, 5 if direction == "expanded_permission" or len(ai_added) >= 2 else 4)
        reasons.append("Added text explicitly mentions training AI or machine-learning models.")
    if direction == "reduced_permission" and score > 2 and not ai_added:
        score -= 1
        reasons.append("Net effect appears to narrow permissions, lowering the score.")
    score = max(1, min(5, score))

    doc = document_type.lower()
    if direction == "editorial":
        summary = f"Minor editorial update to the {doc} (dates, formatting or wording); no substantive change detected."
    else:
        verb = {"expanded_permission": "appears to broaden", "reduced_permission": "appears to narrow",
                "clarification": "clarifies", "mixed": "revises"}[direction]
        summary = (f"This update {verb} the {doc}'s language on {CATEGORIES[category].lower()}"
                   + (f", also touching {', '.join(CATEGORIES[c].lower() for c in secondary)}" if secondary else "")
                   + f" ({words_added:,} words added, {words_removed:,} removed).")
        example = _first_substantive(substantive_added)
        if example:
            summary += f' New text includes: "{example}"'

    return Analysis(
        summary=summary,
        category=category,
        secondary_categories=secondary,
        risk_score=score,
        risk_level=RISK_LEVELS[score],
        ai_training_mentioned=bool(ai_added),
        ai_training_evidence=ai_added[0][:700] if ai_added else None,
        change_direction=direction,
        reasoning=" ".join(reasons) + " Rule-based estimate, not legal advice.",
        confidence=None,
        signals={"hits_added": hits_add, "hits_removed": hits_rem},
    )
