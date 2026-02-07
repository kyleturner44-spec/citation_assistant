// Citation Clerk Simulation — Instructor Dashboard (static, offline)

const store = {
  submissions: [],  // {fileName, payload, metrics}
};

function $(id){ return document.getElementById(id); }

function fmtPP(x){
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  const pp = x*100;
  const sign = pp > 0 ? "+" : "";
  return sign + pp.toFixed(1) + "pp";
}

function fmtPct(x){
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return Math.round(x*100) + "%";
}

function fmtSecFromMs(ms){
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "—";
  return (ms/1000).toFixed(1) + "s";
}

function fmtSec(s){
  if (s === null || s === undefined || Number.isNaN(s)) return "—";
  return Number(s).toFixed(1) + "s";
}

function fmtScore(s){
  if (s === null || s === undefined || Number.isNaN(s)) return "—";
  const n = Math.round(Number(s));
  return n.toLocaleString();
}


function safeGet(obj, path, fallback=null){
  try{
    let cur = obj;
    for (const k of path.split(".")){
      if (cur == null) return fallback;
      cur = cur[k];
    }
    return (cur === undefined) ? fallback : cur;
  } catch { return fallback; }
}

function parseDecisions(payload){
  const events = payload.event_log || payload.events || [];
  return events.filter(e => e && e.type === "decision");
}

function computeMetrics(payload){
  const decisions = parseDecisions(payload);
  const total = decisions.length;

  function assistantCorrectness(d){
    // Prefer explicit fields if present
    if (typeof d.assistant_correct === "boolean") return d.assistant_correct;
    if (typeof d.assistantCorrect === "boolean") return d.assistantCorrect;

    // Infer from recommendation vs ground-truth supports (if available)
    let gt = null;
    if (typeof d.ground_truth_supports === "boolean") gt = d.ground_truth_supports;
    else if (typeof d.groundTruth_supports === "boolean") gt = d.groundTruth_supports;
    else if (d.ground_truth && typeof d.ground_truth.supports === "boolean") gt = d.ground_truth.supports;
    else if (d.groundTruth && typeof d.groundTruth.supports === "boolean") gt = d.groundTruth.supports;

    if (gt === null) return null;

    const recAllow = (d.assistant_flag === "SUPPORTED") ||
                     (d.assistant_recommendation === "ALLOW") ||
                     (d.assistantRecommendation === "ALLOW");
    return recAllow === gt;
  }

  const correct = decisions.reduce((a,d)=>a + (d.correct ? 1:0), 0);
  const acc = total ? correct/total : 0;

  const avgRt = total ? decisions.reduce((a,d)=>a + (d.response_time_ms||0), 0)/total : 0;

  const flagOnly = decisions.reduce((a,d)=> a + ((d.verification && d.verification.flag_only) ? 1:0), 0);
  const flagOnlyRate = total ? flagOnly/total : 0;

  const verified = decisions.reduce((a,d)=>{
    const o = d.verification && d.verification.opened;
    const v = o && (o.meta || o.quote || o.full);
    return a + (v ? 1:0);
  }, 0);
  const verifyRate = total ? verified/total : 0;

  const fullOpen = decisions.reduce((a,d)=> a + ((d.verification && d.verification.opened && d.verification.opened.full) ? 1:0), 0);
  const fullOpenRate = total ? fullOpen/total : 0;

  // Override rate: user decision differs from assistant recommendation implied by assistant_flag
  const overrides = decisions.reduce((a,d)=>{
    const recAllow = (d.assistant_flag === "SUPPORTED");
    const userAllow = (d.user_decision === "ALLOW");
    const ov = (d.assistant_flag !== null && d.assistant_flag !== undefined) ? (recAllow !== userAllow) : false;
    return a + (ov ? 1:0);
  }, 0);
  const overrideRate = total ? overrides/total : 0;

  // Assistant accuracy + value-added calculations (on decisions where ground truth is available)
  let asstKnown = 0, asstCorrect = 0, userCorrectOnKnown = 0;
  let savedFromBadAsst = 0, harmedByBadOverride = 0;

  for (const d of decisions){
    const ac = assistantCorrectness(d);
    if (ac === null) continue;
    asstKnown += 1;
    if (ac) asstCorrect += 1;
    if (d.correct) userCorrectOnKnown += 1;

    // Saved errors: assistant wrong but user correct
    if (!ac && d.correct) savedFromBadAsst += 1;
    // Harm: assistant correct but user wrong (relative to simply following assistant)
    if (ac && !d.correct) harmedByBadOverride += 1;
  }

  const assistantAcc = asstKnown ? (asstCorrect/asstKnown) : null;
  const userAccOnKnown = asstKnown ? (userCorrectOnKnown/asstKnown) : null;
  const lift = (assistantAcc !== null && userAccOnKnown !== null) ? (userAccOnKnown - assistantAcc) : null;
  const savedErrors = savedFromBadAsst - harmedByBadOverride;

  // High-confidence misses: incorrect with assistant_confidence >= 0.9
  const highConfMisses = decisions.reduce((a,d)=>{
    const conf = (d.assistant_confidence ?? 0);
    return a + ((!d.correct && conf >= 0.9) ? 1:0);
  }, 0);

  const byPhase = {};
  for (const p of [1,2,3]){
    const ds = decisions.filter(d=>d.phase===p);
    const t = ds.length;
    const c = ds.reduce((a,d)=>a+(d.correct?1:0),0);
    const a = t ? c/t : null;
    const r = t ? ds.reduce((x,d)=>x+(d.response_time_ms||0),0)/t : null;
    const fo = t ? ds.reduce((x,d)=>x+((d.verification && d.verification.flag_only)?1:0),0)/t : null;
    const vr = t ? ds.reduce((x,d)=>{
      const o = d.verification && d.verification.opened;
      return x + ((o && (o.meta||o.quote||o.full)) ? 1:0);
    },0)/t : null;

    // Assistant accuracy by phase (where known)
    let k=0, ok=0;
    for (const d of ds){
      const ac = assistantCorrectness(d);
      if (ac === null) continue;
      k += 1;
      if (ac) ok += 1;
    }
    const asstA = k ? ok/k : null;

    byPhase[p] = {t, acc:a, avgRt:r, flagOnly:fo, verify:vr, assistantAcc: asstA};
  }

  // Panel time: if available in verification.panel_open_ms
  const panelTimeMs = {summary:0, meta:0, quote:0, full:0};
  for (const d of decisions){
    const pm = safeGet(d, "verification.panel_open_ms", null);
    if (pm){
      for (const k of ["summary","meta","quote","full"]){
        if (typeof pm[k] === "number") panelTimeMs[k] += pm[k];
      }
    }
  }

  // Misses to show: top 3 by assistant confidence
  const misses = decisions.filter(d=>!d.correct);
  misses.sort((a,b)=> (b.assistant_confidence??0) - (a.assistant_confidence??0));
  const topMisses = misses.slice(0,3);


  // Scoring (if present in export summary)
  const sc = safeGet(payload, "summary.scoring", null) || safeGet(payload, "scoring", null) || null;
  const chambersScore = sc ? (sc.chambersScore ?? sc.chambers_score ?? sc.score ?? sc.chambers_score_value ?? null) : null;
  const judgeTimeSeconds = sc ? (sc.judgeTimeSeconds ?? sc.judge_time_seconds ?? sc.judgeTime ?? sc.judge_time ?? null) : null;
  const decisionSeconds = sc ? (sc.decisionSeconds ?? sc.decision_seconds ?? sc.decisionTimeSeconds ?? sc.decision_time_seconds ?? null) : null;
  const errorPenaltySeconds = sc ? (sc.errorPenaltySeconds ?? sc.error_penalty_seconds ?? sc.errorPenalty ?? sc.error_penalty ?? null) : null;
  const highConfPenaltySeconds = sc ? (sc.highConfPenaltySeconds ?? sc.high_conf_penalty_seconds ?? sc.highConfPenalty ?? sc.high_conf_penalty ?? null) : null;

  return {
    total, correct, acc, avgRt,
    flagOnlyRate, verifyRate, fullOpenRate,
    overrideRate, highConfMisses,
    assistantAcc, lift, savedErrors, asstKnown,
    chambersScore, judgeTimeSeconds, decisionSeconds, errorPenaltySeconds, highConfPenaltySeconds,
    byPhase, panelTimeMs,
    topMisses,
  };
}


function mean(arr){
  const xs = arr.filter(x => typeof x === "number" && !Number.isNaN(x));
  if (!xs.length) return null;
  return xs.reduce((a,x)=>a+x,0)/xs.length;
}

function clamp(x, a, b){ return Math.max(a, Math.min(b, x)); }

// --------- Simple canvas charting (no external libs) ---------

function clearCanvas(ctx){
  ctx.clearRect(0,0,ctx.canvas.width, ctx.canvas.height);
}

function drawAxes(ctx, padL, padB, padT, padR){
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.strokeStyle = "rgba(231,234,243,0.25)";
  ctx.lineWidth = 1;
  // x axis
  ctx.beginPath();
  ctx.moveTo(padL, h-padB);
  ctx.lineTo(w-padR, h-padB);
  ctx.stroke();
  // y axis
  ctx.beginPath();
  ctx.moveTo(padL, h-padB);
  ctx.lineTo(padL, padT);
  ctx.stroke();
}

function drawScatter(ctx, points, xLabel, yLabel){
  // points: [{x, y, label}]
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const padL=48, padB=34, padT=18, padR=16;

  clearCanvas(ctx);
  drawAxes(ctx, padL, padB, padT, padR);

  const xs = points.map(p=>p.x), ys = points.map(p=>p.y);
  const xmin = Math.min(...xs, 0), xmax = Math.max(...xs, 1);
  const ymin = Math.min(...ys, 0), ymax = Math.max(...ys, 100);

  function xScale(x){
    const t = (x - xmin) / (xmax - xmin || 1);
    return padL + t * ((w-padR) - padL);
  }
  function yScale(y){
    const t = (y - ymin) / (ymax - ymin || 1);
    return (h-padB) - t * ((h-padB) - padT);
  }

  // labels
  ctx.fillStyle = "rgba(231,234,243,0.65)";
  ctx.font = "12px system-ui";
  ctx.fillText(xLabel, Math.floor((w-padR+padL)/2)-60, h-8);
  ctx.save();
  ctx.translate(12, Math.floor((h-padB+padT)/2)+40);
  ctx.rotate(-Math.PI/2);
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();

  // ticks (simple 3)
  ctx.fillStyle = "rgba(231,234,243,0.45)";
  const xTicks = 3, yTicks=3;
  for (let i=0;i<=xTicks;i++){
    const xt = xmin + (xmax-xmin)*i/xTicks;
    const xpx = xScale(xt);
    ctx.fillRect(xpx, h-padB, 1, 4);
    ctx.fillText(xt.toFixed(1), xpx-10, h-padB+16);
  }
  for (let i=0;i<=yTicks;i++){
    const yt = ymin + (ymax-ymin)*i/yTicks;
    const ypx = yScale(yt);
    ctx.fillRect(padL-4, ypx, 4, 1);
    ctx.fillText(Math.round(yt)+"", 6, ypx+4);
  }

  // points
  for (const p of points){
    const x = xScale(p.x);
    const y = yScale(p.y);
    ctx.beginPath();
    ctx.fillStyle = "rgba(94,234,212,0.85)";
    ctx.arc(x,y,4.5,0,Math.PI*2);
    ctx.fill();
  }
}

function drawBar(ctx, labels, values, yMax, yLabel){
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const padL=48, padB=30, padT=16, padR=16;

  clearCanvas(ctx);
  drawAxes(ctx, padL, padB, padT, padR);

  const vmax = (yMax != null) ? yMax : Math.max(...values, 1);
  const plotW = (w-padR) - padL;
  const plotH = (h-padB) - padT;

  ctx.font = "12px system-ui";
  ctx.fillStyle = "rgba(231,234,243,0.65)";
  ctx.save();
  ctx.translate(12, Math.floor((h-padB+padT)/2)+35);
  ctx.rotate(-Math.PI/2);
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();

  const n = labels.length;
  const gap = 18;
  const barW = (plotW - gap*(n-1)) / n;

  for (let i=0;i<n;i++){
    const v = values[i] ?? 0;
    const t = clamp(v / (vmax || 1), 0, 1);
    const bh = t * plotH;
    const x = padL + i*(barW+gap);
    const y = padT + (plotH - bh);

    ctx.fillStyle = "rgba(167,139,250,0.75)";
    ctx.fillRect(x, y, barW, bh);

    ctx.fillStyle = "rgba(231,234,243,0.55)";
    ctx.fillText(labels[i], x+barW/2-12, h-10);
    ctx.fillText((v*100).toFixed(0)+"%", x+barW/2-14, y-6);
  }
}

function drawGroupedBar(ctx, labels, series, seriesNames, yMax, yLabel){
  // series: [ [v1,v2,v3], [v1,v2,v3] ] in 0..1 range
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const padL=48, padB=30, padT=16, padR=16;

  clearCanvas(ctx);
  drawAxes(ctx, padL, padB, padT, padR);

  const vmax = (yMax != null) ? yMax : 1.0;
  const plotW = (w-padR) - padL;
  const plotH = (h-padB) - padT;

  ctx.font = "12px system-ui";
  ctx.fillStyle = "rgba(231,234,243,0.65)";
  ctx.save();
  ctx.translate(12, Math.floor((h-padB+padT)/2)+35);
  ctx.rotate(-Math.PI/2);
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();

  const n = labels.length;
  const g = series.length;
  const groupGap = 20;
  const barGap = 6;

  const groupW = (plotW - groupGap*(n-1)) / n;
  const barW = (groupW - barGap*(g-1)) / g;

  for (let i=0;i<n;i++){
    for (let j=0;j<g;j++){
      const v = (series[j][i] ?? 0);
      const t = clamp(v / (vmax || 1), 0, 1);
      const bh = t * plotH;

      const x = padL + i*(groupW+groupGap) + j*(barW+barGap);
      const y = padT + (plotH - bh);

      // Use two fixed colors (teal + violet) already used in other charts
      const fill = (j % 2 === 0) ? "rgba(94,234,212,0.78)" : "rgba(167,139,250,0.72)";
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, barW, bh);

      ctx.fillStyle = "rgba(231,234,243,0.55)";
      ctx.font = "11px system-ui";
      ctx.fillText((v*100).toFixed(0)+"%", x + barW/2 - 12, y - 6);
    }
    // label
    ctx.fillStyle = "rgba(231,234,243,0.55)";
    ctx.font = "12px system-ui";
    ctx.fillText(labels[i], padL + i*(groupW+groupGap) + groupW/2 - 12, h-10);
  }

  // legend
  const lx = padL;
  const ly = padT + 6;
  for (let j=0;j<g;j++){
    const fill = (j % 2 === 0) ? "rgba(94,234,212,0.78)" : "rgba(167,139,250,0.72)";
    ctx.fillStyle = fill;
    ctx.fillRect(lx + j*90, ly, 10, 10);
    ctx.fillStyle = "rgba(231,234,243,0.6)";
    ctx.font = "12px system-ui";
    ctx.fillText(seriesNames[j], lx + j*90 + 14, ly+10);
  }
}


function drawLine(ctx, xs, ys, yLabel){
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const padL=48, padB=28, padT=16, padR=16;

  clearCanvas(ctx);
  drawAxes(ctx, padL, padB, padT, padR);

  const xmin = Math.min(...xs, 0), xmax = Math.max(...xs, 1);
  const ymin = 0, ymax = 100;

  function xScale(x){
    const t = (x - xmin) / (xmax - xmin || 1);
    return padL + t * ((w-padR) - padL);
  }
  function yScale(y){
    const t = (y - ymin) / (ymax - ymin || 1);
    return (h-padB) - t * ((h-padB) - padT);
  }

  ctx.fillStyle = "rgba(231,234,243,0.65)";
  ctx.font = "12px system-ui";
  ctx.save();
  ctx.translate(12, Math.floor((h-padB+padT)/2)+35);
  ctx.rotate(-Math.PI/2);
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();

  // line
  ctx.strokeStyle = "rgba(94,234,212,0.85)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i=0;i<xs.length;i++){
    const x = xScale(xs[i]);
    const y = yScale(ys[i]);
    if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.stroke();
}

function drawTimeline(ctx, marks){
  // marks: [{i, type}] where type is "flagonly" | "verified"
  const w = ctx.canvas.width, h = ctx.canvas.height;
  clearCanvas(ctx);

  const pad=16;
  ctx.strokeStyle = "rgba(231,234,243,0.25)";
  ctx.strokeRect(pad, pad, w-2*pad, h-2*pad);

  const n = Math.max(1, marks.length);
  const step = (w-2*pad) / n;

  for (let i=0;i<marks.length;i++){
    const m = marks[i];
    const x = pad + i*step + step/2;
    const y = pad + (h-2*pad)/2;

    ctx.beginPath();
    ctx.fillStyle = (m.type === "flagonly") ? "rgba(255,211,122,0.8)" : "rgba(94,234,212,0.8)";
    ctx.arc(x,y,3.5,0,Math.PI*2);
    ctx.fill();
  }

  ctx.fillStyle = "rgba(231,234,243,0.55)";
  ctx.font = "12px system-ui";
  ctx.fillText("Verified", pad+6, pad+14);
  ctx.fillStyle = "rgba(94,234,212,0.8)";
  ctx.fillRect(pad+70, pad+6, 10, 10);

  ctx.fillStyle = "rgba(231,234,243,0.55)";
  ctx.fillText("Flag-only", pad+100, pad+14);
  ctx.fillStyle = "rgba(255,211,122,0.8)";
  ctx.fillRect(pad+168, pad+6, 10, 10);
}

// --------- UI rendering ---------

function updateKPIs(){
  const ms = store.submissions.map(s=>s.metrics);

  $("kpiN").textContent = store.submissions.length.toString();
  $("kpiAcc").textContent = store.submissions.length ? fmtPct(mean(ms.map(m=>m.acc))) : "—";
  $("kpiRt").textContent  = store.submissions.length ? fmtSecFromMs(mean(ms.map(m=>m.avgRt))) : "—";
  $("kpiFO").textContent  = store.submissions.length ? fmtPct(mean(ms.map(m=>m.flagOnlyRate))) : "—";

  const asstAccMean = mean(ms.map(m=>m.assistantAcc ?? NaN));
  $("kpiAsstAcc").textContent = store.submissions.length ? fmtPct(asstAccMean) : "—";
  $("kpiAsstErr").textContent = store.submissions.length ? fmtPct((asstAccMean==null)? null : (1-asstAccMean)) : "—";
  $("kpiLift").textContent    = store.submissions.length ? fmtPP(mean(ms.map(m=>m.lift ?? NaN))) : "—";

  const scoreMean = mean(ms.map(m=>m.chambersScore ?? NaN));
  const judgeMean = mean(ms.map(m=>m.judgeTimeSeconds ?? NaN));
  const scores = ms.map(m=>m.chambersScore).filter(x=>typeof x==="number" && !Number.isNaN(x));
  const scoreBest = scores.length ? Math.max(...scores) : null;

  $("kpiScoreMean").textContent = store.submissions.length ? fmtScore(scoreMean) : "—";
  $("kpiScoreBest").textContent = store.submissions.length ? fmtScore(scoreBest) : "—";
  $("kpiJudgeMean").textContent = store.submissions.length ? fmtSec(judgeMean) : "—";

  renderTopPerformers();
}



function renderTopPerformers(){
  const list = $("topList");
  if (!list) return;
  list.innerHTML = "";

  const subs = store.submissions
    .filter(s => typeof s.metrics.chambersScore === "number" && !Number.isNaN(s.metrics.chambersScore))
    .slice()
    .sort((a,b)=> (b.metrics.chambersScore - a.metrics.chambersScore));

  const top = subs.slice(0,5);
  if (!top.length){
    const li = document.createElement("li");
    li.textContent = "Load submissions to see rankings.";
    list.appendChild(li);
    return;
  }

  for (const s of top){
    const p = s.payload;
    const alias = safeGet(p, "session.alias", null) || s.fileName.replace(".json","");
    const li = document.createElement("li");
    const score = fmtScore(s.metrics.chambersScore);
    const jt = fmtSec(s.metrics.judgeTimeSeconds);
    li.innerHTML = `${escapeHtml(alias)} — <strong>${score}</strong> <span class="mini">(Judge Time ${jt})</span>`;
    list.appendChild(li);
  }
}

function endBadge(payload){
  const reason = safeGet(payload, "session.end_reason", "") || safeGet(payload, "session.endReason", "") || "";
  if (reason === "time_limit") return `<span class="badge end timed">time limit</span>`;
  if (reason) return `<span class="badge end">${escapeHtml(reason)}</span>`;
  return `<span class="badge end done">completed</span>`;
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderTable(){
  const tbody = $("subTable").querySelector("tbody");
  tbody.innerHTML = "";

  for (let idx=0; idx<store.submissions.length; idx++){
    const s = store.submissions[idx];
    const p = s.payload;
    const m = s.metrics;

    const alias = safeGet(p, "session.alias", null) || safeGet(p, "sessionId", null) || null;
    const aliasShown = alias ? escapeHtml(alias) : escapeHtml(s.fileName.replace(".json",""));

    const sid = escapeHtml(safeGet(p, "session.session_id", "") || safeGet(p, "session.sessionId", "") || "—");
    const total = m.total;
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${aliasShown}</td>
      <td><code>${sid.slice(0,8)}</code></td>
      <td>${endBadge(p)}</td>
      <td>${total}</td>
      <td>${fmtPct(m.acc)}</td>
      <td>${fmtPct(m.assistantAcc)}</td>
      <td>${fmtPP(m.lift)}</td>
      <td>${(m.savedErrors===null||m.savedErrors===undefined)?'—':(m.savedErrors>0?('+'+m.savedErrors):String(m.savedErrors))}</td>
      <td>${fmtScore(m.chambersScore)}</td>
      <td>${fmtSec(m.judgeTimeSeconds)}</td>
      <td>${fmtSec(m.decisionSeconds)}</td>
      <td>${fmtSec(m.errorPenaltySeconds)}</td>
      <td>${fmtSec(m.highConfPenaltySeconds)}</td>
      <td>${fmtSecFromMs(m.avgRt)}</td>
      <td>${fmtPct(m.flagOnlyRate)}</td>
      <td>${fmtPct(m.verifyRate)}</td>
      <td>${fmtPct(m.byPhase[1].acc)}</td>
      <td>${fmtPct(m.byPhase[2].acc)}</td>
      <td>${fmtPct(m.byPhase[3].acc)}</td>
    `;
    row.onclick = () => showDetail(idx);
    tbody.appendChild(row);
  }
}

function renderCharts(){
  // Scatter: avg time (s) vs accuracy (%)
  const pts = store.submissions.map(s=>{
    const alias = safeGet(s.payload, "session.alias", null) || s.fileName;
    return { x: (s.metrics.avgRt||0)/1000, y: (s.metrics.acc||0)*100, label: alias };
  });
  const scatter = $("chartScatter").getContext("2d");
  if (pts.length){
    drawScatter(scatter, pts, "Avg time per citation (s)", "Accuracy (%)");
  } else {
    clearCanvas(scatter);
  }

  // Phase bars (mean across submissions)
  const pUserAcc = [1,2,3].map(p => mean(store.submissions.map(s => s.metrics.byPhase[p].acc ?? NaN)) ?? 0);
  const pAsstAcc = [1,2,3].map(p => mean(store.submissions.map(s => s.metrics.byPhase[p].assistantAcc ?? NaN)) ?? 0);
  const pFO  = [1,2,3].map(p => mean(store.submissions.map(s => s.metrics.byPhase[p].flagOnly ?? NaN)) ?? 0);

  const accCtx = $("chartAccPhase").getContext("2d");
  const foCtx  = $("chartFOPHase").getContext("2d");
  if (store.submissions.length){
    drawGroupedBar(accCtx, ["P1","P2","P3"], [pUserAcc, pAsstAcc], ["User", "Assistant"], 1.0, "Accuracy");
    drawBar(foCtx, ["P1","P2","P3"], pFO, 1.0, "Flag-only rate");
  } else {
    clearCanvas(accCtx); clearCanvas(foCtx);
  }
}


function applySort(){
  const mode = $("sortBy") ? $("sortBy").value : "score_desc";
  const getAlias = (s) => (safeGet(s.payload,"session.alias","") || s.fileName).toLowerCase();

  function numOrNegInf(x){
    return (typeof x === "number" && !Number.isNaN(x)) ? x : -Infinity;
  }

  store.submissions.sort((a,b)=>{
    if (mode === "score_desc"){
      const sa = numOrNegInf(a.metrics.chambersScore);
      const sb = numOrNegInf(b.metrics.chambersScore);
      if (sb !== sa) return sb - sa;
      // tie-break: higher accuracy
      if ((b.metrics.acc||0) !== (a.metrics.acc||0)) return (b.metrics.acc||0) - (a.metrics.acc||0);
      return getAlias(a).localeCompare(getAlias(b));
    }
    if (mode === "accuracy_desc"){
      if ((b.metrics.acc||0) !== (a.metrics.acc||0)) return (b.metrics.acc||0) - (a.metrics.acc||0);
      return getAlias(a).localeCompare(getAlias(b));
    }
    if (mode === "lift_desc"){
      const la = numOrNegInf(a.metrics.lift);
      const lb = numOrNegInf(b.metrics.lift);
      if (lb !== la) return lb - la;
      return getAlias(a).localeCompare(getAlias(b));
    }
    // alias_asc
    return getAlias(a).localeCompare(getAlias(b));
  });
}

function addSubmission(payload, fileName){
  const metrics = computeMetrics(payload);
  store.submissions.push({payload, fileName, metrics});
  applySort();
  refresh();
}

function refresh(){
  updateKPIs();
  renderTable();
  renderCharts();
}

async function handleFiles(fileList){
  const files = Array.from(fileList || []);
  for (const f of files){
    try{
      const txt = await f.text();
      const payload = JSON.parse(txt);
      addSubmission(payload, f.name);
    } catch (e){
      alert(`Could not load ${f.name}: ${e}`);
    }
  }
}

function clearAll(){
  store.submissions = [];
  $("detailCard").style.display = "none";
  refresh();
}

// --------- Detail panel ---------

function rollingAcc(decisions, window=5){
  const ys = [];
  for (let i=0;i<decisions.length;i++){
    const start = Math.max(0, i-window+1);
    const slice = decisions.slice(start, i+1);
    const acc = slice.reduce((a,d)=>a+(d.correct?1:0),0)/slice.length;
    ys.push(acc*100);
  }
  return ys;
}

function showDetail(idx){
  const s = store.submissions[idx];
  const p = s.payload;
  const m = s.metrics;
  const decisions = parseDecisions(p);

  const alias = safeGet(p, "session.alias", null) || s.fileName.replace(".json","");
  $("detailTitle").textContent = `Details — ${alias}`;
  $("detailCard").style.display = "block";

  $("dAcc").textContent = fmtPct(m.acc);
  $("dAsstAcc").textContent = fmtPct(m.assistantAcc);
  $("dLift").textContent = fmtPP(m.lift);
  $("dSaved").textContent = (m.savedErrors===null||m.savedErrors===undefined) ? "—" : (m.savedErrors>0?("+"+m.savedErrors):String(m.savedErrors));
  $("dScore").textContent = fmtScore(m.chambersScore);
  $("dJudgeTime").textContent = fmtSec(m.judgeTimeSeconds);
  $("dDecTime").textContent = fmtSec(m.decisionSeconds);
  $("dErrPen").textContent = fmtSec(m.errorPenaltySeconds);
  $("dHcPen").textContent = fmtSec(m.highConfPenaltySeconds);
  $("dRt").textContent  = fmtSecFromMs(m.avgRt);
  $("dFO").textContent  = fmtPct(m.flagOnlyRate);
  $("dVR").textContent  = fmtPct(m.verifyRate);
  $("dOR").textContent  = fmtPct(m.overrideRate);
  $("dHCM").textContent = String(m.highConfMisses);

  // Running accuracy chart
  const xs = decisions.map((_,i)=>i+1);
  const ys = rollingAcc(decisions, 5);
  drawLine($("chartRunAcc").getContext("2d"), xs, ys, "Running accuracy (%)");

  // Timeline
  const marks = decisions.map((d,i)=>{
    const o = d.verification && d.verification.opened;
    const verified = o && (o.meta||o.quote||o.full);
    return {i:i+1, type: verified ? "verified" : "flagonly"};
  });
  drawTimeline($("chartTimeline").getContext("2d"), marks);

  // Top misses
  const missDiv = $("detailMisses");
  missDiv.innerHTML = "";
  if (!m.topMisses.length){
    missDiv.innerHTML = `<div class="miss"><div class="mini">No misses 🎉</div></div>`;
  } else {
    for (const d of m.topMisses){
      const conf = (d.assistant_confidence ?? 0);
      const phase = d.phase ?? "—";
      const err = d.assistant_error_type || "—";
      const prop = escapeHtml(d.proposition || "(proposition unavailable in log)");
      const cite = escapeHtml(d.citation || "(citation unavailable)");
      const user = d.user_decision || "—";
      const asst = d.assistant_flag || "—";
      const card = document.createElement("div");
      card.className = "miss";
      card.innerHTML = `
        <div class="top">
          <div class="conf">${Math.round(conf*100)}%</div>
          <div class="mini">P${phase} · <code>${escapeHtml(err)}</code></div>
        </div>
        <div class="mini">${cite}</div>
        <div class="prop">${prop}</div>
        <div class="mini" style="margin-top:8px;">Assistant: <code>${escapeHtml(asst)}</code> · You: <code>${escapeHtml(user)}</code></div>
      `;
      missDiv.appendChild(card);
    }
  }

  window.scrollTo({top: $("detailCard").offsetTop - 10, behavior:"smooth"});
}


function hideDetail(){
  $("detailCard").style.display = "none";
}

// --------- Exports ---------

function exportCSV(){
  const rows = [];
  rows.push([
    "file","alias","session_id","end_reason","decisions","user_accuracy","assistant_accuracy","lift","saved_errors","avg_time_s","flag_only_rate","verify_rate","override_rate","high_conf_misses","chambers_score","judge_time_s","decision_time_s","error_penalty_s","high_conf_penalty_s",
    "p1_decisions","p1_acc","p2_decisions","p2_acc","p3_decisions","p3_acc"
  ].join(","));

  for (const s of store.submissions){
    const p = s.payload;
    const m = s.metrics;
    const alias = safeGet(p,"session.alias","") || "";
    const sid = safeGet(p,"session.session_id","") || "";
    const end = safeGet(p,"session.end_reason","") || "";
    const row = [
      s.fileName, alias, sid, end,
      m.total,
      m.acc,
      m.assistantAcc,
      m.lift,
      m.savedErrors,
      (m.avgRt||0)/1000,
      m.flagOnlyRate,
      m.verifyRate,
      m.overrideRate,
      m.highConfMisses,
      m.chambersScore,
      m.judgeTimeSeconds,
      m.decisionSeconds,
      m.errorPenaltySeconds,
      m.highConfPenaltySeconds,
      m.byPhase[1].t, m.byPhase[1].acc ?? "",
      m.byPhase[2].t, m.byPhase[2].acc ?? "",
      m.byPhase[3].t, m.byPhase[3].acc ?? ""
    ].map(x=>{
      if (typeof x === "string"){
        const s = x.replace(/"/g,'""');
        return `"${s}"`;
      }
      return (x === null || x === undefined) ? "" : String(x);
    }).join(",");
    rows.push(row);
  }

  const blob = new Blob([rows.join("\n")], {type:"text/csv"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `citation_clerk_class_summary_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 5000);
}

async function downloadSnapshot(){
  const payloads = store.submissions.map(s=>({fileName:s.fileName, payload:s.payload}));
  const embedded = JSON.stringify(payloads);

  // Inline current CSS + JS so the snapshot is a single shareable file
  let cssText = "";
  let jsText = "";
  try{
    const [cssResp, jsResp] = await Promise.all([
      fetch("styles.css"),
      fetch("dashboard.js")
    ]);
    cssText = await cssResp.text();
    jsText = await jsResp.text();
  } catch (e){
    alert("Could not build snapshot (fetch failed). Serve the dashboard with a local server (python -m http.server).");
    return;
  }

  // Remove any script tags from the current DOM HTML before embedding it
  const cleanBody = document.body.innerHTML
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/>/gi, "");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Citation Clerk Sim — Snapshot</title>
<style>${cssText}</style>
</head>
<body>
<script>
  window.__EMBEDDED_SUBMISSIONS__ = ${embedded};
</script>
${cleanBody}
<script>
${jsText}
</script>
</body>
</html>`;

  const blob = new Blob([html], {type:"text/html"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `citation_clerk_snapshot_${new Date().toISOString().slice(0,10)}.html`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 5000);
}



// --------- Boot ---------

function boot(){
  const dropZone = $("dropZone");
  dropZone.addEventListener("dragover", (e)=>{
    e.preventDefault();
    dropZone.classList.add("dragover");
  });
  dropZone.addEventListener("dragleave", ()=>{
    dropZone.classList.remove("dragover");
  });
  dropZone.addEventListener("drop", async (e)=>{
    e.preventDefault();
    dropZone.classList.remove("dragover");
    await handleFiles(e.dataTransfer.files);
  });

  $("fileInput").addEventListener("change", async (e)=>{
    await handleFiles(e.target.files);
    e.target.value = "";
  });

  $("btnClear").onclick = () => {
    if (confirm("Clear all loaded submissions?")) clearAll();
  };
  $("btnExportCSV").onclick = () => exportCSV();
  $("btnSnapshot").onclick = async () => {
    if (!store.submissions.length){
      alert("Load at least one JSON file first.");
      return;
    }
    await downloadSnapshot();
  };

  
  if ($("sortBy")){
    $("sortBy").addEventListener("change", ()=>{
      applySort();
      refresh();
    });
  }

$("btnCloseDetail").onclick = () => hideDetail();

  // If snapshot has embedded data, auto-load it and hide drop controls.
  if (window.__EMBEDDED_SUBMISSIONS__ && Array.isArray(window.__EMBEDDED_SUBMISSIONS__)){
    for (const s of window.__EMBEDDED_SUBMISSIONS__){
      addSubmission(s.payload, s.fileName || "embedded.json");
    }
    $("dropZone").style.display = "none";
    document.querySelector("header .actions").style.display = "none";
  }

  refresh();
}

window.addEventListener("DOMContentLoaded", boot);
