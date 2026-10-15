# Waymark Discovery Lab (public site)

Static GitHub Pages site that shows findings from Waymark's private discovery engine: hypotheses tested on de-identified Medicaid data, and new published or preprint research screened for whether it applies to Waymark and tested in Waymark's own data where possible.

This repo holds no member data. Its only data file is `data/feed.json`, written by the private engine's publish workflow after:

1. the finding passed online FDR control, replication on held-out members, and a negative control (or, for a literature card, the paper's identity was re-verified against its registry record),
2. a Waymark clinician approved the card, and
3. the engine's firewall rebuilt it from a whitelist.

Hypotheses and papers that are not approved appear only as status and statistics (id, template, topic tag, gate reached, p-value, threshold), never with variable names or text.

Every push then runs `scripts/validate_feed.py` here, an independent second check against `schema/public_feed.schema.json` and `schema/text_policy.json`. A synthetic feed, an unknown key, blocked text, a paper count under 11, or a literature card without a registry identifier fails the build, and Pages does not deploy.

Preview locally: `python -m http.server` and open http://localhost:8000.
