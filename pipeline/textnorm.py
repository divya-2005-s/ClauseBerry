"""Policy text normalisation, sentence splitting and diffing.

The archive stores policies as Markdown converted from HTML. Many captured "changes" are only
asset URLs, link targets, emphasis markers or whitespace. `normalize` removes that noise so the
diff reflects wording changes a reader would notice.
"""
from __future__ import annotations

import difflib
import hashlib
import re
from dataclasses import dataclass

_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_LINK = re.compile(r"\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)")
_BARE_URL = re.compile(r"https?://\S+")
_HTML_BREAK = re.compile(r"<br\s*/?>|</?p>|</li>|</div>", re.I)
_HTML_TAG = re.compile(r"</?[a-zA-Z][^>]{0,200}>")
_TRAIL_MARK = re.compile(r"(?<=\w)[*_]+(?=\W|$)|(?<=[.,;:!?)])[*_]+")
_HEADING_RULE = re.compile(r"^\s*([=\-_*]{3,}|\|?(\s*:?-+:?\s*\|)+\s*(:?-+:?)?)\s*$")
_TABLE_PIPE = re.compile(r"\s*\|\s*")
_MD_MARKS = re.compile(r"(\*\*|__|(?<!\w)[*_](?!\s)|(?<!\S)#{1,6}\s|^\s*[>*+\-•●▪◦]\s+|\\(?=[^\w\s]))")
_WS = re.compile(r"[ \t  -​ 　]+")
_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-",
                         "—": "-", "�": "'"})
_NUMBERED = re.compile(r"^\s*\d+(\.\d+)*\.?\s+")

NORMALIZER_VERSION = "norm-v3"
DETECTOR_VERSION = "diff-v3"


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def clean_line(line: str) -> str:
    line = line.translate(_QUOTES)
    line = _IMAGE.sub("", line)
    line = _LINK.sub(r"\1", line)
    line = _BARE_URL.sub("", line)
    line = _HTML_TAG.sub(" ", line)
    line = _MD_MARKS.sub("", line)
    line = _TRAIL_MARK.sub("", line)
    line = _WS.sub(" ", line).strip()
    if "|" in line:  # markdown table row -> cells separated by a middle dot
        line = _TABLE_PIPE.sub(" · ", line.strip("| ")).strip(" ·")
    return line


def normalize_lines(text: str) -> list[str]:
    """Return the meaningful text lines of a policy, with formatting noise removed."""
    out = []
    for raw in _HTML_BREAK.sub("\n", text or "").splitlines():
        if _HEADING_RULE.match(raw):
            continue
        line = clean_line(raw)
        if len(line) >= 2:
            out.append(line)
    return out


def normalize(text: str) -> str:
    return "\n".join(normalize_lines(text))


def word_count(text: str) -> int:
    return len(re.findall(r"\w+", text or ""))


_SENT_SPLIT = re.compile(r"(?<=[.!?;])\s+(?=[A-Z0-9\"'(])")


def sentences(text: str) -> list[str]:
    """Split normalised text into sentences (lines first, then sentence punctuation)."""
    out: list[str] = []
    for line in normalize_lines(text):
        for s in _SENT_SPLIT.split(line):
            s = s.strip()
            if len(s) > 3:
                out.append(s)
    return out


@dataclass
class DiffResult:
    added_lines: list[str]
    removed_lines: list[str]
    words_added: int
    words_removed: int

    @property
    def added_text(self) -> str:
        return "\n".join(self.added_lines)

    @property
    def removed_text(self) -> str:
        return "\n".join(self.removed_lines)


def _words(s: str) -> list[str]:
    return re.findall(r"\w+|[^\w\s]", s.lower())


def diff_texts(old: str, new: str) -> DiffResult:
    """Line-level diff of normalised texts with word-level counts for replaced blocks."""
    a, b = normalize_lines(old), normalize_lines(new)
    sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    added, removed = [], []
    wa = wr = 0
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        rem, add = a[i1:i2], b[j1:j2]
        removed.extend(rem)
        added.extend(add)
        ow, nw = _words(" ".join(rem)), _words(" ".join(add))
        wsm = difflib.SequenceMatcher(a=ow, b=nw, autojunk=False)
        for t, x1, x2, y1, y2 in wsm.get_opcodes():
            if t in ("replace", "delete"):
                wr += sum(1 for w in ow[x1:x2] if w.isalnum())
            if t in ("replace", "insert"):
                wa += sum(1 for w in nw[y1:y2] if w.isalnum())
    return DiffResult(added, removed, wa, wr)


def inline_diff(old: str, new: str, max_segments: int = 4000) -> list[dict]:
    """Paragraph-aligned diff for the comparison view.

    Returns a list of blocks: {"type": "equal"|"added"|"removed"|"modified", "old": str, "new": str,
    "words": [{"op": "equal"|"insert"|"delete", "text": str}]} where `words` is filled for modified
    blocks so the UI can highlight word-level edits.
    """
    a, b = normalize_lines(old), normalize_lines(new)
    sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    blocks: list[dict] = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            blocks.append({"type": "equal", "old": "\n".join(a[i1:i2]), "new": "\n".join(b[j1:j2]), "lines": i2 - i1})
        elif tag == "delete":
            blocks.append({"type": "removed", "old": "\n".join(a[i1:i2]), "new": ""})
        elif tag == "insert":
            blocks.append({"type": "added", "old": "", "new": "\n".join(b[j1:j2])})
        else:
            old_s, new_s = "\n".join(a[i1:i2]), "\n".join(b[j1:j2])
            ow = re.findall(r"\S+|\s+", old_s)
            nw = re.findall(r"\S+|\s+", new_s)
            wsm = difflib.SequenceMatcher(a=ow, b=nw, autojunk=False)
            words = []
            for t, x1, x2, y1, y2 in wsm.get_opcodes():
                if t == "equal":
                    words.append({"op": "equal", "text": "".join(nw[y1:y2])})
                else:
                    if x2 > x1:
                        words.append({"op": "delete", "text": "".join(ow[x1:x2])})
                    if y2 > y1:
                        words.append({"op": "insert", "text": "".join(nw[y1:y2])})
            similarity = wsm.ratio()
            if similarity < 0.3:  # unrelated paragraphs: show as remove + add
                blocks.append({"type": "removed", "old": old_s, "new": ""})
                blocks.append({"type": "added", "old": "", "new": new_s})
            else:
                blocks.append({"type": "modified", "old": old_s, "new": new_s, "words": words[:max_segments]})
    return blocks
