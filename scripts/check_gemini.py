"""Check a Gemini API key before running any analysis (one tiny request; the key is never printed).

1. Lists the models this key can use for generateContent.
2. Confirms GEMINI_MODEL is one of them.
3. Makes one small structured-output call with ClauseBerry's real analysis schema and validates it.

Usage:  python scripts/check_gemini.py [--list-only]
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.common import gemini_model  # noqa: E402  (also loads .env and the OS trust store)
from pipeline.analyze_llm import llm_analyze  # noqa: E402


def main(list_only: bool) -> int:
    key = os.environ.get("GEMINI_API_KEY", "")
    if not key:
        print("GEMINI_API_KEY is not set (add it to D:\\Projects\\TOS\\.env).")
        return 1
    print(f"GEMINI_API_KEY is set ({len(key)} characters, value hidden).")
    from google import genai

    client = genai.Client(api_key=key)
    try:
        models = sorted(m.name.removeprefix("models/") for m in client.models.list()
                        if "generateContent" in (getattr(m, "supported_actions", None) or []))
    except Exception as exc:
        print(f"Could not list models: {type(exc).__name__}: {str(exc)[:300]}")
        return 1
    print(f"{len(models)} models support generateContent for this key:")
    for m in models:
        print(f"  {m}")
    configured = gemini_model()
    if configured not in models:
        print(f"\nGEMINI_MODEL={configured} is NOT available to this key. Set GEMINI_MODEL to one listed above.")
        return 1
    print(f"\nGEMINI_MODEL={configured} is available.")
    if list_only:
        return 0
    added = "We may use your posts and photos to develop and train our artificial intelligence models."
    try:
        result = llm_analyze(client, configured, "ExampleApp", "Privacy Policy", added, "", retries=2)
    except Exception as exc:
        print(f"Structured-output test call failed: {str(exc)[:400]}")
        return 1
    print("Structured-output test call succeeded and passed schema validation:")
    print(f"  category={result.category} risk_score={result.risk_score} "
          f"ai_training_mentioned={result.ai_training_mentioned} confidence={result.confidence}")
    print(f"  summary: {result.summary}")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--list-only", action="store_true", help="only list models; make no generation call")
    sys.exit(main(ap.parse_args().list_only))
