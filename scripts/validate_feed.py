"""Second, independent gate. Runs in the PUBLIC repo on every push and PR.

Fails the build (so GitHub Pages never deploys) if data/feed.json:
  * has any key outside schema/public_feed.schema.json
  * is marked synthetic
  * contains free text matching schema/text_policy.json deny patterns
  * contains any file other than the whitelisted site files under data/
Usage: python scripts/validate_feed.py
"""
import json
import re
import sys
from pathlib import Path

import jsonschema

ROOT = Path(__file__).resolve().parent.parent
feed = json.loads((ROOT / "data/feed.json").read_text())
schema = json.loads((ROOT / "schema/public_feed.schema.json").read_text())
policy = json.loads((ROOT / "schema/text_policy.json").read_text())
errors = []

try:
    jsonschema.validate(feed, schema)
except jsonschema.ValidationError as e:
    errors.append(f"schema: {e.message} at {list(e.absolute_path)}")

if feed.get("synthetic"):
    errors.append("feed is marked synthetic; synthetic feeds may not be published")

extra = [p.name for p in (ROOT / "data").iterdir() if p.name != "feed.json"]
if extra:
    errors.append(f"unexpected files in data/: {extra}")


def scan(where, text):
    for pat in policy["deny_patterns"]:
        m = re.search(pat, text)
        if m:
            errors.append(f"{where}: blocked pattern matched {m.group(0)!r}")
    for term in policy["deny_terms"]:
        if re.search(rf"\b{re.escape(term)}\b", text, re.I):
            errors.append(f"{where}: blocked term {term!r}")


for f in feed.get("findings", []):
    for k in ("title", "insight", "why_surprising", "action_taken", "population_label"):
        scan(f"{f.get('id')}.{k}", str(f.get(k, "")))
    for c in f.get("evidence", {}).get("skeptic_concerns", []):
        scan(f"{f.get('id')}.skeptic_concerns", c)

# Literature cards: Waymark-written text gets the full deny list. Titles and venues are registry
# records that may contain years and digits, so they get the identifier subset only.
IDENTIFIER_PATTERNS = [r"[\w.+-]+@[\w-]+\.[\w.]+", r"(?i)https?://", r"(?i)\b(patient|member)\s+(id|#|number)",
                       r"(?i)\bMRN\b", r"(?i)\bmedicaid\s+id\b"]
for c in feed.get("literature", []):
    for k in ("what_it_means", "action_taken"):
        scan(f"{c.get('id')}.{k}", str(c.get(k, "")))
    for k in ("title", "venue"):
        for pat in IDENTIFIER_PATTERNS:
            m = re.search(pat, str(c.get(k, "")))
            if m:
                errors.append(f"{c.get('id')}.{k}: identifier pattern matched {m.group(0)!r}")
    if not (c.get("doi") or c.get("pmid") or c.get("arxiv_id")):
        errors.append(f"{c.get('id')}: no registry identifier")

# Waymark publications: registry bibliographic records only.
for i, p in enumerate(feed.get("publications", [])):
    for k in ("title", "venue"):
        for pat in IDENTIFIER_PATTERNS:
            m = re.search(pat, str(p.get(k, "")))
            if m:
                errors.append(f"publications[{i}].{k}: identifier pattern matched {m.group(0)!r}")
    if not (p.get("doi") or p.get("pmid")):
        errors.append(f"publications[{i}]: no registry identifier")

# Status-only stream and counts: independent re-check of the small-cell rule.
for row in feed.get("intake", []):
    for k in ("screened", "relevant"):
        if row.get(k) is not None and row[k] < policy["min_cell_size"]:
            errors.append(f"intake {row.get('month')}/{row.get('source')}: {k} below minimum cell size")
approved_ids = {f.get("id") for f in feed.get("findings", [])}
for row in feed.get("stream", []):
    if row.get("gate") == "published" and row.get("id") not in approved_ids:
        errors.append(f"stream {row.get('id')}: marked published without an approved finding")

if errors:
    print("FEED REJECTED")
    print("\n".join(errors))
    sys.exit(1)
print(f"feed ok: {len(feed['findings'])} findings")
