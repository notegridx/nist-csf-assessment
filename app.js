/* =========================================================
   NIST CSF 2.0 Light Assessment (Subcategory 1:1)

   - Data source: ./data.json (normalized per Subcategory)
   - Answer scale: "1".."5" (low..high) and "na" for not answered
   - Main views: intro / assess / result / about

   This file is intentionally framework-free and written for maintainability:
   keep rendering pure (DOM writes) and wire events only once.
   ========================================================= */

'use strict';

const DATA_FILE = "./data.json";

/** Session JSON format for export/import */
const SESSION_KIND = "nist-csf2-light-session";
const SESSION_VERSION = 2;

/** Scored answers (1..5). "na" means not answered. */
const SCORE_CHOICES = new Set(["1", "2", "3", "4", "5"]);
/** Converts answer (1..5) to maturity score (0..100). */
const SCORE_TO_MATURITY = Object.freeze({ "1": 0, "2": 25, "3": 50, "4": 75, "5": 100 });

let VIEWS;
let el;

function bindDomRefs() {

  VIEWS = {
    loading: document.getElementById("viewLoading"),
    intro: document.getElementById("viewIntro"),
    assess: document.getElementById("viewAssess"),
    result: document.getElementById("viewResult"),
  };

  el = {
    btnStart: document.getElementById("btnStart"),
    btnPrev: document.getElementById("btnPrev"),
    btnNext: document.getElementById("btnNext"),
    btnRestart: document.getElementById("btnRestart"),
    btnOpenResult: document.getElementById("btnOpenResult"),
    btnRestart2: document.getElementById("btnRestart2"),
    btnBackToAssess: document.getElementById("btnBackToAssess"),
    btnBackToResult: document.getElementById("btnBackToResult"),
    btnExport: document.getElementById("btnExport"),

    // session export/import
    btnExportSession: document.getElementById("btnExportSession"),
    btnImportSession: document.getElementById("btnImportSession"),
    fileImportSession: document.getElementById("fileImportSession"),

    // intro: optional disclaimer agreement
    chkAgree: document.getElementById("chkAgree"),

    metaLine: document.getElementById("metaLine"),
    questionText: document.getElementById("questionText"),
    progressText: document.getElementById("progressText"),
    progressFill: document.getElementById("progressFill"),

    // 参考情報: examples
    exampleDetails: document.getElementById("exampleDetails"),
    exampleList: document.getElementById("exampleList"),

    radar: document.getElementById("radar"),
    summaryText: document.getElementById("summaryText"),
    // Summary (structured blocks; may be absent in older HTML)
    summaryKpis: document.getElementById("summaryKpis"),
    summaryBadges: document.getElementById("summaryBadges"),
    summaryTop3: document.getElementById("summaryTop3"),
    summaryAction: document.getElementById("summaryAction"),
    summaryUnassessedRow: document.getElementById("summaryUnassessedRow"),
    summaryUnassessed: document.getElementById("summaryUnassessed"),
    top3: document.getElementById("top3"),

    // detail lists (optional)
    lowMaturityDetails: document.getElementById("lowMaturityDetails"),
    lowThresholdSelect: document.getElementById("lowThresholdSelect"),
    lowMaturityList: document.getElementById("lowMaturityList"),
    unansweredDetails: document.getElementById("unansweredDetails"),
    unansweredList: document.getElementById("unansweredList"),

    // left navigation (Function -> Category)
    navSearch: document.getElementById("navSearch"),
    navTree: document.getElementById("navTree"),
    // category bars (by selected Function)
    catBarsDetails: document.getElementById("catBarsDetails"),
    catFnSelect: document.getElementById("catFnSelect"),
    catSortSelect: document.getElementById("catSortSelect"),
    catShowSelect: document.getElementById("catShowSelect"),
    catBarsNote: document.getElementById("catBarsNote"),
    catBars: document.getElementById("catBars"),
  };
}

const ANSWER_LABEL = {
  "5": "5: 定着",
  "4": "4: 概ね実施",
  "3": "3: 一部実施",
  "2": "2: 準備中",
  "1": "1: 未実施",
  na: "未回答／不明",
};


const FUNCTION_ORDER = [
  { tag: "GV", ja: "ガバナンス" },
  { tag: "ID", ja: "識別" },
  { tag: "PR", ja: "防御" },
  { tag: "DE", ja: "検知" },
  { tag: "RS", ja: "対応" },
  { tag: "RC", ja: "復旧" },
];

const FUNCTION_TAG_TO_JA = Object.fromEntries(FUNCTION_ORDER.map(x => [x.tag, x.ja]));

function isScoredAnswer(answer) {
  return SCORE_CHOICES.has(answer);
}

function isMissingAnswer(answer) {
  return answer === "na" || answer === undefined || answer === null || answer === "";
}

/** Maturity score (0-100). Missing answers return null (excluded from averaging). */
function maturityScore(answer) {
  if (!isScoredAnswer(answer)) return null;
  return SCORE_TO_MATURITY[answer] ?? null;
}

function showOnly(viewKey) {
  if (!VIEWS) return;
  Object.values(VIEWS).forEach(v => { if (v) v.hidden = true; });
  if (VIEWS[viewKey]) VIEWS[viewKey].hidden = false;
  el.btnRestart.hidden = !(viewKey === "assess" || viewKey === "result");
  setBackToResultVisibility();
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function splitCategoryLabelJa(label) {
  // Expect formats like "PR.AT（意識向上と訓練）" or "PR.AT (Awareness and Training)"
  const s = String(label || "").trim();
  const m = s.match(/^([A-Z]{2}\.[A-Z]{2})[\s　]*[（(](.+)[）)]$/);
  if (m) return { code: m[1], name: m[2] };
  const m2 = s.match(/^([A-Z]{2}\.[A-Z]{2})\b\s*(.+)$/);
  if (m2) return { code: m2[1], name: m2[2].trim() };
  return { code: "", name: s };
}

function tagFromId(id) {
  // e.g. "PR.AC-01" -> "PR"
  if (!id) return "??";
  return id.split(".")[0];
}


let canReturnToResult = false;
let resultScrollY = 0;

function setBackToResultVisibility() {
  if (!el?.btnBackToResult || !VIEWS?.assess) return;
  // assess表示中 かつ 結果から来た場合のみ表示
  el.btnBackToResult.hidden = !(canReturnToResult && !VIEWS.assess.hidden);
}

function markCameFromResult() {
  canReturnToResult = true;
  // 結果画面上で押された場合に備えてスクロール位置を保持
  resultScrollY = window.scrollY || 0;
}


/* -----------------------------
   Theme (Function color)
-------------------------------- */
function setCurrentFunctionTheme(tag) {
  const t = String(tag || "").toUpperCase();
  if (!t) return;
  document.documentElement.setAttribute("data-current-fn", t);
}

/* -----------------------------
   Summary (Richer)
-------------------------------- */
function buildSummaryData({ functionStats, top3Cats, unassessedCats, answers, questions }) {
  const total = Array.isArray(questions) ? questions.length : 0;

  const counts = { "5": 0, "4": 0, "3": 0, "2": 0, "1": 0, na: 0 };
  let scoredCount = 0;
  let naCount = 0;

  for (const q of (questions || [])) {
    const a = answers && answers[q.id] ? String(answers[q.id]) : "na";
    if (isScoredAnswer(a)) {
      counts[a] += 1;
      scoredCount += 1;
    } else {
      counts.na += 1;
      naCount += 1;
    }
  }

  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);

  // Overall maturity (scored answers only)
  let overall = 0;
  if (scoredCount > 0) {
    let sum = 0;
    for (const q of (questions || [])) {
      const s = maturityScore(answers[q.id]);
      if (s !== null) sum += s;
    }
    overall = Math.round(sum / scoredCount);
  }

  const coveragePct = total ? Math.round((scoredCount / total) * 100) : 0;

  const level =
    overall >= 80 ? "高い" :
      overall >= 60 ? "一定の水準" :
        overall >= 40 ? "改善余地が大きい" :
          "特に注意が必要";

  // Weakest function by average (evaluated only). If none, fall back to minimum avg including zeros.
  const fs = Array.isArray(functionStats) ? functionStats : computeFunctionStats();
  const evaluatedFs = fs.filter(x => (x.answered || 0) > 0);
  const base = (evaluatedFs.length ? evaluatedFs : fs);
  let weakest = base[0] || { tag: "?", ja: "（不明）", avg: 0, coveragePct: 0 };
  for (const f of base) {
    if ((f.avg ?? 0) < (weakest.avg ?? 0)) weakest = f;
  }

  const top3 = (top3Cats || []).slice(0, 3).map(c => c.categoryLabelJa).filter(Boolean);
  const unassessed = (unassessedCats || []).slice(0, 12).map(c => c.categoryLabelJa).filter(Boolean);
  const unassessedCount = (unassessedCats || []).length;

  const action =
    coveragePct < 70
      ? "未評価（未回答／不明）が多いため、まずは関係部門と連携して現状を棚卸しし、適用状況を可視化してください。"
      : overall < 40
        ? "優先度の高い未整備領域から着手し、最低限のルール・責任分担・運用手順を先に整備してください。"
        : overall < 60
          ? "部分的に実施できている取り組みを、主要な対象範囲へ確実に適用できる状態に引き上げてください（適用範囲の明確化、例外の基準化・削減、運用の定着）。"
          : "成熟度が低い残課題を優先的に解消しつつ、継続的な改善（測定→見直し→改善）を強化してください。";

  return {
    total,
    counts,
    pct,
    scoredCount,
    naCount,
    coveragePct,
    overall,
    level,
    weakest,
    top3,
    unassessed,
    unassessedCount,
    action,
  };
}

function buildSummaryTextFromData(data) {
  if (!data) return "—";

  const c = data.counts || { "5": 0, "4": 0, "3": 0, "2": 0, "1": 0, na: 0 };
  const pct = data.pct || ((n) => 0);
  const weakest = data.weakest || { ja: "（不明）", tag: "?" };

  const lines = [
    `総合成熟度は ${data.overall} 点で、現在の対策状況は「${data.level}」です（回答率: ${data.coveragePct}%）。`,
    `回答内訳: 5 ${c["5"]}件（${pct(c["5"])}%） / 4 ${c["4"]}件（${pct(c["4"])}%） / 3 ${c["3"]}件（${pct(c["3"])}%） / 2 ${c["2"]}件（${pct(c["2"])}%） / 1 ${c["1"]}件（${pct(c["1"])}%） / 未評価 ${c.na}件（${pct(c.na)}%）。`,
    `最も弱い分野は ${weakest.ja}（${weakest.tag}）で、相対スコアは ${weakest.avg ?? 0} です。`,
    (Array.isArray(data.top3) && data.top3.length) ? `改善優先カテゴリ（Top3）は「${data.top3.join(" / ")}」です。` : "",
    data.unassessedCount ? `未評価の領域が ${data.unassessedCount} 件あります。` : "",
    `対応方針: ${data.action}`,
  ].filter(Boolean);

  return lines.join("\n");
}


function renderSummary(data) {
  // Prefer new structured summary if the container exists.
  const kpis = el.summaryKpis;
  const badges = el.summaryBadges;
  const top3 = el.summaryTop3;
  const action = el.summaryAction;
  const unassessedRow = el.summaryUnassessedRow;
  const unassessed = el.summaryUnassessed;

  const hasNewDom = Boolean(kpis && badges && top3 && action);

  // Fallback: if HTML has only summaryText (older layout), keep it visible and render text summary.
  if (!hasNewDom) {
    if (el.summaryText) {
      el.summaryText.hidden = false;
      el.summaryText.textContent = buildSummaryTextFromData(data);
    }
    return;
  }

  // New layout: hide old text field if present.
  if (el.summaryText) el.summaryText.hidden = true;

  const c = data.counts || { "5": 0, "4": 0, "3": 0, "2": 0, "1": 0, na: 0 };
  const total = data.total || 0;
  const scored = data.scoredCount || 0;

  kpis.innerHTML = `
    <div class="kpi">
      <div class="kpi__k">総合成熟度</div>
      <div class="kpi__v">${data.overall} 点</div>
      <div class="kpi__sub">評価: 「${escapeHtml(data.level)}」</div>
    </div>
    <div class="kpi">
      <div class="kpi__k">回答率</div>
      <div class="kpi__v">${data.coveragePct}%</div>
      <div class="kpi__sub">評価済み: ${scored}/${total}（未評価: ${c.na}）</div>
    </div>
    <div class="kpi">
      <div class="kpi__k">最も弱い分野</div>
      <div class="kpi__v">${escapeHtml(data.weakest.ja)}（${escapeHtml(data.weakest.tag)}）</div>
      <div class="kpi__sub">平均: ${data.weakest.avg ?? 0}点 / 回答率: ${data.weakest.coveragePct ?? 0}%</div>
    </div>
    <div class="kpi">
      <div class="kpi__k">未評価カテゴリ</div>
      <div class="kpi__v">${data.unassessedCount ?? 0} 件</div>
      <div class="kpi__sub">スコア集計の対象外</div>
    </div>
  `;

  badges.innerHTML = `
    <div class="statGrid">
      <div class="stat"><div class="stat__k">5: 定着</div><div class="stat__v"><b>${c["5"]}</b><span class="stat__unit">件</span><span class="stat__pct">${data.pct(c["5"])}%</span></div></div>
      <div class="stat"><div class="stat__k">4: 概ね実施</div><div class="stat__v"><b>${c["4"]}</b><span class="stat__unit">件</span><span class="stat__pct">${data.pct(c["4"])}%</span></div></div>
      <div class="stat"><div class="stat__k">3: 一部実施</div><div class="stat__v"><b>${c["3"]}</b><span class="stat__unit">件</span><span class="stat__pct">${data.pct(c["3"])}%</span></div></div>
      <div class="stat"><div class="stat__k">2: 準備中</div><div class="stat__v"><b>${c["2"]}</b><span class="stat__unit">件</span><span class="stat__pct">${data.pct(c["2"])}%</span></div></div>
      <div class="stat"><div class="stat__k">1: 未実施</div><div class="stat__v"><b>${c["1"]}</b><span class="stat__unit">件</span><span class="stat__pct">${data.pct(c["1"])}%</span></div></div>
      <div class="stat"><div class="stat__k">未評価</div><div class="stat__v"><b>${c.na}</b><span class="stat__unit">件</span><span class="stat__pct">${data.pct(c.na)}%</span></div></div>
    </div>
  `;

  top3.innerHTML = (data.top3 && data.top3.length)
    ? `<ol class="topList">` + data.top3.map(label => {
      const p = splitCategoryLabelJa(label);
      const code = p.code ? `<span class="codeTag">${escapeHtml(p.code)}</span>` : ``;
      const name = p.name ? `<span class="topList__txt">${escapeHtml(p.name)}</span>` : `<span class="topList__txt">${escapeHtml(label)}</span>`;
      return `<li class="topList__item">${code}${name}</li>`;
    }).join("") + `</ol>`
    : `<span class="muted">—</span>`;

  if (unassessedRow && unassessed) {
    const show = (data.unassessedCount || 0) > 0;
    unassessedRow.hidden = !show;
    if (show) {
      unassessed.innerHTML = (data.unassessed || []).map(label => {
        const p = splitCategoryLabelJa(label);
        const code = p.code ? `${p.code} ` : "";
        const name = p.name || label;
        return `<span class="pill">${escapeHtml(code + name)}</span>`;
      }).join("") + (data.unassessedCount > (data.unassessed || []).length ? `<span class="muted small">…他</span>` : "");
    } else {
      unassessed.innerHTML = "";
    }
  }

  action.innerHTML = `<b>対応方針:</b> ${escapeHtml(data.action)}`;
}

/* -----------------------------
   Priority selection (Category-based, Maturity-only)
-------------------------------- */


function normalizeCategoryKey(q) {
  // Prefer canonical english key if present. Fallback to japanese.
  return (q.category || q.category_ja || "UNKNOWN_CATEGORY").trim();
}

function normalizeCategoryLabelJa(q) {
  return (q.category_ja || q.category || "未分類").trim();
}

function computeCategoryStats(questions, answers) {
  // categoryKey -> stats
  const buckets = new Map();

  questions.forEach((q, idx) => {
    const categoryKey = normalizeCategoryKey(q);
    const labelJa = normalizeCategoryLabelJa(q);
    const fnTag = tagFromId(q.id);
    const fnJa = FUNCTION_TAG_TO_JA[fnTag] || fnTag;

    const s = maturityScore(answers[q.id]);
    const ans = answers[q.id];

    if (!buckets.has(categoryKey)) {
      const p = splitCategoryLabelJa(labelJa);
      const code = (p.code || (String(categoryKey).match(/^[A-Z]{2}\.[A-Z]{2}/)?.[0]) || String(categoryKey));
      const name = p.name || labelJa;
      buckets.set(categoryKey, {
        categoryKey,
        categoryLabelJa: labelJa,
        code,
        name,
        functionTag: fnTag,
        functionJa: fnJa,
        firstIndex: idx,
        total: 0,
        answered: 0,
        sum: 0,
        minScore: null,
        minItems: [],
      });
    }

    const b = buckets.get(categoryKey);
    b.total += 1;
    b.firstIndex = Math.min(b.firstIndex, idx);

    if (s !== null) {
      b.answered += 1;
      b.sum += s;

      if (b.minScore === null || s < b.minScore) {
        b.minScore = s;
        b.minItems = [{ q, ans, score: s, idx }];
      } else if (s === b.minScore) {
        b.minItems.push({ q, ans, score: s, idx });
      }
    }
  });

  const out = [];
  for (const b of buckets.values()) {
    const avgScore = b.answered ? Math.round(b.sum / b.answered) : null;
    const coveragePct = b.total ? Math.round((b.answered / b.total) * 100) : 0;
    out.push({ ...b, avgScore, coveragePct });
  }
  // stable by appearance
  out.sort((a, b) => a.firstIndex - b.firstIndex);
  return out;
}

function selectTop3MaturityCategories(questions, answers) {
  const stats = computeCategoryStats(questions, answers);

  const evaluated = stats.filter(s => s.answered > 0 && s.avgScore !== null);
  evaluated.sort((a, b) => {
    if (a.avgScore !== b.avgScore) return a.avgScore - b.avgScore;                 // low maturity first
    if (a.coveragePct !== b.coveragePct) return a.coveragePct - b.coveragePct;     // lower coverage first
    return String(a.code).localeCompare(String(b.code));                             // stable tie-break
  });

  return evaluated.slice(0, 3);
}

function selectUnassessedCategories(questions, answers) {
  const stats = computeCategoryStats(questions, answers);
  return stats.filter(s => s.answered === 0);
}



/* -----------------------------
   Radar + results render
-------------------------------- */
function drawRadar(canvas, labels, values, opt = {}) {
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  const cx = Math.round(w / 2);
  const cy = Math.round(h / 2) + 10;
  const radius = Math.min(w, h) * 0.28;

  // grid
  ctx.strokeStyle = "rgba(0,0,0,0.08)";
  ctx.lineWidth = 1;

  const rings = 4;
  for (let r = 1; r <= rings; r++) {
    const rr = (radius * r) / rings;
    ctx.beginPath();
    for (let i = 0; i < labels.length; i++) {
      const a = (Math.PI * 2 * i) / labels.length - Math.PI / 2;
      const x = cx + rr * Math.cos(a);
      const y = cy + rr * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // axes + labels
  ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, Noto Sans JP, sans-serif";
  ctx.fillStyle = "rgba(17,24,39,.75)";

  for (let i = 0; i < labels.length; i++) {
    const a = (Math.PI * 2 * i) / labels.length - Math.PI / 2;
    const x2 = cx + radius * Math.cos(a);
    const y2 = cy + radius * Math.sin(a);

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    const lx = cx + (radius + 18) * Math.cos(a);
    const ly = cy + (radius + 18) * Math.sin(a);

    const text = labels[i];
    const tw = ctx.measureText(text).width;

    const ax = lx - tw / 2;
    const ay = ly + 4;
    ctx.fillText(text, ax, ay);
  }

  // polygon
  const pts = values.map((v, i) => {
    const a = (Math.PI * 2 * i) / labels.length - Math.PI / 2;
    const rr = (clamp(v, 0, 100) / 100) * radius;
    return { x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a) };
  });

  ctx.beginPath();
  pts.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();

  const stroke = opt.stroke || "rgba(37,99,235,0.70)";
  const fill = opt.fill || "rgba(37,99,235,0.12)";
  const point = opt.point || "rgba(37,99,235,0.85)";

  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();

  // points
  ctx.fillStyle = point;
  pts.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
  });

  // values (optional)
  const showValues = opt.showValues === true;
  if (showValues) {
    ctx.font = "11px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, Noto Sans JP, sans-serif";
    ctx.fillStyle = "rgba(17,24,39,.85)";

    values.forEach((v, i) => {
      const vv = Math.round(clamp(Number(v) || 0, 0, 100));
      const a = (Math.PI * 2 * i) / labels.length - Math.PI / 2;

      const dx = Math.cos(a);
      const dy = Math.sin(a);

      const p = pts[i];
      const tx = p.x + dx * 10;
      const ty = p.y + dy * 10;

      ctx.textAlign = dx > 0.35 ? "left" : dx < -0.35 ? "right" : "center";
      ctx.textBaseline = dy > 0.35 ? "top" : dy < -0.35 ? "bottom" : "middle";

      // small background for readability
      const text = String(vv);
      const padX = 4;
      const padY = 2;
      const m = ctx.measureText(text);
      const tw = m.width;

      let bx = tx;
      if (ctx.textAlign === "center") bx = tx - tw / 2;
      else if (ctx.textAlign === "right") bx = tx - tw;

      let by = ty;
      if (ctx.textBaseline === "middle") by = ty - 6;
      else if (ctx.textBaseline === "bottom") by = ty - 12;

      ctx.fillStyle = "rgba(255,255,255,.85)";
      ctx.strokeStyle = "rgba(0,0,0,.08)";
      ctx.lineWidth = 1;

      // rounded rect
      const rw = tw + padX * 2;
      const rh = 12 + padY * 2;
      const rx = bx - padX;
      const ry = by - padY;
      const r = 4;
      ctx.beginPath();
      ctx.moveTo(rx + r, ry);
      ctx.lineTo(rx + rw - r, ry);
      ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + r);
      ctx.lineTo(rx + rw, ry + rh - r);
      ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - r, ry + rh);
      ctx.lineTo(rx + r, ry + rh);
      ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - r);
      ctx.lineTo(rx, ry + r);
      ctx.quadraticCurveTo(rx, ry, rx + r, ry);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "rgba(17,24,39,.85)";
      ctx.fillText(text, tx, ty);
    });
  }
}

/* -----------------------------
   App state
-------------------------------- */
let QUESTIONS = [];
let currentIndex = 0;
// answersById: { [id]: "1"|"2"|"3"|"4"|"5"|"na" }
const answersById = Object.create(null);

/* -----------------------------
   Left navigation (Function -> Category)
-------------------------------- */

let NAV = null;

function hashStr(s) {
  // Stable simple hash for DOM ids
  let h = 0;
  const str = String(s ?? "");
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}


function buildCategoryNav() {
  if (!el.navTree) return;

  const categories = new Map(); // categoryKey -> { key, labelJa, tag, startIndex, total }
  QUESTIONS.forEach((q, idx) => {
    const key = normalizeCategoryKey(q);
    if (!categories.has(key)) {
      categories.set(key, {
        key,
        labelJa: normalizeCategoryLabelJa(q),
        tag: tagFromId(q.id),
        startIndex: idx,
        total: 0,
      });
    }
    categories.get(key).total++;
  });

  // group categories by Function tag, keep order by appearance in QUESTIONS
  const byTag = new Map();
  for (const cat of categories.values()) {
    if (!byTag.has(cat.tag)) byTag.set(cat.tag, []);
    byTag.get(cat.tag).push(cat);
  }
  for (const arr of byTag.values()) arr.sort((a, b) => a.startIndex - b.startIndex);

  // Build DOM
  const domIdByKey = new Map();
  const catItemsHtml = (cat) => {
    const domId = `navc_${hashStr(cat.key)}`;
    domIdByKey.set(cat.key, domId);

    // Display "GV.OC" part if present, otherwise the full key
    const code = (cat.key.match(/^[A-Z]{2}\.[A-Z]{2}/)?.[0]) || cat.key;

    return `
      <button type="button" class="navCat" id="${domId}"
        data-nav-index="${cat.startIndex}" data-cat-key="${escapeHtml(cat.key)}" data-fn="${escapeHtml(cat.tag)}">
        <span class="navCat__code">${escapeHtml(code)}</span>
        <span class="navCat__label">${escapeHtml(cat.labelJa)}</span>
        <span class="navCat__count" data-nav-count="${escapeHtml(cat.key)}">0/${cat.total}</span>
      </button>
    `;
  };

  const html = FUNCTION_ORDER.map(fn => {
    const arr = byTag.get(fn.tag) || [];
    if (arr.length === 0) return "";
    const items = arr.map(catItemsHtml).join("");
    return `
      <details class="navFn" data-fn="${escapeHtml(fn.tag)}">
        <summary class="navFn__summary">
          <span class="navFn__title">${escapeHtml(fn.ja)}（${escapeHtml(fn.tag)}）</span>
        </summary>
        <div class="navFn__items">
          ${items}
        </div>
      </details>
    `;
  }).join("");

  el.navTree.innerHTML = html;
  NAV = { categories, domIdByKey };

  // Click handlers
  el.navTree.querySelectorAll(".navCat").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.navIndex);
      if (!Number.isFinite(idx)) return;
      currentIndex = clamp(idx, 0, Math.max(0, QUESTIONS.length - 1));
      showOnly("assess");
      renderQuestion();

      // On narrow layouts, keep focus on content
      el.questionText?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  });

  // Search / filter
  if (el.navSearch) {
    el.navSearch.addEventListener("input", () => {
      filterNav(el.navSearch.value);
    });
  }

  refreshNavCounts();
  updateNavActive();
}

function filterNav(keywordRaw) {
  if (!NAV || !el.navTree) return;
  const kw = String(keywordRaw || "").trim().toLowerCase();

  // show/hide categories by keyword (matches code/label)
  el.navTree.querySelectorAll(".navCat").forEach(btn => {
    if (!kw) {
      btn.hidden = false;
      return;
    }
    const key = String(btn.dataset.catKey || "");
    const label = btn.querySelector(".navCat__label")?.textContent || "";
    const code = btn.querySelector(".navCat__code")?.textContent || "";
    const hit =
      key.toLowerCase().includes(kw) ||
      label.toLowerCase().includes(kw) ||
      code.toLowerCase().includes(kw);
    btn.hidden = !hit;
  });

  // hide function blocks that have no visible items
  el.navTree.querySelectorAll(".navFn").forEach(block => {
    const hasVisible = Array.from(block.querySelectorAll(".navCat")).some(x => !x.hidden);
    block.hidden = !hasVisible;
    if (kw) block.open = hasVisible; // expand matches
  });

  if (!kw) {
    // reset to "current Function only" mode
    updateNavActive();
  }
}

function refreshNavCounts() {
  if (!NAV || !el.navTree) return;

  // answered per category
  const stats = new Map(); // key -> { answered, total }
  for (const q of QUESTIONS) {
    const key = normalizeCategoryKey(q);
    if (!stats.has(key)) stats.set(key, { answered: 0, total: 0 });
    const s = stats.get(key);
    s.total++;
    if (maturityScore(answersById[q.id]) !== null) s.answered++;
  }

  el.navTree.querySelectorAll("[data-nav-count]").forEach(span => {
    const key = span.getAttribute("data-nav-count");
    const s = stats.get(key) || { answered: 0, total: 0 };
    span.textContent = `${s.answered}/${s.total}`;
  });
}

function updateNavActive() {
  if (!NAV || !el.navTree) return;

  const q = QUESTIONS[currentIndex];
  if (!q) return;

  const activeKey = normalizeCategoryKey(q);
  const activeTag = tagFromId(q.id);

  // If not searching, keep the nav compact: open only the current Function
  const kw = String(el.navSearch?.value || "").trim();
  if (!kw) {
    el.navTree.querySelectorAll("details.navFn").forEach(d => {
      d.open = (d.dataset.fn === activeTag);
    });
  }

  el.navTree.querySelectorAll(".navCat").forEach(btn => {
    const isActive = btn.dataset.catKey === activeKey;
    btn.classList.toggle("is-active", isActive);

    // Ensure the active Function block is expanded (mainly for search mode)
    if (isActive) {
      const parentDetails = btn.closest("details.navFn");
      if (parentDetails) parentDetails.open = true;
    }
  });

  // keep active category in view
  const domId = NAV.domIdByKey.get(activeKey);
  if (domId) {
    const node = document.getElementById(domId);
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "nearest" });
    }
  }
}



function setSelectedButton(answer) {
  document.querySelectorAll(".answerChoice").forEach(btn => {
    const selected = btn.dataset.answer === answer;
    btn.classList.toggle("is-selected", selected);
    btn.setAttribute("aria-checked", selected ? "true" : "false");
  });
}

function updateNavButtons() {
  el.btnPrev.disabled = currentIndex <= 0;

  const id = QUESTIONS[currentIndex]?.id;
  const hasAnswer = Boolean(answersById[id]);
  el.btnNext.disabled = !hasAnswer;

  updateOpenResultButton();
}

/** Enable/disable "結果を開く" based on whether questions are loaded and at least one answer exists. */
function updateOpenResultButton() {
  if (!el.btnOpenResult) return;

  const hasQuestions = Array.isArray(QUESTIONS) && QUESTIONS.length > 0;
  const answeredAny = hasQuestions && QUESTIONS.some(q => Boolean(answersById[q.id]));
  el.btnOpenResult.disabled = !(hasQuestions && answeredAny);
}

/** If the optional disclaimer agreement checkbox exists, gate the Start button. */
function updateStartButtonState() {
  if (!el.btnStart) return;
  if (!el.chkAgree) {
    el.btnStart.disabled = false;
    return;
  }
  el.btnStart.disabled = !el.chkAgree.checked;
}

function computeRadarValues() {
  // average per function tag (scored answers only)
  const byTag = Object.fromEntries(FUNCTION_ORDER.map(x => [x.tag, []]));
  for (const q of QUESTIONS) {
    const ans = answersById[q.id];
    const tag = tagFromId(q.id);
    const s = maturityScore(ans);
    if (s === null) continue; // exclude missing/na
    if (!byTag[tag]) byTag[tag] = [];
    byTag[tag].push(s);
  }
  const values = FUNCTION_ORDER.map(x => {
    const arr = byTag[x.tag] || [];
    if (arr.length === 0) return 0;
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.round(avg);
  });
  return values;
}

function computeFunctionStats() {
  // { tag, ja, avg, answered, total, coveragePct }
  const totalByTag = Object.fromEntries(FUNCTION_ORDER.map(x => [x.tag, 0]));
  const answeredByTag = Object.fromEntries(FUNCTION_ORDER.map(x => [x.tag, 0]));
  const sumByTag = Object.fromEntries(FUNCTION_ORDER.map(x => [x.tag, 0]));

  for (const q of QUESTIONS) {
    const tag = tagFromId(q.id);
    totalByTag[tag] = (totalByTag[tag] ?? 0) + 1;
    const s = maturityScore(answersById[q.id]);
    if (s !== null) {
      answeredByTag[tag] = (answeredByTag[tag] ?? 0) + 1;
      sumByTag[tag] = (sumByTag[tag] ?? 0) + s;
    }
  }

  return FUNCTION_ORDER.map(f => {
    const total = totalByTag[f.tag] || 0;
    const answered = answeredByTag[f.tag] || 0;
    const avg = answered ? Math.round((sumByTag[f.tag] || 0) / answered) : 0;
    const coveragePct = total ? Math.round((answered / total) * 100) : 0;
    return { tag: f.tag, ja: f.ja, avg, answered, total, coveragePct };
  });
}

/* -----------------------------
   Category radar (per Function)
-------------------------------- */

const FUNCTION_COLOR_HEX = {
  GV: "#f9f49d",
  ID: "#4bb2e0",
  PR: "#9292ea",
  DE: "#fab746",
  RS: "#f97367",
  RC: "#7df49f",
};

let CAT_RADAR = {
  dataByFn: null,     // { GV: [ {code,name,labelJa,value,key,firstIndex,total}... ] , ... }
  lastSelectedFn: null,
  lastSort: "weak", // weak | strong | code | name
  lastShow: "all",   // all (legacy: 12)
};

let CAT_BARS_WIRED = false;
function rerenderCategoryBarsFromControls() {
  const fn = String(el.catFnSelect?.value || CAT_RADAR.lastSelectedFn || "GV").toUpperCase();
  const sort = String(el.catSortSelect?.value || CAT_RADAR.lastSort || "weak");
  const show = String(el.catShowSelect?.value || CAT_RADAR.lastShow || "12");
  CAT_RADAR.lastSelectedFn = fn;
  CAT_RADAR.lastSort = sort;
  CAT_RADAR.lastShow = show;
  renderCategoryBars(fn, sort, show);
}


function computeCategoryRadarData() {
  // Build category maturity averages (scored answers only), grouped by Function
  const dataByFn = Object.fromEntries(FUNCTION_ORDER.map(f => [f.tag, new Map()]));

  QUESTIONS.forEach((q, idx) => {
    const fn = tagFromId(q.id);
    if (!dataByFn[fn]) dataByFn[fn] = new Map();

    const key = normalizeCategoryKey(q);
    const labelJa = normalizeCategoryLabelJa(q);
    const s = maturityScore(answersById[q.id]);

    const bucket = dataByFn[fn].get(key) || { key, labelJa, firstIndex: idx, sum: 0, answered: 0, total: 0 };
    bucket.total += 1;
    if (s !== null) {
      bucket.sum += s;
      bucket.answered += 1;
    }
    bucket.firstIndex = Math.min(bucket.firstIndex, idx);
    dataByFn[fn].set(key, bucket);
  });

  // Convert to array + stable sort
  const out = {};
  for (const fn of Object.keys(dataByFn)) {
    const arr = Array.from(dataByFn[fn].values())
      .sort((a, b) => a.firstIndex - b.firstIndex)
      .map(x => {
        const p = splitCategoryLabelJa(x.labelJa);
        const code = (p.code || (String(x.key).match(/^[A-Z]{2}\.[A-Z]{2}/)?.[0]) || String(x.key));
        const name = p.name || x.labelJa;
        const value = x.answered ? Math.round(x.sum / x.answered) : null;
        const coveragePct = x.total ? Math.round((x.answered / x.total) * 100) : 0;
        return {
          key: x.key,
          labelJa: x.labelJa,
          code,
          name,
          value,
          coveragePct,
          firstIndex: x.firstIndex,
          total: x.total,
          answered: x.answered,
        };
      });

    out[fn] = arr;
  }

  CAT_RADAR.dataByFn = out;
  return out;
}


function ensureCategoryBarsControls(defaultFnTag) {
  if (!el.catFnSelect || !el.catSortSelect) return;

  // Populate selects (only once)
  if (el.catFnSelect.options.length === 0) {
    el.catFnSelect.innerHTML = FUNCTION_ORDER
      .map(f => `<option value="${escapeHtml(f.tag)}">${escapeHtml(f.ja)}（${escapeHtml(f.tag)}）</option>`)
      .join("");
  }
  if (el.catSortSelect.options.length === 0) {
    el.catSortSelect.innerHTML = `
      <option value="weak">弱い順（低→高）</option>
      <option value="strong">強い順（高→低）</option>
      <option value="code">コード順（A→Z）</option>
      <option value="name">名称順（あ→ん）</option>
    `.trim();
  }

  // Initial / restore values (do not overwrite user selection unless this is the first time)
  const pick = String(defaultFnTag || "").toUpperCase();
  const initialFn = FUNCTION_TAG_TO_JA[pick] ? pick : (FUNCTION_ORDER[0]?.tag || "GV");

  if (!CAT_RADAR.lastSelectedFn) CAT_RADAR.lastSelectedFn = initialFn;
  if (!CAT_RADAR.lastSort) CAT_RADAR.lastSort = "weak";
  if (!CAT_RADAR.lastShow) CAT_RADAR.lastShow = "all";

  el.catFnSelect.value = CAT_RADAR.lastSelectedFn;
  el.catSortSelect.value = CAT_RADAR.lastSort;

  // Wire change listeners only once to avoid duplicate handlers when renderResults() reruns.
  if (!CAT_BARS_WIRED) {
    el.catFnSelect.addEventListener("change", rerenderCategoryBarsFromControls);
    el.catSortSelect.addEventListener("change", rerenderCategoryBarsFromControls);
    CAT_BARS_WIRED = true;
  }
}


function renderCategoryBars(fnTag, sortMode, showMode) {
  if (!el.catBars) return;
  if (el.catBarsDetails && !el.catBarsDetails.open) return;

  const byFn = CAT_RADAR.dataByFn || computeCategoryRadarData();
  const t = String(fnTag || "").toUpperCase();
  let cats = (byFn && byFn[t]) ? [...byFn[t]] : [];

  if (!cats.length) {
    el.catBars.innerHTML = `<div class="catBarsEmpty muted small">該当するカテゴリがありません。</div>`;
    if (el.catBarsNote) el.catBarsNote.textContent = "";
    return;
  }

  // sort
  const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });
  switch (sortMode) {
    case "strong":
      cats.sort((a, b) => (((b.value ?? -1) - (a.value ?? -1)) || collator.compare(a.code, b.code)));
      break;
    case "code":
      cats.sort((a, b) => collator.compare(a.code, b.code));
      break;
    case "name":
      cats.sort((a, b) => collator.compare(a.name, b.name));
      break;
    case "weak":
    default:
      cats.sort((a, b) => ((((a.value === null || a.value === undefined) ? 101 : a.value) - ((b.value === null || b.value === undefined) ? 101 : b.value)) || collator.compare(a.code, b.code)));
      break;
  }
  // show all categories (no limit selector)
  const shown = cats;

  if (el.catBarsNote) {
    el.catBarsNote.textContent = `対象: ${FUNCTION_TAG_TO_JA[t] || t}（${t}） （全${cats.length}件）`;
  }

  const color = FUNCTION_COLOR_HEX[t] || "#2563eb";

  el.catBars.innerHTML = shown.map(c => {
    const hasScore = (c.value !== null && c.value !== undefined);
    const pct = hasScore ? clamp(c.value, 0, 100) : 0;
    const code = escapeHtml(c.code);
    const name = escapeHtml(c.name);
    // const val = hasScore ? escapeHtml(String(c.value)) : "—";
    const val = hasScore ? `${Math.round(pct)} 点` : "—";
    const idx = Number.isFinite(c.firstIndex) ? c.firstIndex : 0;

    return `
      <div class="catBar" role="listitem" tabindex="0"
           style="--bar-color:${color};"
           data-nav-index="${idx}">
        <div class="catBar__top">
          <span class="codeTag">${code}</span>
          <span class="catBar__name">${name}</span>
          <span class="catBar__val">${val}</span>
        </div>
        <div class="catBar__bar" aria-hidden="true">
          <div class="catBar__fill" style="width:${pct}%"></div>
        </div>
      </div>
    `;
  }).join("");

  // wire click -> jump to category start question
  el.catBars.querySelectorAll(".catBar").forEach(row => {
    const jump = () => {
      markCameFromResult();
      const idx = Number(row.getAttribute("data-nav-index"));
      if (!Number.isFinite(idx)) return;
      currentIndex = clamp(idx, 0, Math.max(0, QUESTIONS.length - 1));
      showOnly("assess");
      renderQuestion();
      el.questionText?.scrollIntoView({ block: "start", behavior: "smooth" });
    };
    row.addEventListener("click", jump);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        jump();
      }
    });
  });
}

/* -----------------------------
   Examples render
-------------------------------- */
function renderExamples(q) {
  if (!el.exampleDetails || !el.exampleList) return;

  const ex = Array.isArray(q?.examples) ? q.examples : [];
  if (ex.length === 0) {
    el.exampleDetails.hidden = true;
    el.exampleList.innerHTML = "";
    return;
  }

  el.exampleDetails.hidden = false;
  el.exampleList.innerHTML = ex.map((e) => {
    const code = escapeHtml(e.implementationExample || "");
    const text = escapeHtml(e.text_ja || e.text || "");
    return `
      <li class="exampleItem">
        <div class="exampleCode">${code}</div>
        <div class="exampleText">${text}</div>
      </li>
    `;
  }).join("");
}

function renderQuestion() {
  const q = QUESTIONS[currentIndex];
  if (!q) return;

  const tag = tagFromId(q.id);
  const funcJa = FUNCTION_TAG_TO_JA[tag] || q.function_ja || "";
  setCurrentFunctionTheme(tag);
  el.metaLine.textContent = `${q.id} ｜ ${funcJa}（${tag}） ｜ ${q.category_ja ?? q.category ?? ""}`;

  el.questionText.textContent = q.question;

  // examples
  renderExamples(q);

  const total = QUESTIONS.length;
  el.progressText.textContent = `${currentIndex + 1}/${total}`;
  el.progressFill.style.width = `${Math.round(((currentIndex + 1) / total) * 100)}%`;

  setSelectedButton(answersById[q.id] || "");
  updateNavButtons();
  updateNavActive();
}

function goNext() {
  if (currentIndex < QUESTIONS.length - 1) {
    currentIndex++;
    renderQuestion();
  } else {
    renderResults();
    showOnly("result");
  }
}

function goPrev() {
  if (currentIndex > 0) {
    currentIndex--;
    renderQuestion();
  }
}

function setAnswerForCurrent(ans) {
  const q = QUESTIONS[currentIndex];
  answersById[q.id] = ans;
  setSelectedButton(ans);
  updateNavButtons();
  refreshNavCounts();
  updateNavActive();
}

/* -----------------------------
   Results rendering (Category-based Top3)
-------------------------------- */


function renderTop3Categories(top3Cats) {
  if (!el.top3) return;

  if (!top3Cats || top3Cats.length === 0) {
    el.top3.innerHTML = `<div class="muted">—</div>`;
    return;
  }

  el.top3.innerHTML = top3Cats.map((cat, idx) => {
    const rawFn = cat.functionLabel || cat.function;
    const fnTag = cat.functionTag || tagFromId(cat.categoryKey || cat.code || "");
    const fnText = rawFn ? `${escapeHtml(rawFn)} ｜ ` : "";
    const header = cat.labelJa || cat.categoryKey || "—";
    const score = Number.isFinite(cat.avgScore) ? cat.avgScore.toFixed(2) : "—";
    const cov = Number.isFinite(cat.coveragePct) ? Math.round(cat.coveragePct) : "—";

    const allMinItems = Array.isArray(cat.minItems) ? cat.minItems : [];
    const minCount = allMinItems.length;

    // Render only a small number of lowest-maturity items to keep the Top3 cards readable.
    const MAX_MINITEMS = 6;
    const shownMinItems = allMinItems.slice(0, MAX_MINITEMS);
    const remainingMinItems = Math.max(0, minCount - shownMinItems.length);

    const itemsHtml = shownMinItems.map(({ q, ans, idx }) => {
      const status = ANSWER_LABEL[ans] || ans;
      const sub = (q.subcategory_ja || q.question || "").trim() || "—";

      const riskOut = (q.riskText || "").trim() || "—";
      const hintOut = (q.improvementHint || "").trim() || "—";

      const itemFn = tagFromId(q.id);

      return `
        <div class="unmetItem" data-fn="${escapeHtml(itemFn)}">
          <div class="unmetItem__meta row row--space"><span>${escapeHtml(`${q.id} ｜ 回答: ${status}`)}</span><button type="button" class="btn btn--ghost btn--sm" data-jump-idx="${idx}">この設問に移動</button></div>

          <details class="miniDetails">
            <summary class="miniDetails__summary">
              <span class="miniDetails__q">${escapeHtml(sub)}</span>
              <span class="miniDetails__cta muted small">リスク／対応方針</span>
            </summary>

            <div class="miniDetails__body">
              <div class="unmetItem__block">
                <div class="kv__k">想定されるリスク</div>
                <div class="kv__v">${escapeHtml(riskOut)}</div>
              </div>

              <div class="unmetItem__block">
                <div class="kv__k">改善の観点（対応方針）</div>
                <div class="kv__v">${escapeHtml(hintOut)}</div>
              </div>
            </div>
          </details>
        </div>
      `;
    }).join("");

    const moreLine = remainingMinItems > 0
      ? `<div class="muted small" style="margin-top:10px;">ほか<b>${remainingMinItems}</b>件（最小成熟度）。「詳細一覧（任意）」で確認できます。</div>`
      : "";

    const summaryLine = `低成熟度（最小）: <b>${minCount}</b>件`;

    return `
      <div class="top3Card" data-fn="${escapeHtml(fnTag)}">
        <div class="top3Card__header">
          <div class="top3Card__headText">
            <div class="top3Card__rank">#${idx + 1}</div>
            <div class="top3Card__title"><span class="badge">改善優先</span> ${escapeHtml(header)}</div>
            <div class="top3Card__meta muted small">${fnText}平均 <b>${score}点</b> ｜ 回答率 <b>${cov}%</b></div>
          </div>
        </div>

        <details class="details details--top3">
          <summary>
            ${summaryLine}
            <span class="detailsHint muted small">クリックで詳細</span>
          </summary>
          <div class="details__body">
            <div class="unmetList">
              ${itemsHtml || `<div class="muted">—</div>`}
            </div>
          </div>
        </details>
      </div>
    `;
  }).join("");

  // Wire jump buttons
  el.top3.querySelectorAll("[data-jump-idx]").forEach(btn => {
    btn.addEventListener("click", () => {
      markCameFromResult();
      const idx = Number(btn.getAttribute("data-jump-idx"));
      if (!Number.isFinite(idx)) return;
      currentIndex = clamp(idx, 0, Math.max(0, QUESTIONS.length - 1));
      showOnly("assess");
      renderQuestion();
      el.questionText?.scrollIntoView({ block: "start", behavior: "smooth" });
      updateNavActive();
    });
  });
}
/* -----------------------------
   Detail lists (optional)
   - Low maturity items
   - Unanswered/NA items
-------------------------------- */
function groupByCategory(questions, predicate) {
  const buckets = new Map(); // key -> { categoryKey, labelJa, items: [{q, ans}] }
  for (const q of questions) {
    const categoryKey = normalizeCategoryKey(q);
    const labelJa = normalizeCategoryLabelJa(q);
    const ans = answersById[q.id];

    if (!predicate(q, ans)) continue;

    if (!buckets.has(categoryKey)) {
      buckets.set(categoryKey, { categoryKey, labelJa, items: [] });
    }
    buckets.get(categoryKey).items.push({ q, ans });
  }

  const groups = [...buckets.values()];
  groups.sort((a, b) => {
    if (b.items.length !== a.items.length) return b.items.length - a.items.length;
    return String(a.categoryKey).localeCompare(String(b.categoryKey));
  });
  return groups;
}

function renderGroupedItemList(containerEl, groups, emptyText) {
  if (!containerEl) return;

  if (!groups || groups.length === 0) {
    containerEl.innerHTML = `<div class="muted">${escapeHtml(emptyText || "—")}</div>`;
    return;
  }

  containerEl.innerHTML = groups.map(g => {
    const header = `${g.labelJa}（${g.items.length}件）`;

    // Function tag for this Category group (e.g., "GV"). Assumes group items share the same Function.
    const groupFn = tagFromId(g.items?.[0]?.q?.id || g.items?.[0]?.q?.categoryKey || "");

    const body = g.items.map(({ q, ans }) => {
      const status = ANSWER_LABEL[ans] || "未回答／不明";
      const sub = (q.subcategory_ja || q.question || "").trim() || "—";

      const riskOut = (q.riskText || "").trim() || "—";
      const hintOut = (q.improvementHint || "").trim() || "—";

      const itemFn = tagFromId(q.id);

      return `
        <div class="unmetItem" data-fn="${escapeHtml(itemFn)}">
          <div class="unmetItem__meta">${escapeHtml(`${q.id} ｜ 回答: ${status}`)}</div>
          <div class="unmetItem__q">${escapeHtml(sub)}</div>

          <div class="unmetItem__block">
            <div class="kv__k">想定されるリスク</div>
            <div class="kv__v">${escapeHtml(riskOut)}</div>
          </div>

          <div class="unmetItem__block">
            <div class="kv__k">改善の観点（対応方針）</div>
            <div class="kv__v">${escapeHtml(hintOut)}</div>
          </div>
        </div>
      `;
    }).join("");

    return `
      <div class="unmetGroup" data-fn="${escapeHtml(groupFn)}">
        <div class="unmetGroup__title">${escapeHtml(header)}</div>
        ${body}
      </div>
    `;
  }).join("");
}

function renderLowMaturityList(maxLevel) {
  const n = Number(maxLevel) || 2;
  const groups = groupByCategory(QUESTIONS, (q, ans) => {
    if (!isScoredAnswer(ans)) return false;
    const level = Number(ans);
    return Number.isFinite(level) && level <= n;
  });
  const label = n === 2 ? "成熟度 1–2 の項目はありません。" : "成熟度 1–3 の項目はありません。";
  renderGroupedItemList(el.lowMaturityList, groups, label);
}

function renderUnansweredList() {
  const groups = groupByCategory(QUESTIONS, (q, ans) => {
    return isMissingAnswer(ans) || ans === "na";
  });
  renderGroupedItemList(el.unansweredList, groups, "未回答／不明の項目はありません。");
}

function wireDetailListsUI() {
  if (el.lowMaturityDetails) {
    el.lowMaturityDetails.addEventListener("toggle", () => {
      if (!el.lowMaturityDetails.open) return;
      renderLowMaturityList(el.lowThresholdSelect ? el.lowThresholdSelect.value : "2");
    });
  }
  if (el.lowThresholdSelect) {
    el.lowThresholdSelect.addEventListener("change", () => {
      if (!el.lowMaturityDetails || !el.lowMaturityDetails.open) return;
      renderLowMaturityList(el.lowThresholdSelect.value);
    });
  }
  if (el.unansweredDetails) {
    el.unansweredDetails.addEventListener("toggle", () => {
      if (!el.unansweredDetails.open) return;
      renderUnansweredList();
    });
  }
}



function renderResults() {
  const labels = FUNCTION_ORDER.map(x => `${x.ja}（${x.tag}）`);
  const values = computeRadarValues();
  drawRadar(el.radar, labels, values, { showValues: true });

  const functionStats = computeFunctionStats();
  const top3Cats = selectTop3MaturityCategories(QUESTIONS, answersById);
  const unassessedCats = selectUnassessedCategories(QUESTIONS, answersById);

  const s = buildSummaryData({
    functionStats,
    top3Cats,
    unassessedCats,
    answers: answersById,
    questions: QUESTIONS,
  });
  renderSummary(s);

  renderTop3Categories(top3Cats);

  // Category maturity bars (optional / collapsible)
  try {
    computeCategoryRadarData();
    ensureCategoryBarsControls(CAT_RADAR.lastSelectedFn || s?.weakest?.tag);
    // Render category bars if the section is open (toggle handler is wired once in wireEvents)
    if (el.catBarsDetails && el.catBarsDetails.open) {
      rerenderCategoryBarsFromControls();
    }
  } catch (e) {
    console.error(e);
  }

  // Refresh detail lists if open (useful after import)
  if (el.lowMaturityDetails && el.lowMaturityDetails.open) {
    renderLowMaturityList(el.lowThresholdSelect ? el.lowThresholdSelect.value : "2");
  }
  if (el.unansweredDetails && el.unansweredDetails.open) {
    renderUnansweredList();
  }
}


/* -----------------------------
   Restart
-------------------------------- */
function restart() {
  canReturnToResult = false;
  resultScrollY = 0;
  for (const k of Object.keys(answersById)) delete answersById[k];
  currentIndex = 0;

  if (el.navSearch) {
    el.navSearch.value = "";
    filterNav("");
  }
  refreshNavCounts();
  updateNavActive();
  updateOpenResultButton();
  updateStartButtonState();

  showOnly("intro");
}

/* -----------------------------
   Export: RESULT JSON (existing)
-------------------------------- */
function exportResultJson() {
  const functionStats = computeFunctionStats();
  const radarValues = FUNCTION_ORDER.map(f => {
    const s = functionStats.find(x => x.tag === f.tag);
    return s ? s.avg : 0;
  });

  const top3 = selectTop3MaturityCategories(QUESTIONS, answersById).map(cat => ({
    category: cat.categoryKey,
    category_ja: cat.categoryLabelJa,
    functionTag: cat.functionTag,
    functionJa: cat.functionJa,
    avgMaturity: cat.avgScore,
    coveragePct: cat.coveragePct,
    lowestScore: cat.minScore,
    lowestItems: (cat.minItems || []).map(x => ({
      id: x.q.id,
      answer: x.ans,
    })),
  }));

  const unassessed = selectUnassessedCategories(QUESTIONS, answersById).map(cat => ({
    category: cat.categoryKey,
    category_ja: cat.categoryLabelJa,
    functionTag: cat.functionTag,
    functionJa: cat.functionJa,
  }));

  const s = buildSummaryData({
    functionStats,
    top3Cats: selectTop3MaturityCategories(QUESTIONS, answersById),
    unassessedCats: selectUnassessedCategories(QUESTIONS, answersById),
    answers: answersById,
    questions: QUESTIONS,
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    basis: "NIST CSF 2.0 Subcategory (1:1)",
    maturityOverall: s.overall,
    coveragePct: s.coveragePct,
    radar: FUNCTION_ORDER.map((f, i) => ({
      functionTag: f.tag,
      functionJa: f.ja,
      value: radarValues[i],
    })),
    top3,
    unassessedCategories: unassessed,
    answers: { ...answersById },
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "assessment_result.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}


/* -----------------------------
   Export/Import: SESSION JSON (NEW)
-------------------------------- */
function safePickAnswersForExport() {
  // Export only known keys + known values
  const out = Object.create(null);
  for (const q of QUESTIONS) {
    const v = answersById[q.id];
    if (v === "na" || v === "1" || v === "2" || v === "3" || v === "4" || v === "5") {
      out[q.id] = v;
    }
  }
  return out;
}


function exportSessionJson() {
  if (!Array.isArray(QUESTIONS) || QUESTIONS.length === 0) {
    alert("設問データが読み込まれていないため、保存できません。");
    return;
  }

  const payload = {
    kind: SESSION_KIND,
    version: SESSION_VERSION,
    generatedAt: new Date().toISOString(),
    dataFile: DATA_FILE,
    questionCount: QUESTIONS.length,
    currentIndex,
    answers: safePickAnswersForExport(),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "assessment_session.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function applyImportedSession(session) {
  if (!session || typeof session !== "object") throw new Error("JSONの形式が不正です。");
  if (session.kind !== SESSION_KIND) throw new Error("このツール用のセッションJSONではありません。");
  if (session.version !== SESSION_VERSION) throw new Error(`未対応のversionです（${session.version}）。`);
  if (!session.answers || typeof session.answers !== "object") throw new Error("answersが見つかりません。");

  // Clear current answers first
  for (const k of Object.keys(answersById)) delete answersById[k];

  // Apply only IDs that exist in current QUESTIONS
  const idSet = new Set(QUESTIONS.map(q => q.id));
  for (const [id, ans] of Object.entries(session.answers)) {
    // Convert long id to short id if needed (e.g., "GV.OC-01 - ..." -> "GV.OC-01")
    const shortId = id.split(" - ")[0];
    if (!idSet.has(shortId)) continue;
    if (ans === "na" || ans === "1" || ans === "2" || ans === "3" || ans === "4" || ans === "5") {
      answersById[shortId] = ans;
    }
  }

  // Restore index (clamped). If invalid, resume at first unanswered.
  const idx = Number.isFinite(session.currentIndex) ? session.currentIndex : 0;
  currentIndex = clamp(idx, 0, Math.max(0, QUESTIONS.length - 1));

  // If restored index is already answered and later questions also answered, keep as-is.
  // Otherwise, jump to the first unanswered from the beginning (better UX).
  const firstUnanswered = QUESTIONS.findIndex(q => !answersById[q.id]);
  if (firstUnanswered >= 0) {
    currentIndex = firstUnanswered;
  } else {
    // all answered -> show results view
    currentIndex = clamp(currentIndex, 0, Math.max(0, QUESTIONS.length - 1));
  }

  refreshNavCounts();
  updateNavActive();
  updateOpenResultButton();

  // Navigate
  const allAnswered = QUESTIONS.every(q => Boolean(answersById[q.id]));
  if (allAnswered) {
    renderResults();
    showOnly("result");
  } else {
    showOnly("assess");
    renderQuestion();
  }
}

async function importSessionFile(file) {
  if (!file) return;
  const text = await file.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("JSONのパースに失敗しました（ファイルが壊れている可能性があります）。");
  }
  applyImportedSession(json);
}

/* -----------------------------
   Event wiring
-------------------------------- */
function wireEvents() {
  el.btnStart.addEventListener("click", () => {
    if (el.btnStart.disabled) return;
    showOnly("assess");
    renderQuestion();
  });

  // Optional: require agreeing to disclaimer before starting
  if (el.chkAgree) {
    updateStartButtonState();
    el.chkAgree.addEventListener("change", updateStartButtonState);
  }

  // Header shortcut: open results at any time (when at least one answer exists)
  if (el.btnOpenResult) {
    updateOpenResultButton();
    el.btnOpenResult.addEventListener("click", () => {
      if (el.btnOpenResult.disabled) return;
      canReturnToResult = true;
      resultScrollY = 0;
      renderResults();
      showOnly("result");
      window.scrollTo({ top: 0, behavior: "auto" });
    });
  }

  document.querySelectorAll(".answerChoice").forEach(btn => {
    btn.addEventListener("click", () => {
      setAnswerForCurrent(btn.dataset.answer);
    });
  });

  el.btnNext.addEventListener("click", () => goNext());
  el.btnPrev.addEventListener("click", () => goPrev());

  el.btnRestart.addEventListener("click", () => restart());
  el.btnRestart2.addEventListener("click", () => restart());

  el.btnBackToAssess.addEventListener("click", () => {
    markCameFromResult();
    showOnly("assess");
    renderQuestion();
  });

  // assess -> result (only visible if came from result)
  if (el.btnBackToResult) {
    el.btnBackToResult.addEventListener("click", () => {
      renderResults();
      showOnly("result");
      requestAnimationFrame(() => window.scrollTo({ top: resultScrollY, behavior: "auto" }));
    });
  }

  el.btnExport.addEventListener("click", () => exportResultJson());

  // session export/import
  if (el.btnExportSession) el.btnExportSession.addEventListener("click", () => exportSessionJson());

  if (el.btnImportSession) el.btnImportSession.addEventListener("click", () => {
    if (!el.fileImportSession) return;
    el.fileImportSession.value = ""; // allow re-import same file
    el.fileImportSession.click();
  });

  if (el.fileImportSession) el.fileImportSession.addEventListener("change", async () => {
    const file = el.fileImportSession.files?.[0];
    try {
      await importSessionFile(file);
    } catch (e) {
      console.error(e);
      alert(`読み込みに失敗しました: ${e?.message || e}`);
    }
  });

  // keyboard shortcuts
  window.addEventListener("keydown", (e) => {
    if (VIEWS.assess.hidden) return;
    if (e.key === "ArrowLeft") goPrev();
    if (e.key === "ArrowRight") {
      if (!el.btnNext.disabled) goNext();
    }
    if (e.key === "5") setAnswerForCurrent("5");
    if (e.key === "4") setAnswerForCurrent("4");
    if (e.key === "3") setAnswerForCurrent("3");
    if (e.key === "2") setAnswerForCurrent("2");
    if (e.key === "1") setAnswerForCurrent("1");
    if (e.key === "0" || e.key.toLowerCase() === "n") setAnswerForCurrent("na");
  });

  // detail lists UI (result view)
  wireDetailListsUI();

  // Category bars section (result view) - render on open
  if (el.catBarsDetails) {
    el.catBarsDetails.addEventListener("toggle", () => {
      if (!el.catBarsDetails.open) return;
      rerenderCategoryBarsFromControls();
    });
  }
}

/* -----------------------------
   Boot
-------------------------------- */
async function boot() {
  bindDomRefs();
  showOnly("loading");
  try {
    const res = await fetch(DATA_FILE, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load JSON: ${res.status} ${res.statusText}`);
    QUESTIONS = await res.json();

    if (!Array.isArray(QUESTIONS) || QUESTIONS.length === 0) {
      throw new Error("JSON is empty or invalid array.");
    }

    buildCategoryNav();
    wireEvents();
    updateOpenResultButton();
    updateStartButtonState();
    showOnly("intro");
  } catch (err) {
    console.error(err);
    if (VIEWS?.loading) {
      VIEWS.loading.hidden = false;
      const m = VIEWS.loading.querySelector(".muted");
      if (m) m.textContent =
        `読み込みに失敗しました: ${err?.message || err}. JSONファイル名と配置場所を確認してください。`;
    } else {
      alert(`読み込みに失敗しました: ${err?.message || err}`);
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

