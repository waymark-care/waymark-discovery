/* Waymark Discovery Lab: renders data/feed.json only. No third-party code, no tracking.
   Every mark on the page maps to a feed item or a feed counter. Feed strings are written
   with textContent or SVG text nodes, never parsed as HTML. */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const NS = "http://www.w3.org/2000/svg";
  const root = document.documentElement;
  const css = (n) => getComputedStyle(root).getPropertyValue(n).trim();
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmtMonth = (ym) => { if (!ym) return "—"; const [y, m] = ym.split("-"); return `${MONTHS[+m - 1]} ${y}`; };
  const fmtDate = (d) => { if (!d) return null; const [y, m, dd] = d.split("-"); return `${+dd} ${MONTHS[+m - 1]} ${y}`; };
  const x2 = (v) => (v == null ? "—" : v.toFixed(2));
  const num = (v) => (v == null ? "—" : v.toLocaleString("en-US"));
  const pct = (a, b) => (b > 0 ? Math.max(0, Math.min(1, a / b)) : 0);
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const TAGS = {
    "social-needs": "Social needs", "medication-safety": "Medication safety", timing: "Timing",
    "chronic-disease": "Chronic disease", access: "Access", "care-model": "Care model",
    "behavioral-health": "Behavioral health", "maternal-health": "Maternal health", pharmacy: "Pharmacy", utilization: "Utilization",
  };
  const TAG_KEYS = Object.keys(TAGS);
  const TEMPLATES = { cyclic_window_interaction: "cyclic_window", cyclic_window_single: "cyclic_single", stratified_rate_ratio: "stratified_rr" };
  const GATES = ["invalid_spec", "insufficient_data", "underpowered", "not_significant", "failed_replication", "failed_negative_control", "rejected_by_skeptic", "in_review", "published"];
  const gateRank = (g) => GATES.indexOf(g);
  const passedDiscovery = (s) => gateRank(s.gate) > 2;
  const AGENTS = ["scout", "verifier", "screener", "appraiser", "corroborator", "skeptic", "translator", "hypothesizer", "tester", "replicator", "controller", "narrator", "clinician"];
  const SOURCES = ["pubmed", "arxiv", "medrxiv", "biorxiv", "openalex"];
  const PROGRAMS = {
    chw: "community health workers", pharmacy: "pharmacy", behavioral_health: "behavioral health", care_coordination: "care coordination",
    social_needs: "social needs", compass: "Compass", signal: "Signal", anchor: "ANCHOR", waypoint: "Waypoint",
    causal_methods: "causal methods", ai_safety: "AI safety",
  };
  const DESIGNS = {
    rct: "randomized trial", quasi_experimental: "quasi-experimental", cohort: "cohort", case_control: "case-control",
    cross_sectional: "cross-sectional", qualitative: "qualitative", systematic_review: "systematic review", modeling: "modeling",
    methods: "methods", other: "other",
  };
  const LOCAL = {
    replicated_locally: "Replicated in Waymark data", not_replicated_locally: "Did not replicate in Waymark data",
    not_testable: "Not testable in Waymark data", pending: "Local test pending",
  };

  /* ---------- DOM helpers ---------- */
  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "style") n.setAttribute("style", v);
      else if (k === "href") n.href = v;
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) n.append(c instanceof Node ? c : String(c));
    return n;
  }
  function el(tag, attrs = {}, parent) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  }
  function svgText(parent, attrs, text) { const t = el("text", attrs, parent); t.textContent = text; return t; }
  const fill = (node, ...kids) => { node.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false)); return node; };
  const none = (text) => h("div", { class: "none", text });

  /* ---------- tooltip (text nodes only) ---------- */
  const tip = $("#tip");
  function showTip(lines, ev) {
    fill(tip, lines.map((l) => h("div", { text: l })));
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;
    tip.style.left = Math.max(4, x) + "px"; tip.style.top = Math.max(4, y) + "px";
  }
  const hideTip = () => { tip.hidden = true; };
  addEventListener("scroll", hideTip, { passive: true });
  function streamLines(s, i) {
    return [
      `${s.id} · #${(i + 1).toLocaleString("en-US")} in stream`,
      `${fmtMonth(s.month)} · ${TEMPLATES[s.template] || s.template}`,
      `tags: ${s.tags.length ? s.tags.join(", ") : "none"}`,
      `−log10 p: ${s.neg_log10_p == null ? "not tested" : s.neg_log10_p.toFixed(2)}`,
      `−log10 α (LORD++): ${s.neg_log10_alpha == null ? "—" : s.neg_log10_alpha.toFixed(2)}`,
      `gate: ${s.gate}`,
      `source: ${s.source}`,
    ];
  }

  /* ---------- deterministic hash ---------- */
  function hash(str) { let x = 2166136261; for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }
  function rng(seed) { let a = seed || 1; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  /* ---------- normalize ---------- */
  const EMPTY_LP = { intake: 0, identity_verified: 0, relevant: 0, appraised: 0, applies: 0, corroborated: 0, skeptic_passed: 0, translated: 0, tested_locally: 0, replicated_locally: 0, approved: 0, published: 0 };
  const EMPTY = { schema_version: "1", generated_at: null, synthetic: false, findings: [], stream: [], activity: [], intake: [], literature: [], publications: [], published_findings: [], literature_pipeline: EMPTY_LP,
    pipeline: { proposed: 0, tested: 0, passed_discovery: 0, replicated: 0, passed_controls: 0, approved: 0, published: 0, last_run: null, fdr_alpha: 0.05, fdr_method: "LORD++", min_cell_size: 11 } };
  function normalize(f) {
    const feed = Object.assign({}, EMPTY, f || {});
    for (const k of ["findings", "stream", "activity", "intake", "literature", "publications", "published_findings"]) if (!Array.isArray(feed[k])) feed[k] = [];
    feed.pipeline = Object.assign({}, EMPTY.pipeline, feed.pipeline || {});
    feed.literature_pipeline = Object.assign({}, EMPTY_LP, feed.literature_pipeline || {});
    feed.activitySorted = feed.activity.slice().sort((a, b) => a.seq - b.seq);
    return feed;
  }

  /* ---------- counter strip ---------- */
  function counter(node, key, value, sub, frac) {
    fill(node,
      h("div", { class: "k", text: key }),
      h("div", { class: "v", text: num(value) }),
      h("div", { class: "s", text: sub }),
      h("div", { class: "rule", role: "presentation" }, h("i", { style: `width:${(100 * (frac || 0)).toFixed(1)}%` })));
    node.title = `${key}: ${num(value)}. ${sub}`;
  }
  function renderStrip(feed) {
    const p = feed.pipeline, lp = feed.literature_pipeline;
    const live = !!p.last_run;
    $("#status-dot").classList.toggle("live", live);
    $("#status-text").textContent = live ? `Last agent run ${fmtDate(p.last_run)}` : "Agents not yet connected";
    $("#feed-date").textContent = fmtDate(feed.generated_at) || "—";
    $("#synthetic").hidden = !feed.synthetic;
    $("#fdr-pct").textContent = `${+(p.fdr_alpha * 100).toFixed(2)}%`;

    const tested = feed.stream.filter((s) => s.neg_log10_p != null).length;
    const agentsActive = new Set(feed.activity.map((a) => a.agent)).size;
    const pubs = feed.publications;
    const peer = pubs.filter((x) => x.peer_reviewed).length;
    const repPubs = pubs.filter((x) => x.replicated).length;
    const approved = p.approved + lp.approved;
    const waiting = Math.max(0, p.passed_controls - p.approved) + Math.max(0, lp.skeptic_passed - lp.approved);
    const published = p.published + feed.literature.length + pubs.length;
    counter($("#c-papers"), "Papers screened", lp.intake, lp.intake ? `${Math.round(100 * pct(lp.relevant, lp.intake))}% relevant` : "none yet", pct(lp.relevant, lp.intake));
    counter($("#c-hyp"), "Hypotheses", feed.stream.length, feed.stream.length ? `${num(tested)} tested` : "none yet", pct(tested, feed.stream.length));
    counter($("#c-agents"), "Agents", agentsActive || AGENTS.length, agentsActive ? `active of ${AGENTS.length} in log` : `${AGENTS.length} configured, no log yet`, agentsActive ? agentsActive / AGENTS.length : 0);
    counter($("#c-rep"), "Replicated", p.replicated + repPubs, `${num(repPubs)} published · ${num(p.replicated)} agent hypotheses`, pct(p.replicated + repPubs, p.passed_discovery + peer));
    counter($("#c-review"), "Reviewed", peer + approved, `${num(peer)} peer-reviewed · ${num(approved)} clinician-approved · ${num(waiting)} awaiting review`, pct(peer + approved, peer + approved + waiting));
    counter($("#c-pub"), "Published", published, `${num(p.published)} findings · ${num(feed.literature.length)} checked · ${num(feed.publications.length)} by Waymark`, pct(p.published, p.approved || p.published) || (published ? 1 : 0));
  }

  /* ================= OBSERVATORY ================= */
  function startObservatory(feed) {
    const cv = $("#obs"), ctx = cv.getContext("2d");
    const stream = feed.stream, N = stream.length;
    const litActs = feed.activitySorted.filter((a) => a.object.startsWith("LIT-"));
    const tested = [];
    let maxP = 0;
    stream.forEach((s, i) => { if (s.neg_log10_p != null) { tested.push(i); maxP = Math.max(maxP, s.neg_log10_p); } if (s.neg_log10_alpha != null) maxP = Math.max(maxP, s.neg_log10_alpha); });
    const P = Math.min(20, Math.max(5, maxP));
    const nHeavy = stream.filter(passedDiscovery).length;
    const heavyA = Math.max(0.3, Math.min(1, 150 / Math.max(1, nHeavy)));   // keep heavy marks readable when there are many
    // literature id -> stream index of a hypothesis it produced
    const litTarget = new Map();
    stream.forEach((s, i) => { if (s.source !== "internal" && !litTarget.has(s.source)) litTarget.set(s.source, i); });

    // ledger lines, interleaved in order: activity entries among stream entries
    const ledger = [];
    {
      const acts = feed.activitySorted;
      const every = acts.length ? Math.max(1, Math.floor(N / acts.length)) : Infinity;
      let ai = 0;
      for (let i = 0; i < N; i++) {
        const s = stream[i];
        ledger.push({ t: `${s.id} ${TEMPLATES[s.template] || s.template} ${s.tags[0] || "untagged"} −log p ${s.neg_log10_p == null ? "—" : s.neg_log10_p.toFixed(1)} → ${s.gate}`,
          w: s.gate === "published" ? 2 : passedDiscovery(s) ? 1 : 0 });
        if (ai < acts.length && i % every === every - 1) { const a = acts[ai++]; ledger.push(actLine(a)); }
      }
      while (ai < acts.length) ledger.push(actLine(acts[ai++]));
    }
    function actLine(a) {
      return { t: `${String(a.seq).padStart(5, "0")} ${a.agent} ${a.verb} ${a.object} → ${a.outcome || "logged"}`,
        w: a.outcome === "pass" && (a.verb === "approve") ? 2 : a.outcome === "pass" ? 1 : 0 };
    }

    $("#key-left").textContent = N || litActs.length
      ? `One curve per hypothesis (${num(N)}) and one per agent action on a paper (${num(litActs.length)}). Paper curves enter from the left edge.`
      : "No hypotheses or agent actions in the feed yet. Curves appear here after the first agent run.";
    $("#key-ring").textContent = ledger.length
      ? `${num(ledger.length)} ledger lines from the stream and the agent log. Outer ticks count hypotheses in stream order.`
      : "The ledger is empty until the first agent run.";
    cv.setAttribute("aria-label", N
      ? `Observatory: ${num(N)} hypotheses, ${num(tested.length)} tested, ${num(stream.filter(passedDiscovery).length)} passed the discovery threshold, ${num(litActs.length)} agent actions on papers.`
      : "Observatory: no hypotheses in the feed yet.");

    let W = 0, H = 0, dpr = 1, G = null, colors = {};
    let fieldLayer, specLayer, fieldDone = 0, specDone = 0, scroll = 0, hover = -1, running = false, visible = true, last = 0;
    const curves = [];    // precomputed normalized curve params
    const order = [];     // draw order for curves (stream then papers)

    function geometry() {
      const w = W;
      let g;
      if (w < 640) g = { cx: -0.42 * w, rin: 0.86 * w, band: Math.max(0.24 * w, 84), font: 6.5, lh: 8, tick: 18 };
      else if (w < 1000) g = { cx: -0.2 * w, rin: 0.64 * w, band: 0.21 * w, font: 7.5, lh: 9, tick: 24 };
      else g = { cx: -0.08 * w, rin: 0.5 * w, band: 0.2 * w, font: 8, lh: 9.5, tick: 30 };
      g.cy = H / 2;
      g.rout = g.rin + g.band;
      g.r0 = g.rout + 7;
      g.L = Math.max(40, w - (g.cx + g.r0) - 10);
      g.tmax = Math.asin(Math.min(0.98, (H / 2 - 6) / g.rout));
      g.t0 = -g.tmax * 0.96; g.t1 = g.tmax * 0.96;
      return g;
    }
    const angleOf = (i) => (N <= 1 ? 0 : G.t0 + ((G.t1 - G.t0) * i) / (N - 1));

    function resize() {
      const r = cv.getBoundingClientRect();
      W = Math.max(280, Math.round(r.width));
      H = Math.round(W < 640 ? W * 1.22 : W < 1000 ? W * 0.74 : Math.min(860, Math.max(440, W * 0.54)));
      if (!N && !litActs.length) H = Math.round(Math.max(220, H * 0.45)); // nothing to plot: keep the empty instrument short
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.style.height = H + "px";
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      G = geometry();
      fieldLayer = layer(); specLayer = layer();
      precompute();
      fieldDone = reduceMotion ? order.length : 0;
      specDone = reduceMotion ? tested.length : 0;
      if (reduceMotion) { paintField(0, order.length); paintSpec(0, tested.length); }
    }
    function layer() { const c = document.createElement("canvas"); c.width = cv.width; c.height = cv.height; const x = c.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); return { c, x }; }
    function readColors() {
      colors = { ink: css("--ink"), ink2: css("--ink-2"), muted: css("--muted"), faint: css("--faint"), line: css("--line"), rule: css("--rule"), surface: css("--surface"), paper: css("--paper"), accent: css("--accent"), wash: css("--wash") };
    }

    function precompute() {
      curves.length = 0; order.length = 0;
      const fx = Math.max(60, G.cx + G.rin * Math.cos(G.tmax) - 30); // right limit of the free field at top/bottom
      for (let i = 0; i < N; i++) {
        const s = stream[i], R = rng(hash(s.id + "|" + s.template));
        const th = angleOf(i);
        const ex = G.cx + G.rin * Math.cos(th), ey = G.cy + G.rin * Math.sin(th);
        const sx = W * (0.05 + 0.22 * R()), sy = H * (0.08 + 0.84 * R());
        const c1x = Math.min(fx, W * (0.04 + 0.34 * R())), c1y = H * (-0.1 + 1.2 * R());
        const pull = W * (0.05 + 0.12 * R());
        const c2x = ex - pull * Math.cos(th) + (R() - 0.5) * W * 0.04, c2y = ey - pull * Math.sin(th) + (R() - 0.5) * H * 0.08;
        curves.push({ sx, sy, c1x, c1y, c2x, c2y, ex, ey, k: s.gate === "published" ? 3 : passedDiscovery(s) ? 2 : 0 });
        order.push(order.length);
      }
      for (const a of litActs) {
        const R = rng(hash(a.object + "|" + a.seq));
        const ti = litTarget.has(a.object) ? litTarget.get(a.object) : -1;
        const th = ti >= 0 ? angleOf(ti) : G.t0 + (G.t1 - G.t0) * (hash(a.object) % 1000) / 999;
        const ex = G.cx + G.rin * Math.cos(th), ey = G.cy + G.rin * Math.sin(th);
        const sy = H * (0.04 + 0.92 * R());
        const c1x = W * (0.08 + 0.2 * R()), c1y = H * (0.04 + 0.92 * R());
        const pull = W * (0.04 + 0.1 * R());
        curves.push({ sx: 0, sy, c1x, c1y, c2x: ex - pull * Math.cos(th), c2y: ey - pull * Math.sin(th), ex, ey, k: 1, out: a.outcome });
        order.push(order.length);
      }
    }

    function paintField(from, to) {
      const x = fieldLayer.x;
      const n = Math.max(1, N);
      const thinA = Math.max(0.025, Math.min(0.35, 4.5 / Math.sqrt(n)));
      for (let j = from; j < to; j++) {
        const c = curves[order[j]];
        x.beginPath(); x.moveTo(c.sx, c.sy); x.bezierCurveTo(c.c1x, c.c1y, c.c2x, c.c2y, c.ex, c.ey);
        if (c.k === 0) { x.globalAlpha = thinA; x.strokeStyle = colors.ink; x.lineWidth = 0.6; }
        else if (c.k === 1) { x.globalAlpha = c.out === "fail" ? 0.25 : 0.5; x.strokeStyle = colors.ink; x.lineWidth = 0.8; }
        else if (c.k === 2) { x.globalAlpha = 0.75 * heavyA; x.strokeStyle = colors.ink; x.lineWidth = 0.9; }
        else { x.globalAlpha = 1; x.strokeStyle = colors.accent; x.lineWidth = 1.6; }
        x.stroke();
        if (c.k === 3 || (c.k === 2 && nHeavy <= 200)) { // open circle marks the start of a hypothesis that passed discovery
          x.globalAlpha = 1; x.lineWidth = 1; x.strokeStyle = c.k === 3 ? colors.accent : colors.ink;
          x.beginPath(); x.arc(c.sx, c.sy, 3, 0, Math.PI * 2); x.stroke();
        }
      }
      x.globalAlpha = 1;
    }

    function rayEnds(i) {
      const s = stream[i], th = angleOf(i), co = Math.cos(th), si = Math.sin(th);
      const r1 = G.r0 + (G.L * Math.min(P, s.neg_log10_p)) / P;
      return [G.cx + G.r0 * co, G.cy + G.r0 * si, G.cx + r1 * co, G.cy + r1 * si];
    }
    function paintSpec(from, to) {
      const x = specLayer.x;
      const thinA = Math.max(0.12, Math.min(0.8, 260 / Math.max(1, tested.length)));
      for (let j = from; j < to; j++) {
        const i = tested[j], s = stream[i], [ax, ay, bx, by] = rayEnds(i);
        const k = s.gate === "published" ? 3 : passedDiscovery(s) ? 2 : 0;
        x.globalAlpha = k === 3 ? 1 : k === 2 ? heavyA : thinA;
        x.strokeStyle = k === 3 ? colors.accent : k === 2 ? colors.ink : colors.ink2;
        x.lineWidth = k === 3 ? 2 : k === 2 ? 1.4 : 0.6;
        x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by); x.stroke();
        // per-ray threshold tick when rays are sparse enough to read
        if (s.neg_log10_alpha != null && tested.length <= 400) {
          const th = angleOf(i), r = G.r0 + (G.L * Math.min(P, s.neg_log10_alpha)) / P;
          const px = G.cx + r * Math.cos(th), py = G.cy + r * Math.sin(th), nx = -Math.sin(th) * 3, ny = Math.cos(th) * 3;
          x.globalAlpha = 1; x.strokeStyle = colors.ink; x.lineWidth = 1;
          x.beginPath(); x.moveTo(px - nx, py - ny); x.lineTo(px + nx, py + ny); x.stroke();
        }
      }
      x.globalAlpha = 1;
    }
    function drawThreshold(upto) {
      // the LORD++ threshold: each hypothesis's own −log10 α, one point at its angle
      if (!N) return;
      ctx.save(); ctx.fillStyle = colors.ink; ctx.globalAlpha = 0.85;
      const lim = Math.min(N, upto), d = N > 4000 ? 1.1 : 1.5;
      for (let i = 0; i < lim; i++) {
        const a = stream[i].neg_log10_alpha;
        if (a == null) continue;
        const th = angleOf(i), r = G.r0 + (G.L * Math.min(P, a)) / P;
        ctx.fillRect(G.cx + r * Math.cos(th) - d / 2, G.cy + r * Math.sin(th) - d / 2, d, d);
      }
      ctx.restore();
    }
    function drawRing() {
      const { cx, cy, rin, rout } = G;
      ctx.save();
      ctx.fillStyle = colors.paper;
      ctx.beginPath(); ctx.arc(cx, cy, rout, -Math.PI / 2, Math.PI / 2); ctx.arc(cx, cy, rin, Math.PI / 2, -Math.PI / 2, true); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = colors.ink; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(cx, cy, rin, -Math.PI / 2, Math.PI / 2); ctx.stroke();
      ctx.lineWidth = 0.8; ctx.strokeStyle = colors.ink2;
      ctx.beginPath(); ctx.arc(cx, cy, rout, -Math.PI / 2, Math.PI / 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, rin - 4, -Math.PI / 2, Math.PI / 2); ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
      ctx.lineWidth = 0.6; ctx.beginPath(); ctx.arc(cx, cy, rout - G.tick, -Math.PI / 2, Math.PI / 2); ctx.stroke();

      // ledger text, clipped to the band, scrolling upward
      ctx.beginPath(); ctx.arc(cx, cy, rout - G.tick - 3, -Math.PI / 2, Math.PI / 2); ctx.arc(cx, cy, rin + 3, Math.PI / 2, -Math.PI / 2, true); ctx.closePath(); ctx.clip();
      ctx.textBaseline = "middle";
      if (ledger.length) {
        const lh = G.lh, rows = Math.ceil(H / lh) + 2, base = Math.floor(scroll / lh), off = scroll % lh;
        for (let r = 0; r < rows; r++) {
          const y = r * lh - off;
          const L = ledger[(base + r) % ledger.length];
          const dy = y - cy; if (Math.abs(dy) >= rin) continue;
          const x0 = cx + Math.sqrt(rin * rin - dy * dy) + 7;
          ctx.font = `${L.w ? 600 : 400} ${G.font}px "IBM Plex Mono", ui-monospace, monospace`;
          ctx.fillStyle = L.w === 2 ? colors.accent : L.w === 1 ? colors.ink : colors.ink2;
          ctx.fillText(L.t, x0, y + lh / 2);
        }
      } else {
        ctx.font = `600 ${G.font + 1}px "IBM Plex Mono", ui-monospace, monospace`; ctx.fillStyle = colors.muted;
        const msg = ["LEDGER EMPTY", "NO HYPOTHESES OR", "AGENT ACTIONS YET"];
        msg.forEach((m, k) => ctx.fillText(m, cx + rin + 12, cy - 12 + k * 13));
      }
      ctx.restore();

      // outer ticks: hypothesis index in stream order
      if (N > 1) {
        const step = niceStep(N / 24), big = step * 5;
        ctx.save(); ctx.strokeStyle = colors.ink2; ctx.fillStyle = colors.muted; ctx.lineWidth = 0.8;
        ctx.font = `400 ${Math.max(7, G.font - 0.5)}px "IBM Plex Mono", ui-monospace, monospace`; ctx.textBaseline = "middle";
        for (let i = 0; i < N; i += step) {
          const th = angleOf(i), co = Math.cos(th), si = Math.sin(th), len = i % big === 0 ? 6 : 3;
          ctx.beginPath(); ctx.moveTo(cx + (rout - len) * co, cy + (rout - len) * si); ctx.lineTo(cx + rout * co, cy + rout * si); ctx.stroke();
          if (i % big === 0) {
            ctx.save(); ctx.translate(cx + (rout - 8) * co, cy + (rout - 8) * si); ctx.rotate(th); ctx.textAlign = "right";
            ctx.fillText(i ? i.toLocaleString("en-US") : "1", 0, 0); ctx.restore();
          }
        }
        ctx.restore();
      }
    }
    function niceStep(x) { const e = Math.pow(10, Math.floor(Math.log10(Math.max(1, x)))); const m = x / e; return Math.max(1, (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * e); }

    function drawScale() {
      // a radial −log10 p scale along the lower edge of the spectrum
      if (!tested.length) {
        ctx.save(); ctx.font = `600 ${G.font + 1}px "IBM Plex Mono", ui-monospace, monospace`; ctx.fillStyle = colors.muted; ctx.textBaseline = "middle";
        ctx.fillText("NO TESTED HYPOTHESES YET", G.cx + G.r0 + 16, G.cy); ctx.restore();
        return;
      }
      const th = G.t1 + (G.tmax - G.t1) * 0.5, co = Math.cos(th), si = Math.sin(th);
      ctx.save(); ctx.strokeStyle = colors.muted; ctx.fillStyle = colors.muted; ctx.lineWidth = 0.8;
      ctx.font = `400 ${Math.max(7, G.font - 0.5)}px "IBM Plex Mono", ui-monospace, monospace`; ctx.textBaseline = "top";
      const tstep = P > 10 ? 5 : P > 6 ? 2 : 1;
      for (let v = 0; v <= P + 1e-9; v += tstep) {
        const r = G.r0 + (G.L * v) / P, px = G.cx + r * co, py = G.cy + r * si;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - si * 4, py + co * 4); ctx.stroke();
        ctx.save(); ctx.translate(px - si * 6, py + co * 6); ctx.rotate(th); ctx.textAlign = "center"; ctx.fillText(String(v), 0, 0); ctx.restore();
      }
      ctx.save(); const rr = G.r0 + G.L * 0.5; ctx.translate(G.cx + rr * co - si * 16, G.cy + rr * si + co * 16); ctx.rotate(th); ctx.textAlign = "center";
      ctx.fillText("−LOG10 P", 0, 0); ctx.restore();
      ctx.restore();
    }

    function drawHover() {
      if (hover < 0) return;
      const s = stream[hover], [ax, ay, bx, by] = rayEnds(hover);
      ctx.save(); ctx.strokeStyle = s.gate === "published" ? colors.accent : colors.ink; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.fillStyle = colors.surface; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(bx, by, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    function frame(ts) {
      running = false;
      const dt = Math.min(64, ts - (last || ts)); last = ts;
      if (fieldDone < order.length) { const n = Math.max(40, Math.ceil(order.length / 70)); paintField(fieldDone, Math.min(order.length, fieldDone + n)); fieldDone = Math.min(order.length, fieldDone + n); }
      if (specDone < tested.length) { const n = Math.max(20, Math.ceil(tested.length / 70)); paintSpec(specDone, Math.min(tested.length, specDone + n)); specDone = Math.min(tested.length, specDone + n); }
      if (!reduceMotion) scroll += dt * 0.012;
      draw();
      if (!reduceMotion && visible && !document.hidden) { running = true; requestAnimationFrame(frame); }
    }
    function draw() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(fieldLayer.c, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawRing();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(specLayer.c, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawThreshold(specDone >= tested.length ? N : tested.length ? tested[Math.max(0, specDone - 1)] + 1 : 0);
      drawScale();
      drawHover();
    }
    const kick = () => { if (!running) { running = true; last = 0; requestAnimationFrame(frame); } };

    // hover / tap on rays
    function pick(ev) {
      if (!tested.length) return -1;
      const r = cv.getBoundingClientRect(), px = ev.clientX - r.left, py = ev.clientY - r.top;
      const dx = px - G.cx, dy = py - G.cy, rad = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
      if (rad < G.rout || rad > G.r0 + G.L + 12 || th < G.t0 - 0.02 || th > G.t1 + 0.02) return -1;
      const fi = N <= 1 ? 0 : ((th - G.t0) / (G.t1 - G.t0)) * (N - 1);
      const win = Math.max(1, Math.ceil((N - 1) / ((G.t1 - G.t0) * rad) * 3)); // about 3px of arc
      let best = -1, bestScore = Infinity;
      for (let i = Math.max(0, Math.floor(fi - win)); i <= Math.min(N - 1, Math.ceil(fi + win)); i++) {
        const s = stream[i]; if (s.neg_log10_p == null) continue;
        const r1 = G.r0 + (G.L * Math.min(P, s.neg_log10_p)) / P;
        const along = rad > r1 + 10 ? (rad - r1) : 0;
        const score = Math.abs(i - fi) / win + along / 20 - (passedDiscovery(s) ? 0.5 : 0);
        if (score < bestScore) { bestScore = score; best = i; }
      }
      return bestScore < 2.5 ? best : -1;
    }
    function onMove(ev) {
      const i = pick(ev);
      if (i !== hover) { hover = i; if (reduceMotion || !running) draw(); }
      if (i >= 0) showTip(streamLines(stream[i], i), ev); else hideTip();
    }
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerdown", onMove);
    cv.addEventListener("pointerleave", () => { hover = -1; hideTip(); draw(); });

    resize(); readColors();
    if (reduceMotion) { fieldLayer = layer(); specLayer = layer(); paintField(0, order.length); paintSpec(0, tested.length); }
    draw();
    if (!reduceMotion) kick();
    let rt;
    addEventListener("resize", () => {
      clearTimeout(rt);
      rt = setTimeout(() => { const w = Math.round(cv.getBoundingClientRect().width); if (w === W) return; resize(); if (reduceMotion) draw(); else kick(); }, 120);
    });
    const recolor = () => { readColors(); fieldLayer = layer(); specLayer = layer(); fieldDone = order.length; specDone = tested.length; paintField(0, order.length); paintSpec(0, tested.length); draw(); };
    matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", recolor);
    new MutationObserver(recolor).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    if ("IntersectionObserver" in window) new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible && !reduceMotion) kick(); }).observe(cv);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && !reduceMotion) kick(); });
  }

  /* ================= PANELS ================= */
  function panelFeed(feed) {
    const acts = feed.activitySorted.slice().reverse();
    $("#p-feed-n").textContent = acts.length ? `${acts.length} recent` : "";
    if (!acts.length) return fill($("#p-feed"), none("No agent actions logged yet. The newest action will appear at the top."));
    fill($("#p-feed"),
      h("ul", { class: "feed", tabindex: "0", "aria-label": "Agent actions, newest first" },
        acts.map((a) => h("li", null,
          h("span", { class: "seq", text: String(a.seq).padStart(4, "0") }),
          h("span", { class: "verb", text: a.verb }),
          h("span", { text: a.object, title: a.agent }),
          h("span", { class: `out ${a.outcome || ""}`, text: a.outcome || "—" })))),
      h("div", { class: "note", text: "seq · verb · object · outcome" }));
  }

  function panelIntake(feed) {
    const host = $("#p-intake"), rows = feed.intake;
    const months = [...new Set(rows.map((r) => r.month))].sort().slice(-12);
    $("#p-intake-n").textContent = months.length ? `${fmtMonth(months[0])}–${fmtMonth(months[months.length - 1])}` : "";
    if (!months.length) return fill(host, none("No papers screened yet. Monthly counts by source will appear here; counts under 11 show as <11."));
    const cell = new Map(rows.map((r) => [r.source + "|" + r.month, r]));
    const sources = SOURCES.filter((s) => rows.some((r) => r.source === s));
    const max = Math.max(11, ...rows.map((r) => r.screened || 0));
    const W = 320, lab = 54, rowH = 30, top = 4, H = top + rowH * sources.length + 16;
    const cw = (W - lab) / months.length;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Papers screened and judged relevant, by source and month" });
    sources.forEach((src, si) => {
      const y0 = top + si * rowH, base = y0 + rowH - 6;
      svgText(svg, { x: 0, y: base - 2, fill: "var(--ink-2)", style: "font:500 9.5px var(--font-mono)" }, src);
      el("line", { x1: lab, x2: W, y1: base + 0.5, y2: base + 0.5, stroke: "var(--line)", "stroke-width": 1 }, svg);
      months.forEach((m, mi) => {
        const r = cell.get(src + "|" + m), x = lab + mi * cw + 1, w = Math.max(2, cw - 2), hMax = rowH - 9;
        if (!r) return;
        if (r.screened == null) {
          svgText(svg, { x: x + w / 2, y: base - 2, "text-anchor": "middle", fill: "var(--muted)", style: "font:400 7.5px var(--font-mono)" }, "<11");
        } else {
          const hs = Math.max(1, (hMax * r.screened) / max);
          el("rect", { x, y: base - hs, width: w, height: hs, fill: "var(--faint)" }, svg);
          if (r.relevant != null) { const hr = Math.max(1, (hMax * r.relevant) / max); el("rect", { x: x + w * 0.2, y: base - hr, width: w * 0.6, height: hr, fill: "var(--ink)" }, svg); }
        }
        const hit = el("rect", { x: x - 1, y: y0, width: cw, height: rowH, fill: "transparent" }, svg);
        hit.addEventListener("pointermove", (ev) => showTip([`${src} · ${fmtMonth(m)}`, `screened: ${r.screened == null ? "<11" : num(r.screened)}`, `relevant: ${r.relevant == null ? "<11" : num(r.relevant)}`], ev));
        hit.addEventListener("pointerleave", hideTip);
      });
    });
    [0, months.length - 1].forEach((mi, k) => svgText(svg, { x: lab + mi * cw + (k ? cw - 1 : 1), y: H - 3, "text-anchor": k ? "end" : "start", fill: "var(--muted)", style: "font:400 8.5px var(--font-mono)" }, months[mi]));
    fill(host,
      h("div", { class: "legend-row" }, h("span", null, h("i", { style: "background:var(--faint)" }), "screened"), h("span", null, h("i", { style: "background:var(--ink)" }), "relevant"), h("span", { text: `bar height max ${num(max)}` })),
      svg,
      h("div", { class: "note", text: `${num(feed.literature_pipeline.intake)} screened in total. Cells under 11 papers show <11.` }));
  }

  function panelWork(feed) {
    const lits = feed.literature;
    $("#p-work-n").textContent = lits.length ? `${lits.length} approved` : "";
    if (!lits.length) return fill($("#p-work"), none("No papers approved yet. Each approved paper will show its verdict, the Waymark programs it bears on, and its local test."));
    fill($("#p-work"),
      h("ul", { class: "work", tabindex: "0", "aria-label": "Approved papers: verdict, programs, local test" },
        lits.map((l, i) => h("li", { title: `${l.id}: ${l.verdict} → ${l.programs.join(", ") || "no program"} → ${l.local_test}` },
          h("span", { class: "n", text: String(i + 1).padStart(3, "0") }),
          h("a", { href: "#" + l.id, text: l.id }), " ",
          h("b", { text: l.verdict }), " → ", (l.programs.join(",") || "—"), " → ",
          h("span", { class: l.local_test === "replicated_locally" ? "ok" : "", text: l.local_test })))),
      h("div", { class: "note", text: "id · verdict → programs → local test" }));
  }

  function panelAlpha(feed) {
    const host = $("#p-alpha"), s = feed.stream;
    const idx = []; s.forEach((e, i) => { if (e.neg_log10_alpha != null || e.neg_log10_p != null) idx.push(i); });
    if (!idx.length) return fill(host, none("No tests run yet. The line will show the LORD++ test level for each hypothesis in order, with each p-value as a dot."));
    const cv = h("canvas", { role: "img", "aria-label": "LORD++ threshold and p-values in stream order" });
    let cross = 0, maxA = 0; const ps = [];
    for (const i of idx) { const e = s[i]; if (e.neg_log10_alpha != null) maxA = Math.max(maxA, e.neg_log10_alpha); if (e.neg_log10_p != null) { ps.push(e.neg_log10_p); if (e.neg_log10_alpha != null && e.neg_log10_p >= e.neg_log10_alpha) cross++; } }
    ps.sort((a, b) => a - b);
    const q = ps.length ? ps[Math.floor(ps.length * 0.995)] || ps[ps.length - 1] : 0;
    const ymax = Math.min(20, Math.ceil(Math.max(maxA + 1, q, 3)));
    fill(host, cv,
      h("div", { class: "legend-row" },
        h("span", null, h("i", { style: "background:var(--ink);height:2px;vertical-align:3px" }), "−log10 α"),
        h("span", null, h("i", { style: "background:var(--faint);width:5px;height:5px" }), "−log10 p"),
        h("span", null, h("i", { style: "background:var(--ink);width:2px" }), `crossed: ${num(cross)}`)),
      h("div", { class: "note", text: `Higher is stricter. A dot above the line passed discovery. Values above ${ymax} pin to the top edge.` }));
    const ctx = cv.getContext("2d"), N = s.length;
    let W, H, m = { l: 22, r: 4, t: 8, b: 16 };
    function draw() {
      const dpr = Math.min(2, devicePixelRatio || 1);
      W = Math.max(200, cv.getBoundingClientRect().width); H = 150;
      cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + "px"; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const X = (i) => m.l + ((W - m.l - m.r) * i) / Math.max(1, N - 1), Y = (v) => m.t + ((H - m.t - m.b) * (ymax - Math.min(ymax, v))) / ymax;
      const c = { ink: css("--ink"), faint: css("--faint"), line: css("--line"), muted: css("--muted"), accent: css("--accent") };
      ctx.clearRect(0, 0, W, H);
      ctx.font = `400 8.5px "IBM Plex Mono", monospace`; ctx.fillStyle = c.muted; ctx.textBaseline = "middle"; ctx.textAlign = "right";
      const st = ymax > 10 ? 5 : ymax > 5 ? 2 : 1;
      for (let v = 0; v <= ymax; v += st) { ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(m.l, Y(v) + 0.5); ctx.lineTo(W - m.r, Y(v) + 0.5); ctx.stroke(); ctx.fillText(String(v), m.l - 4, Y(v)); }
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillText("1", m.l, H - 3); ctx.textAlign = "right"; ctx.fillText(N.toLocaleString("en-US"), W - m.r, H - 3);
      const ds = N > 4000 ? 1.2 : N > 800 ? 1.8 : 2.6;
      ctx.globalAlpha = N > 4000 ? 0.45 : 0.75; ctx.fillStyle = c.faint;
      for (const i of idx) { const v = s[i].neg_log10_p; if (v != null) ctx.fillRect(X(i) - ds / 2, Y(v) - ds / 2, ds, ds); }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = c.ink; ctx.lineWidth = 1.25; ctx.beginPath(); let pen = false;
      for (const i of idx) { const a = s[i].neg_log10_alpha; if (a == null) { pen = false; continue; } if (pen) ctx.lineTo(X(i), Y(a)); else { ctx.moveTo(X(i), Y(a)); pen = true; } }
      ctx.stroke();
      for (const i of idx) {
        const e = s[i]; if (e.neg_log10_p == null || e.neg_log10_alpha == null || e.neg_log10_p < e.neg_log10_alpha) continue;
        const col = e.gate === "published" ? c.accent : c.ink;
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(i), Y(e.neg_log10_p), 2.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(X(i) - 0.6, H - m.b - 5, 1.2, 5);
      }
    }
    draw();
    cv.addEventListener("pointermove", (ev) => {
      const r = cv.getBoundingClientRect(), fi = ((ev.clientX - r.left - m.l) / (W - m.l - m.r)) * (N - 1);
      let best = -1, bd = Infinity;
      const win = Math.max(2, N / (W - m.l - m.r) * 4);
      for (let i = Math.max(0, Math.floor(fi - win)); i <= Math.min(N - 1, Math.ceil(fi + win)); i++) {
        const e = s[i]; if (e.neg_log10_p == null) continue;
        const d = Math.abs(i - fi) - (e.neg_log10_alpha != null && e.neg_log10_p >= e.neg_log10_alpha ? win : 0);
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0) showTip(streamLines(s[best], best), ev); else hideTip();
    });
    cv.addEventListener("pointerleave", hideTip);
    let t; addEventListener("resize", () => { clearTimeout(t); t = setTimeout(draw, 150); });
    new MutationObserver(draw).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", draw);
  }

  function panelFunnel(feed) {
    const p = feed.pipeline, lp = feed.literature_pipeline;
    const internal = [["proposed", p.proposed], ["tested", p.tested], ["passed discovery", p.passed_discovery], ["replicated", p.replicated], ["passed controls", p.passed_controls], ["approved", p.approved], ["published", p.published]];
    const lit = [["intake", lp.intake], ["relevant", lp.relevant], ["identity verified", lp.identity_verified], ["appraised", lp.appraised], ["applies or watch", lp.applies], ["corroborated", lp.corroborated],
      ["skeptic passed", lp.skeptic_passed], ["translated", lp.translated], ["tested locally", lp.tested_locally], ["replicated locally", lp.replicated_locally], ["approved", lp.approved], ["published", lp.published]];
    const rows = (list) => { const max = Math.max(1, list[0][1]); return list.map(([k, v], i) => h("div", { class: "frow" + (k === "published" ? " pub" : ""), title: `${k}: ${num(v)}` },
      h("span", { class: "lab", text: k }), h("span", { class: "bar" }, h("i", { style: `width:${v ? Math.max(0.6, (100 * v) / max).toFixed(2) : 0}%` })), h("span", { class: "n", text: num(v) }))); };
    fill($("#p-funnel"), h("div", { class: "funnel" }, h("div", { class: "grp", text: "Internal hypotheses" }), rows(internal), h("div", { class: "grp", text: "Literature" }), rows(lit)),
      h("div", { class: "note", text: "Bars are relative to the first stage of each funnel." }));
  }

  function panelAgents(feed) {
    const lastBy = new Map(), count = new Map();
    for (const a of feed.activitySorted) { lastBy.set(a.agent, a); count.set(a.agent, (count.get(a.agent) || 0) + 1); }
    const max = Math.max(1, ...count.values());
    $("#p-agents-n").textContent = `${lastBy.size} of ${AGENTS.length} active`;
    fill($("#p-agents"), h("div", { class: "agents" }, AGENTS.map((ag, i) => {
      const a = lastBy.get(ag), n = count.get(ag) || 0;
      return h("div", { class: "agent" + (a ? "" : " idle"), title: a ? `${ag}: last ${a.verb} ${a.object} (${a.outcome || "no outcome"}), ${n} actions in log` : `${ag}: no actions in log` },
        h("span", { class: "ix", text: String(i + 1).padStart(2, "0") }),
        h("span", { class: "nm" }, h("span", { text: ag }), h("small", { text: n ? `×${n}` : "" })),
        h("span", { class: "last" }, a ? [`${a.verb} ${a.object} `, h("span", { class: a.outcome === "pass" ? "pass" : "", text: a.outcome || "" })] : "idle"),
        h("span", { class: "meter" }, h("i", { style: `width:${((100 * n) / max).toFixed(1)}%` })));
    })), h("div", { class: "note", text: "Last action per agent; bar = actions in the recent log." }));
  }

  function publishedReplications(feed) {
    const reps = feed.publications.filter((p) => p.replicated && p.replication);
    if (!reps.length) return null;
    return h("div", { class: "reprows" },
      h("div", { class: "eyebrow", text: "Published replications · reported estimate (95% CI)" }),
      reps.map((p) => h("div", { class: "reprow" },
        h("a", { href: p.doi ? doiUrl(p.doi) : pmUrl(p.pmid), target: "_blank", rel: "noopener", class: "rv", text: `${p.venue.split(":")[0].trim()}, ${p.year}` }),
        h("div", { class: "rm", text: p.replication.metric }),
        h("div", { class: "rh", text: p.replication.how }))));
  }

  function panelReplication(feed) {
    const host = $("#p-rep"), fs = feed.findings;
    const pub = publishedReplications(feed);
    if (!fs.length) return fill(host, pub || none("No replicated findings yet. Each will show its effect estimate and 95% confidence interval here."),
      pub ? h("div", { class: "note", text: "Estimates quoted from each paper's abstract, on the paper's own scale. Agent findings will be plotted here on a ratio scale once approved." }) : null);
    const rows = fs.map((f) => f.effect);
    const W = 320, rowH = 18, m = { l: 52, r: 40, t: 4, b: 18 }, H = m.t + m.b + rowH * rows.length;
    const ext = rows.flatMap((r) => [r.ci_low, r.ci_high]).concat([1]);
    const lo = Math.log(Math.min(...ext) * 0.9), hi = Math.log(Math.max(...ext) * 1.1);
    const X = (v) => m.l + ((W - m.l - m.r) * (Math.log(v) - lo)) / (hi - lo);
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Effect estimates with 95% confidence intervals for approved findings" });
    for (const t of [0.25, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3, 4].filter((t) => Math.log(t) >= lo && Math.log(t) <= hi)) {
      el("line", { x1: X(t), x2: X(t), y1: m.t, y2: H - m.b, stroke: t === 1 ? "var(--ink-2)" : "var(--line)", "stroke-width": 1 }, svg);
      svgText(svg, { x: X(t), y: H - 5, "text-anchor": "middle", fill: "var(--muted)", style: "font:400 8.5px var(--font-mono)" }, t + "×");
    }
    fs.forEach((f, i) => {
      const e = f.effect, y = m.t + rowH * (i + 0.5);
      const a = el("a", { href: "#" + f.id }, svg);
      svgText(a, { x: 0, y: y + 3, fill: "var(--ink)", style: "font:500 9.5px var(--font-mono)" }, f.id);
      el("line", { x1: X(e.ci_low), x2: X(e.ci_high), y1: y, y2: y, stroke: "var(--ink)", "stroke-width": 1.5 }, svg);
      el("rect", { x: X(e.estimate) - 3, y: y - 3, width: 6, height: 6, fill: "var(--ink)" }, svg);
      svgText(svg, { x: W, y: y + 3, "text-anchor": "end", fill: "var(--ink-2)", style: "font:400 9px var(--font-mono)" }, e.estimate.toFixed(2) + "×");
      const hit = el("rect", { x: m.l, y: y - rowH / 2, width: W - m.l, height: rowH, fill: "transparent" }, svg);
      hit.addEventListener("pointermove", (ev) => showTip([f.id, f.title, `${e.measure}: ${x2(e.estimate)} (95% CI ${x2(e.ci_low)}–${x2(e.ci_high)})`], ev));
      hit.addEventListener("pointerleave", hideTip);
    });
    fill(host, svg, h("div", { class: "note", text: "Adjusted effect per approved agent finding. 1.0× means no difference." }), pub);
  }

  function panelMatrix(feed) {
    const host = $("#p-matrix"), s = feed.stream;
    const tmpl = Object.keys(TEMPLATES);
    const counts = {}; const rowsK = [...TAG_KEYS, "untagged"];
    for (const r of rowsK) counts[r] = Object.fromEntries(tmpl.map((t) => [t, 0]));
    for (const e of s) { const tags = e.tags.length ? e.tags : ["untagged"]; for (const t of tags) if (counts[t] && e.template in counts[t]) counts[t][e.template]++; }
    const max = Math.max(1, ...rowsK.flatMap((r) => tmpl.map((t) => counts[r][t])));
    const shade = (v) => { const f = v / max; return v ? `background:color-mix(in srgb, var(--ink) ${(6 + 66 * f).toFixed(0)}%, var(--surface))` : "background:var(--surface)"; };
    const short = { cyclic_window_interaction: "cyclic", cyclic_window_single: "single", stratified_rate_ratio: "strat." };
    const tbl = h("table", { class: "matrix" },
      h("colgroup", null, h("col", { class: "c1" }), ...tmpl.map(() => h("col")), h("col")),
      h("thead", null, h("tr", null, h("th", { text: "tag" }), ...tmpl.map((t) => h("th", { text: short[t] || t })), h("th", { text: "all" }))),
      h("tbody", null, rowsK.map((r) => {
        const vals = tmpl.map((t) => counts[r][t]);
        return h("tr", null, h("th", { text: r }),
          ...tmpl.map((t, i) => h("td", { style: shade(vals[i]), class: vals[i] / max > 0.6 ? "hi" : "", title: `${r} × ${t}: ${vals[i]}`, text: num(vals[i]) })),
          h("td", { text: num(vals.reduce((x, y) => x + y, 0)) }));
      })));
    fill(host, s.length ? tbl : none("No hypotheses yet. Counts of hypotheses by analysis template and topic tag will appear here."),
      s.length ? h("div", { class: "note", text: "Hypotheses with several tags count once per tag. Darker = more." }) : null);
  }

  /* ================= GATES ================= */
  function renderGates(feed) {
    const p = feed.pipeline, max = Math.max(1, p.proposed);
    const g = [
      ["Proposed", "by the hypothesis agent", p.proposed],
      ["Tested", "enough events to analyze", p.tested],
      ["Passed online FDR", `discovery half, ${p.fdr_method}`, p.passed_discovery],
      ["Replicated", "held-out half of members", p.replicated],
      ["Passed controls", "negative control and skeptic agent", p.passed_controls],
      ["Clinician-approved", "signed off for publication", p.approved],
      ["Published", "on this page", p.published],
    ];
    fill($("#gate-list"), g.map(([name, sub, n]) => h("div", { class: "gate" + (name === "Published" ? " pub" : "") },
      h("div", { class: "name" }, name, h("small", { text: sub })),
      h("div", { class: "bar", "aria-hidden": "true" }, h("i", { style: `width:${n ? Math.max(0.5, (100 * n) / max) : 0}%` })),
      h("div", { class: "n", text: num(n) }))));
    const pubs = feed.publications, pmax = Math.max(1, pubs.length);
    const pg = [
      ["Papers by Waymark", "author affiliation on the registry record", pubs.length],
      ["Peer reviewed", "published in a journal", pubs.filter((x) => x.peer_reviewed).length],
      ["Featured findings", "non-intuitive results, clinician-approved", feed.published_findings.length],
      ["Replicated", "validated on held-out, external or prospective data", pubs.filter((x) => x.replicated).length],
    ];
    fill($("#pub-gate-list"), pg.map(([name, sub, n], i) => h("div", { class: "gate" + (i === 2 ? " pub" : "") },
      h("div", { class: "name" }, name, h("small", { text: sub })),
      h("div", { class: "bar", "aria-hidden": "true" }, h("i", { style: `width:${n ? Math.max(0.5, (100 * n) / pmax) : 0}%` })),
      h("div", { class: "n", text: num(n) }))));
    const rejected = p.tested ? Math.round((100 * (p.tested - p.passed_controls)) / p.tested) : null;
    fill($("#gate-foot"), p.tested
      ? [h("div", null, h("b", { text: `${rejected}%` }), "of tested hypotheses rejected"),
         h("div", null, h("b", { text: `${p.passed_controls ? Math.round(p.tested / p.passed_controls) : "—"} : 1` }), "tested per surviving candidate"),
         h("div", null, h("b", { text: "0" }), "member records on this page")]
      : h("div", null, h("b", { text: "0" }), "hypotheses tested so far. Counts update after each agent run."));
  }

  /* ================= FINDINGS (existing chart renderers) ================= */
  const CHECK = () => { const s = el("svg", { width: 14, height: 14, viewBox: "0 0 14 14", "aria-hidden": "true" }); el("circle", { cx: 7, cy: 7, r: 7, fill: "var(--accent)" }, s); el("path", { d: "M4 7.2l2 2 4-4.4", stroke: "var(--surface)", "stroke-width": 1.8, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" }, s); return s; };
  const DASH = () => { const s = el("svg", { width: 14, height: 14, viewBox: "0 0 14 14", "aria-hidden": "true" }); el("circle", { cx: 7, cy: 7, r: 6.25, fill: "none", stroke: "var(--muted)", "stroke-width": 1.5 }, s); el("path", { d: "M4.5 7h5", stroke: "var(--muted)", "stroke-width": 1.6, "stroke-linecap": "round" }, s); return s; };

  function effectBlock(f) {
    const hd = f.headline;
    if (hd.measure === "late_vs_early_rate_ratio") {
      const w = f.chart;
      return h("div", { class: "effect" }, h("b", { text: `${x2(hd.estimate)}×` }),
        h("span", null, `rate on days ${w.late_window} vs days ${w.early_window}`, h("br"), `95% CI ${x2(hd.ci_low)}–${x2(hd.ci_high)} · others ${x2(hd.reference_estimate)}×`));
    }
    return h("div", { class: "effect" }, h("b", { text: `${x2(hd.estimate)}×` }),
      h("span", null, `rate ratio, adjusted for ${f.chart.adjust === "age_band" ? "age band" : "state"}`, h("br"), `95% CI ${x2(hd.ci_low)}–${x2(hd.ci_high)}`));
  }
  function checksBlock(f, alpha, method) {
    const e = f.evidence;
    const nc = e.negative_control === "passed" ? [CHECK(), `Negative control (${e.negative_control_outcome || "unrelated outcome"}) showed no pattern`]
      : e.negative_control === "inconclusive" ? [DASH(), `Negative control inconclusive: too few ${e.negative_control_outcome || ""} events`]
      : [DASH(), "No negative control specified"];
    const rows = [[CHECK(), `Passed online FDR control (${method}, α = ${alpha})`], [CHECK(), "Replicated on a held-out half of members"], nc, [CHECK(), "Reviewed and approved by a Waymark clinician"]];
    return h("ul", { class: "checks" }, rows.map(([i, t]) => h("li", null, i, h("span", { text: t }))));
  }
  function detailsBlock(f) {
    const parts = [];
    if (f.why_surprising) parts.push(h("h4", { text: "Why it isn't obvious" }), h("p", { text: f.why_surprising }));
    if (f.action_taken) parts.push(h("h4", { text: "What we changed" }), h("p", { text: f.action_taken }));
    if (f.evidence.skeptic_concerns.length) parts.push(h("h4", { text: "Open questions from the skeptic agent" }), h("ul", null, f.evidence.skeptic_concerns.map((c) => h("li", { text: c }))));
    parts.push(h("h4", { text: "Population" }), h("p", { text: `${f.population_label}, ${f.population} members` }));
    return h("details", { class: "more" }, h("summary", { text: "How we read this" }), parts);
  }

  function dayOfMonthChart(host, f) {
    const c = f.chart, n = c.bins.length;
    const W = 520, H = 250, m = { l: 44, r: 16, t: 14, b: 38 };
    const vals = [...c.exposed, ...c.reference].filter((v) => v != null);
    const lo = Math.min(0.5, Math.floor((Math.min(...vals) - 0.05) * 4) / 4);
    const hi = Math.max(1.5, Math.ceil((Math.max(...vals) + 0.05) * 4) / 4);
    const X = (i) => m.l + ((W - m.l - m.r) * (i + 0.5)) / n;
    const Y = (v) => m.t + ((H - m.t - m.b) * (hi - v)) / (hi - lo);
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Day-of-month rate pattern for ${c.exposed_label} versus ${c.reference_label}` });
    const [llo, lhi] = c.late_window.split("–").map(Number);
    const binLo = (b) => +b.split("–")[0];
    const inLate = c.bins.map((b) => binLo(b) >= llo && binLo(b) <= lhi);
    const first = inLate.indexOf(true), last = inLate.lastIndexOf(true);
    if (first >= 0) {
      const bw = (W - m.l - m.r) / n;
      el("rect", { x: X(first) - bw / 2, y: m.t, width: bw * (last - first + 1), height: H - m.t - m.b, fill: "var(--wash)" }, svg);
      svgText(svg, { x: X(first) - bw / 2 + 6, y: m.t + 14, fill: "var(--ink-2)", style: "font:500 11px var(--font-mono)" }, `Days ${c.late_window}`);
    }
    for (let v = Math.ceil(lo * 2) / 2; v <= hi + 1e-9; v += 0.5) {
      el("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: v === 1 ? "var(--rule)" : "var(--line)", "stroke-width": 1 }, svg);
      svgText(svg, { x: m.l - 8, y: Y(v) + 4, "text-anchor": "end", fill: "var(--muted)", style: "font:11px var(--font-mono)" }, v.toFixed(1) + "×");
    }
    c.bins.forEach((b, i) => { if (i % 2 && n > 6) return; svgText(svg, { x: X(i), y: H - m.b + 18, "text-anchor": "middle", fill: "var(--muted)", style: "font:11px var(--font-mono)" }, b); });
    svgText(svg, { x: W - m.r, y: H - 4, "text-anchor": "end", fill: "var(--muted)", style: "font:11px var(--font-body)" }, "Day of month");
    for (const [vs, col] of [[c.reference, "var(--ref)"], [c.exposed, "var(--series)"]]) {
      let d = "", pen = false;
      vs.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${X(i)},${Y(v)}`; pen = true; });
      el("path", { d, fill: "none", stroke: col, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
      vs.forEach((v, i) => { if (v != null) el("circle", { cx: X(i), cy: Y(v), r: 4, fill: col, stroke: "var(--surface)", "stroke-width": 2 }, svg); });
    }
    const li = c.exposed.length - 1;
    if (c.exposed[li] != null) svgText(svg, { x: X(li) - 8, y: Y(c.exposed[li]) - 10, "text-anchor": "end", fill: "var(--ink)", style: "font:600 12px var(--font-mono)" }, c.exposed[li].toFixed(2) + "×");
    const guide = el("line", { y1: m.t, y2: H - m.b, stroke: "var(--muted)", "stroke-width": 1, opacity: 0 }, svg);
    c.bins.forEach((b, i) => {
      const bw = (W - m.l - m.r) / n;
      const hit = el("rect", { x: X(i) - bw / 2, y: m.t, width: bw, height: H - m.t - m.b, fill: "transparent" }, svg);
      hit.addEventListener("pointermove", (ev) => {
        guide.setAttribute("x1", X(i)); guide.setAttribute("x2", X(i)); guide.setAttribute("opacity", 0.5);
        showTip([`Days ${b}`, `${c.exposed_label}: ${c.exposed[i] == null ? "suppressed" : c.exposed[i].toFixed(2) + "× average"}`, `${c.reference_label}: ${c.reference[i] == null ? "suppressed" : c.reference[i].toFixed(2) + "× average"}`], ev);
      });
      hit.addEventListener("pointerleave", () => { guide.setAttribute("opacity", 0); hideTip(); });
    });
    fill(host,
      h("div", { class: "legend" }, h("span", null, h("i", { style: "background:var(--series)" }), c.exposed_label), h("span", null, h("i", { style: "background:var(--ref)" }), c.reference_label)),
      svg, h("div", { class: "note", text: "Event rate in each 3-day window, relative to that group's own monthly average (1.0×)." }));
  }

  function forestChart(host, f) {
    const rows = [...f.chart.strata.map((s) => ({ ...s, pooled: false })),
      { label: "All (adjusted)", estimate: f.effect.estimate, ci_low: f.effect.ci_low, ci_high: f.effect.ci_high, pooled: true }];
    const W = 520, rowH = 30, m = { l: 112, r: 70, t: 10, b: 34 }, H = m.t + m.b + rowH * rows.length;
    const ext = rows.filter((r) => r.estimate != null).flatMap((r) => [r.ci_low, r.ci_high]).filter((v) => v != null).concat([1]);
    const ticks = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];
    const lo = Math.log(Math.min(...ext) * 0.9), hi = Math.log(Math.max(...ext) * 1.1);
    const X = (v) => m.l + ((W - m.l - m.r) * (Math.log(v) - lo)) / (hi - lo);
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Rate ratio by stratum with 95% confidence intervals" });
    for (const t of ticks.filter((t) => Math.log(t) >= lo && Math.log(t) <= hi)) {
      el("line", { x1: X(t), x2: X(t), y1: m.t, y2: H - m.b, stroke: t === 1 ? "var(--rule)" : "var(--line)", "stroke-width": t === 1 ? 1.5 : 1 }, svg);
      svgText(svg, { x: X(t), y: H - m.b + 18, "text-anchor": "middle", fill: "var(--muted)", style: "font:11px var(--font-mono)" }, t + "×");
    }
    rows.forEach((r, i) => {
      const y = m.t + rowH * (i + 0.5);
      if (r.pooled) el("line", { x1: 0, x2: W, y1: y - rowH / 2, y2: y - rowH / 2, stroke: "var(--line)" }, svg);
      svgText(svg, { x: 0, y: y + 4, fill: r.pooled ? "var(--ink)" : "var(--ink-2)", style: `font:${r.pooled ? 600 : 400} 12px var(--font-body)` }, r.label);
      if (r.estimate == null || r.ci_low == null || r.ci_high == null) {
        svgText(svg, { x: m.l, y: y + 4, fill: "var(--muted)", style: "font:italic 12px var(--font-body)" }, "suppressed (fewer than 11 events)");
        return;
      }
      el("line", { x1: X(r.ci_low), x2: X(r.ci_high), y1: y, y2: y, stroke: "var(--series)", "stroke-width": 2, "stroke-linecap": "round" }, svg);
      if (r.pooled) el("path", { d: `M${X(r.estimate)},${y - 7}l7,7l-7,7l-7,-7z`, fill: "var(--series)", stroke: "var(--surface)", "stroke-width": 2 }, svg);
      else el("circle", { cx: X(r.estimate), cy: y, r: 5, fill: "var(--series)", stroke: "var(--surface)", "stroke-width": 2 }, svg);
      svgText(svg, { x: W, y: y + 4, "text-anchor": "end", fill: r.pooled ? "var(--ink)" : "var(--ink-2)", style: `font:${r.pooled ? 600 : 400} 12px var(--font-mono)` }, r.estimate.toFixed(2) + "×");
      const hit = el("rect", { x: 0, y: y - rowH / 2, width: W, height: rowH, fill: "transparent" }, svg);
      hit.addEventListener("pointermove", (ev) => showTip([r.label, `${r.estimate.toFixed(2)}× (95% CI ${r.ci_low.toFixed(2)}–${r.ci_high.toFixed(2)})`], ev));
      hit.addEventListener("pointerleave", hideTip);
    });
    fill(host, svg, h("div", { class: "note", text: `Rate ratio within each ${f.chart.adjust === "age_band" ? "age band" : "state"}, log scale. 1.0× means no difference.` }));
  }

  let activeTag = "all";
  function publishedFindings(feed) {
    const pf = feed.published_findings;
    if (pf.length) {
      return h("div", { class: "pubfind" },
        h("div", { class: "eyebrow", text: "Published findings · peer reviewed" }),
        h("div", { class: "pubfind-grid" }, pf.map((f) =>
          h("article", { class: "pubcard" },
            h("div", { class: "meta" }, h("span", { text: `${f.venue.split(":")[0].trim()}, ${f.year}` }),
              f.replicated ? h("span", { class: "badge ok", text: "replicated" }) : h("span", { class: "badge", text: "peer-reviewed" })),
            h("h3", { text: f.headline }),
            h("p", { class: "pf-finding", text: f.finding }),
            f.why_surprising ? h("p", { class: "pf-why" }, h("b", { text: "Why it matters " }), f.why_surprising) : null,
            h("p", { class: "pf-src" }, h("a", { href: f.doi ? doiUrl(f.doi) : pmUrl(f.pmid), target: "_blank", rel: "noopener", text: f.title }))))),
        h("p", { class: "note" }, `${num(feed.publications.filter((p) => p.peer_reviewed).length)} peer-reviewed Waymark papers in all. `, h("a", { href: "#publications", text: "See the full list" }), "."));
    }
    const peer = feed.publications.filter((p) => p.peer_reviewed);
    if (!peer.length) return null;
    const top = peer.slice().sort((a, b) => (b.replicated - a.replicated) || b.month.localeCompare(a.month)).slice(0, 8);
    return h("div", { class: "pubfind" },
      h("div", { class: "eyebrow", text: "Published findings · peer reviewed" }),
      h("div", { class: "pubfind-grid" }, top.map((p) =>
        h("article", { class: "pubcard" },
          h("div", { class: "meta" }, h("span", { text: `${p.venue}, ${p.year}` }),
            h("span", { class: "badge", text: "peer-reviewed" }),
            p.replicated ? h("span", { class: "badge ok", text: "replicated" }) : null),
          h("h3", null, h("a", { href: p.doi ? doiUrl(p.doi) : pmUrl(p.pmid), target: "_blank", rel: "noopener", text: p.title }))))),
      h("p", { class: "note" }, `${num(peer.length)} peer-reviewed Waymark papers in all. `, h("a", { href: "#publications", text: "See the full list" }), "."));
  }

  function renderFindings(feed) {
    const list = $("#finding-list"), filters = $("#filters"), fs = feed.findings;
    const pubBlock = publishedFindings(feed);
    if (!fs.length) {
      filters.hidden = true;
      fill(list, pubBlock, h("div", { class: "empty" }, h("div", { class: "eyebrow", text: "New findings since our last publication" }),
        h("p", { text: "Additional findings from Waymark's agents, not yet peer reviewed. None so far." })));
      return;
    }
    const tags = [...new Set(fs.flatMap((f) => f.tags))];
    filters.hidden = tags.length < 2;
    fill(filters, [["all", "All findings"], ...tags.map((t) => [t, TAGS[t] || t])].map(([k, l]) =>
      h("button", { class: "chip", type: "button", "data-tag": k, "aria-pressed": String(k === activeTag), text: l })));
    filters.onclick = (e) => { const b = e.target.closest("[data-tag]"); if (!b) return; activeTag = b.dataset.tag; renderFindings(feed); };
    const shown = fs.filter((f) => activeTag === "all" || f.tags.includes(activeTag));
    fill(list, pubBlock, h("div", { class: "eyebrow", style: "margin:8px 0 4px", text: "New findings since our last publication · not yet peer reviewed" }), shown.map((f) => {
      const host = h("div", { class: "chart" });
      const card = h("article", { class: "finding", id: f.id },
        h("div", { style: "min-width:0" },
          h("div", { class: "meta" }, h("span", { text: f.id }), h("span", { text: fmtMonth(f.published) }), h("span", { class: "tags" }, f.tags.map((t) => h("span", { class: "tag", text: TAGS[t] || t })))),
          h("h3", { text: f.title }),
          h("p", { class: "insight", text: f.insight }),
          effectBlock(f), checksBlock(f, feed.pipeline.fdr_alpha, feed.pipeline.fdr_method), detailsBlock(f)),
        host);
      (f.chart.kind === "day_of_month" ? dayOfMonthChart : forestChart)(host, f);
      return card;
    }));
  }

  /* ================= LITERATURE ================= */
  const doiUrl = (d) => "https://doi.org/" + d.split("/").map(encodeURIComponent).join("/");
  const pmUrl = (p) => `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(p)}/`;
  const arxUrl = (a) => `https://arxiv.org/abs/${encodeURIComponent(a)}`;
  function renderLiterature(feed) {
    const list = $("#lit-list"), lits = feed.literature;
    const published = new Set(feed.findings.map((f) => f.id));
    if (!lits.length) {
      fill(list, h("div", { class: "empty" }, h("div", { class: "eyebrow", text: "No papers approved yet" }), h("h3", { text: "Checked research will appear here" }),
        h("p", { text: `${feed.literature_pipeline.intake ? `Agents have screened ${num(feed.literature_pipeline.intake)} papers so far. ` : ""}A paper appears only after its identity is verified against the registry record, it is appraised and corroborated, a skeptic agent reviews it, and a Waymark clinician approves the card.` })));
      return;
    }
    fill(list, lits.map((l) => {
      const href = l.doi ? doiUrl(l.doi) : l.pmid ? pmUrl(l.pmid) : l.arxiv_id ? arxUrl(l.arxiv_id) : null;
      const ids = [];
      if (l.doi) ids.push(h("a", { href: doiUrl(l.doi), target: "_blank", rel: "noopener", text: `doi:${l.doi}` }));
      if (l.pmid) ids.push(h("a", { href: pmUrl(l.pmid), target: "_blank", rel: "noopener", text: `PMID ${l.pmid}` }));
      if (l.arxiv_id) ids.push(h("a", { href: arxUrl(l.arxiv_id), target: "_blank", rel: "noopener", text: `arXiv:${l.arxiv_id}` }));
      const c = l.corroboration;
      const corr = c.supports == null && c.refutes == null ? "not assessed" : `${c.supports == null ? "—" : c.supports} supporting · ${c.refutes == null ? "—" : c.refutes} refuting`;
      let linked;
      if (l.linked_finding && published.has(l.linked_finding)) linked = h("a", { href: "#" + l.linked_finding, text: `${l.linked_finding} (see finding)` });
      else if (l.linked_finding) linked = `${l.linked_finding} (not published)`;
      else linked = "none";
      return h("article", { class: "lit", id: l.id },
        h("div", { style: "min-width:0" },
          h("div", { class: "meta" }, h("span", { text: l.id }), h("span", { text: fmtMonth(l.published) }),
            h("span", { class: l.peer_reviewed ? "badge" : "badge pre", text: l.peer_reviewed ? "peer-reviewed" : "preprint" }),
            h("span", { class: "badge" + (l.verdict === "applies" ? "" : " pre"), text: l.verdict }),
            l.waymark_authored ? h("span", { class: "badge pre", title: "A Waymark author is on this paper, so it is not independent evidence", text: "Waymark-authored" }) : null),
          h("h3", null, href ? h("a", { href, target: "_blank", rel: "noopener", text: l.title }) : l.title),
          h("p", { class: "cite", text: `${l.venue}, ${l.year} · via ${l.source}` }),
          h("div", { class: "ids" }, ids),
          h("p", { class: "means", text: l.what_it_means })),
        h("dl", null,
          h("dt", { text: "Design" }), h("dd", { text: DESIGNS[l.design] || l.design }),
          h("dt", { text: "Programs" }), h("dd", { text: l.programs.length ? l.programs.map((p) => PROGRAMS[p] || p).join(", ") : "none listed" }),
          h("dt", { text: "Corroboration" }), h("dd", { text: corr }),
          h("dt", { text: "Local test" }), h("dd", null, h("span", { class: l.local_test === "replicated_locally" ? "badge ok" : "badge pre", text: LOCAL[l.local_test] || l.local_test })),
          h("dt", { text: "Linked finding" }), h("dd", null, linked)),
        l.action_taken ? h("p", { class: "acted" }, h("b", { text: "What we changed" }), l.action_taken) : null);
    }));
  }

  function renderPublications(feed) {
    const list = $("#pub-list"), pubs = feed.publications;
    if (!pubs.length) {
      fill(list, h("div", { class: "empty" }, h("div", { class: "eyebrow", text: "Loading the publication list" }), h("h3", { text: "Waymark papers will appear here" }),
        h("p", { text: "The list is rebuilt daily from PubMed and OpenAlex records that name a Waymark affiliation." })));
      return;
    }
    const peer = pubs.filter((p) => p.peer_reviewed).length;
    const years = [...new Set(pubs.map((p) => p.year))].sort((a, b) => b - a);
    fill(list,
      h("p", { class: "note", text: `${num(pubs.length)} papers: ${num(peer)} peer-reviewed, ${num(pubs.length - peer)} preprints.` }),
      years.map((y) => h("div", { class: "pub-year" },
        h("h3", { class: "eyebrow", text: String(y) }),
        h("ol", { class: "pub-items" }, pubs.filter((p) => p.year === y).map((p) => {
          const href = p.doi ? doiUrl(p.doi) : pmUrl(p.pmid);
          return h("li", null,
            h("a", { href, target: "_blank", rel: "noopener", text: p.title }),
            h("span", { class: "cite", text: ` ${p.venue}${p.peer_reviewed ? "" : " (preprint)"}` }),
            p.replicated ? h("span", { class: "badge ok", style: "margin-left:8px", text: "replicated" }) : null);
        })))));
  }

  /* ---------- boot ---------- */
  function boot(raw) {
    const feed = normalize(raw);
    const steps = [renderStrip, panelFeed, panelIntake, panelWork, panelAlpha, panelFunnel, panelAgents, panelReplication, panelMatrix, renderGates, renderFindings, renderPublications, renderLiterature, startObservatory];
    for (const s of steps) { try { s(feed); } catch (e) { console.error(`render ${s.name} failed`, e); } }
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }
  if (window.__FEED__) boot(window.__FEED__);
  else fetch("data/feed.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : EMPTY)).catch(() => EMPTY).then(boot);
})();
