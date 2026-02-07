
/* Citation Tool Test (no backend)
   - Loads items.json
   - Runs client-side only
   - Persists to localStorage
   - Exports results JSON at end
*/

const STORAGE_KEY = "citation_clerk_sim_v1";

const THEME_KEY = "citation_clerk_theme";
// Test harness: append #test to the URL to print instructor/dev commentary in the console.
const TEST_MODE = (window.location && String(window.location.hash || "").toLowerCase().includes("test"));

function tlog(...args){
  if (!TEST_MODE) return;
  console.log(...args);
}

function describeAssistantIssue(item){
  const et = (item && item.assistant && item.assistant.error_type) ? item.assistant.error_type : null;
  if (!et) return "";
  const meta = item.authority || {};
  const j = meta.jurisdiction || "unknown jurisdiction";
  const lvl = meta.court_level || "unknown court level";

  const base = {
    "JURISDICTION_MISMATCH": "The cited authority is from a different jurisdiction or is non-controlling where the brief treats it as controlling.",
    "NONBINDING_TREATED_AS_BINDING": "The authority is persuasive only (e.g., out-of-circuit or lower court), but the assistant treats it like binding precedent.",
    "CIRCUIT_SPLIT_IGNORED": "The proposition implies a uniform rule, but the authority reflects only one side of a split (or is contested elsewhere).",
    "HOLDING_VS_DICTA": "The quoted language is not the holding (often dicta or background); the holding is narrower than the assistant implies.",
    "LIMITATION_OMITTED": "The authority supports the proposition only under a limitation/exception that the assistant omits."
  }[et] || "The assistant's recommendation does not match the authority's actual support for the proposition.";

  return `${et}: ${base} (court: ${lvl}; tag: ${j}).`;
}


function getCurrentTheme(){
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function applyTheme(theme){
  if (theme === "dark") document.documentElement.setAttribute("data-theme","dark");
  else document.documentElement.removeAttribute("data-theme");
  const btn = document.getElementById("themeToggle");
  if (btn){
    btn.textContent = (theme === "dark") ? "Light mode" : "Dark mode";
    btn.setAttribute("aria-label", (theme === "dark") ? "Switch to light mode" : "Switch to dark mode");
  }
}

function initTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  const theme = (saved === "dark") ? "dark" : "light";
  applyTheme(theme);
  const btn = document.getElementById("themeToggle");
  if (btn){
    btn.onclick = () => {
      const next = (getCurrentTheme() === "dark") ? "light" : "dark";
      localStorage.setItem(THEME_KEY, next);
      applyTheme(next);
    };
  }
}


function $(id){ return document.getElementById(id); }

function nowMs(){ return Date.now(); }

function fmtTime(ms){
  const s = Math.max(0, Math.floor(ms/1000));
  const mm = String(Math.floor(s/60)).padStart(2,'0');
  const ss = String(s%60).padStart(2,'0');
  return `${mm}:${ss}`;
}

function expectedReviewedCount(elapsedMs){
  // Soft target pace for a 20-minute in-class run.
  // Targets: ~12 items by 8m, ~18 by 12m, ~28 by 20m.
  const t = elapsedMs / 60000.0; // minutes
  if (t <= 0) return 0;
  if (t < 8) return 12 * (t / 8);
  if (t < 12) return 12 + 6 * ((t - 8) / 4);
  if (t < 20) return 18 + 10 * ((t - 12) / 8);
  return 28;
}

function decisionEvents(){
  return (state && state.events) ? state.events.filter(e => e.type === "decision") : [];
}

function recentVerifyRate(n){
  const dec = decisionEvents();
  const slice = dec.slice(Math.max(0, dec.length - n));
  if (slice.length === 0) return 0;
  let verified = 0;
  for (const d of slice){
    const o = d.verification && d.verification.opened;
    if (o && (o.meta || o.quote || o.full)) verified += 1;
  }
  return verified / slice.length;
}

function recentFlagOnlyRate(n){
  const dec = decisionEvents();
  const slice = dec.slice(Math.max(0, dec.length - n));
  if (slice.length === 0) return 0;
  let flagOnly = 0;
  for (const d of slice){
    if (d.verification && d.verification.flag_only) flagOnly += 1;
  }
  return flagOnly / slice.length;
}

function recentAccuracyRate(n){
  const dec = decisionEvents();
  const slice = dec.slice(Math.max(0, dec.length - n));
  if (slice.length === 0) return null;
  let correct = 0;
  for (const d of slice){
    if (d.correct) correct += 1;
  }
  return correct / slice.length;
}

function uuidv4(){
  // lightweight UUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random()*16)|0;
    const v = c === "x" ? r : (r&0x3)|0x8;
    return v.toString(16);
  });
}

function seededRng(seedStr){
  // mulberry32 seeded by hash of seedStr
  let h = 1779033703 ^ seedStr.length;
  for (let i=0;i<seedStr.length;i++){
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function(){
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    // convert to [0,1)
    return (h >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng){
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--){
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// App state
let state = null;
let itemBank = null;

// Panel tracking per item
function initPanelStats(){
  return {
    opened: { summary:false, meta:false, quote:false, full:false },
    openMs: { summary:0, meta:0, quote:0, full:0 },
    lastOpenAt: { summary:null, meta:null, quote:null, full:null }
  };
}

function panelOpen(panelKey){
  if (!state || !state.current) return;
  const ps = state.current.panelStats;
  if (!ps.opened[panelKey]) ps.opened[panelKey] = true;
  if (ps.lastOpenAt[panelKey] === null) ps.lastOpenAt[panelKey] = nowMs();
}

function panelClose(panelKey){
  if (!state || !state.current) return;
  const ps = state.current.panelStats;
  const t0 = ps.lastOpenAt[panelKey];
  if (t0 !== null){
    ps.openMs[panelKey] += (nowMs() - t0);
    ps.lastOpenAt[panelKey] = null;
  }
}

function togglePanel(panelKey, panelEl){
  // Some panels are optional depending on the UI layout.
  // If the element is missing (e.g., a quote panel removed), do nothing.
  if (!panelEl) return;
  const isOpen = panelEl.style.display !== "none";
  if (isOpen){
    panelEl.style.display = "none";
    panelClose(panelKey);
  } else {
    panelEl.style.display = "block";
    panelOpen(panelKey);
  }
  saveState();
}

function closeAllPanels(){
  // Force-collapse every expandable panel, regardless of how it was opened.
  // (This avoids edge cases where keyboard activation can leave a panel open
  // across item transitions.)
  const panels = [
    ["summary", $("panelSummary")],
    ["meta", $("panelMeta")],
    // "quote" panel is optional; the pinpoint quote may be shown inline instead.
    ["quote", $("panelQuote")],
    ["full", $("panelFull")]
  ];
  for (const [k, el] of panels){
    // Always close timers even if an element is missing (older builds).
    panelClose(k);
    if (!el) continue;
    el.style.display = "none";
  }
}

function saveState(){
  if (!state) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function clearSaved(){
  localStorage.removeItem(STORAGE_KEY);
}

function setScreen(name){
  $("screenIntro").style.display = name==="intro" ? "block" : "none";
  $("screenMain").style.display = name==="main" ? "block" : "none";
  $("screenResults").style.display = name==="results" ? "block" : "none";
}

function setTopbarVisible(visible){
  // keep topbar always, but hide pills on intro
  $("countdownPill").style.display = visible ? "inline-flex" : "none";
  $("progressPill").style.display = visible ? "inline-flex" : "none";
}

function showRivalFinder(durationMs=1300){
  // Small UX flourish: a 1–2 second overlay before the sprint begins.
  const el = $("rivalFinder");
  if (!el) return Promise.resolve();
  el.style.display = "flex";
  el.setAttribute("aria-hidden","false");
  return new Promise(resolve => {
    setTimeout(() => {
      el.style.display = "none";
      el.setAttribute("aria-hidden","true");
      resolve();
    }, durationMs);
  });
}

function computePhase(){
  // Time-based phases within a fixed 20-minute session.
  // Phase 1: trust-building (0-8m)
  // Phase 2: reliance lock-in (8-12m)
  // Phase 3: domain shift (12-20m)
  const elapsed = nowMs() - state.startedAt;
  if (elapsed < 8 * 60 * 1000) return 1;
  if (elapsed < 12 * 60 * 1000) return 2;
  return 3;
}

function rivalPaceSeconds(phase){
  // lower seconds = faster rival
  const base = (phase === 1) ? 7.0 : (phase === 2 ? 5.2 : 4.8);

  // Adaptive pressure: speed up rival if user is behind a soft target pace,
  // slow down if user is ahead or heavily verifying (to avoid panicky behavior).
  const elapsedMs = nowMs() - state.startedAt;
  const expected = expectedReviewedCount(elapsedMs);
  const behind = expected - state.completedIds.length;

  const verifyRate = recentVerifyRate(10); // 0..1 (opened authority/quote/full)
  let adj = 0;

  if (behind > 2) adj -= Math.min(0.9, behind * 0.12); // rival faster
  if (behind < -2) adj += Math.min(0.9, Math.abs(behind) * 0.10); // rival slower

  // If user is verifying a lot, ease off slightly to keep them engaged.
  if (verifyRate > 0.65) adj += 0.35;

  return Math.max(3.6, base + adj);
}

function updateRival(){
  if (!state || state.status !== "running") return;
  const elapsed = nowMs() - state.startedAt;
  const phase = computePhase();
  const pace = rivalPaceSeconds(phase);
  const rivalReviewed = Math.floor((elapsed/1000) / pace);
  $("rivalReviewed").textContent = String(rivalReviewed);
  $("youReviewed").textContent = String(state.completedIds.length);

  const gap = rivalReviewed - state.completedIds.length;
  let msg = "";
  if (gap >= 3) msg = `Behind by ${gap} citations`;
  else if (gap <= -3) msg = `Ahead by ${Math.abs(gap)} citations`;
  else msg = `Close — ${gap===0 ? "tied" : (gap>0 ? "slightly behind" : "slightly ahead")}`;
  $("gapText").textContent = msg;

  const total = state.orderedIds.length;
  const youPct = Math.min(100, (state.completedIds.length / total) * 100);
  const themPct = Math.min(100, (rivalReviewed / total) * 100);
  $("rivalBarYou").style.width = youPct + "%";
  $("rivalBarThem").style.width = themPct + "%";
}


function updatePhaseHintAdaptive(){
  if (!state || state.status !== "running") return;

  // Throttle hint updates to avoid distracting flicker.
  const t = nowMs();
  if (state._lastHintAt && (t - state._lastHintAt) < 900) return;
  state._lastHintAt = t;

  const phase = computePhase();
  const elapsedMs = t - state.startedAt;
  const expected = expectedReviewedCount(elapsedMs);
  const gap = state.completedIds.length - expected; // positive = ahead, negative = behind

  const verifyRate = recentVerifyRate(10);
  const flagOnlyRate = recentFlagOnlyRate(10);
  const acc = recentAccuracyRate(6);

  let msg = "";
  if (phase === 1){
    msg = "Segment 1: Establish a steady pace on straightforward citations.";
    if (gap < -1){ msg += " You are behind pace—consider quicker triage."; }
  } else if (phase === 2){
    msg = "Segment 2: Pace pressure increases—open details selectively on close calls.";
    if (gap < -1){ msg += " Rival pace is ahead—prioritize throughput."; }
  } else {
    msg = "Segment 3: Citations become more nuanced—slow down when uncertain and check context.";
    if (acc !== null && acc < 0.75){ msg += " Accuracy is dipping—consider opening Authority or the Full excerpt more often."; }
    if (flagOnlyRate > 0.80){ msg += " Consider a quick Authority check before approving nonbinding citations."; }
  }

  if (gap < -2.5){
    msg += " Rival pace: ahead of you.";
  } else if (gap > 2.5){
    msg += " You’re ahead—take the time you need.";
  } else if (Math.abs(gap) <= 0.8){
    msg += " Pace: roughly on track.";
  }

  $("phaseHint").textContent = msg;
}


function updateCountdown(){
  if (!state || state.status !== "running") return;
  const remaining = Math.max(0, state.endsAt - nowMs());
  $("countdown").textContent = fmtTime(remaining);
  if (remaining <= 0){
    finishSession("time");
  }
}

function setProgressUI(){
  $("reviewedCount").textContent = String(state.completedIds.length);
  $("totalCount").textContent = String(state.orderedIds.length);
}

function renderCurrentItem(){
  // Defensive: ensure no expandable content from the prior item remains visible.
  closeAllPanels();

  const itemId = state.current.itemId;
  const item = itemBank.byId[itemId];

  // Test mode: log phase + item details and the actual right answer.
  if (TEST_MODE){
    const phaseNow = (state && state.startedAt) ? computePhase() : (item.phase || "?");
    if (state && state._testLastPhase !== phaseNow){
      tlog(`\n[TEST] ===== Entering Phase ${phaseNow} (time-based) =====`);
      state._testLastPhase = phaseNow;
    }
    const correctDecision = item.ground_truth.supports ? "ALLOW" : "REJECT";
    const assistantDecision = (item.assistant.flag === "SUPPORTED") ? "ALLOW" : "REJECT";
    const assistantCorrect = (assistantDecision === correctDecision);
    const confPct = Math.round((item.assistant.confidence || 0) * 100);
    tlog("===================");
    tlog(`[TEST] PhaseNow=${phaseNow} • Item=${item.id} (bank phase=${item.phase})`);
    tlog(`[TEST] Ground truth: ${item.ground_truth.supports ? "SUPPORTED" : "NOT SUPPORTED"} → Correct action: ${correctDecision}`);
    tlog(`[TEST] Assistant: ${item.assistant.flag} @ ${confPct}% → Would ${assistantDecision} • ${assistantCorrect ? "assistant correct" : "assistant WRONG"}`);
    if (!assistantCorrect){
      const why = (item.ground_truth && item.ground_truth.reason) ? item.ground_truth.reason : "(no ground-truth reason provided)";
      const extra = describeAssistantIssue(item);
      tlog(`[TEST] Why assistant is wrong: ${extra} Ground-truth note: ${why}`);
    }
  }

  $("propText").textContent = item.proposition;
  $("citeText").textContent = item.citation;

  // assistant
  const flag = item.assistant.flag;
  const conf = item.assistant.confidence;
  $("assistFlag").textContent = (flag === "SUPPORTED") ? "SUPPORTED" : "NOT SUPPORTED";
  $("assistFlag").className = "flag " + ((flag === "SUPPORTED") ? "good" : "bad");
  $("assistConf").textContent = Math.round(conf*100) + "%";
  $("confFill").style.width = Math.round(conf*100) + "%";

  $("assistSummary").textContent = item.assistant.summary || "—";
  $("pinpointQuote").textContent = item.evidence.quote || "—";
  $("assistFullMeta").textContent = item.evidence.full_source || "—";
  $("assistFull").textContent = item.evidence.full_excerpt || "—";

  const meta = item.authority;
  const metaText = [
    `Court level: ${meta.court_level}`,
    `Jurisdiction tag: ${meta.jurisdiction}`,
    `Binding here: ${meta.binding ? "Yes" : "No / persuasive only"}`
  ].join("\n");
  $("assistMeta").textContent = metaText;

  closeAllPanels();

  updatePhaseHintAdaptive();

  setProgressUI();

  // Keep the fast-flow keyboard path predictable: Enter activates “Allow citation”.
  // This also prevents Enter from re-triggering a detail toggle on the next item.
  setTimeout(() => {
    const b = $("btnAllow");
    if (b) b.focus();
  }, 0);
}

function enforcePhaseSkips(targetPhase){
  // If we've entered a later time-based phase, skip any leftover earlier-phase items
  // so students reliably experience the domain shift.
  if (!state.skippedIds) state.skippedIds = [];
  for (const id of state.orderedIds){
    if (state.completedIds.includes(id) || state.skippedIds.includes(id)) continue;
    const it = itemBank.byId[id];
    if (!it) continue;
    if (it.phase < targetPhase){
      state.skippedIds.push(id);
      state.events.push({ t: nowMs(), type: "item_skipped_for_phase", item_id: id, item_phase: it.phase, target_phase: targetPhase });
      tlog(`[TEST] Skipped item for phase enforcement: ${id} (bank phase=${it.phase}) -> target phase=${targetPhase}`);
    } else {
      // because orderedIds are grouped by phase, we can stop once we hit current/later phase
      break;
    }
  }
}

function nextItem(){
  // Ensure nothing from a previous item stays expanded when transitioning.
  closeAllPanels();
  const phaseNow = computePhase();
  enforcePhaseSkips(phaseNow);

  const remaining = state.orderedIds.filter(id =>
    !state.completedIds.includes(id) && !(state.skippedIds && state.skippedIds.includes(id))
  );

  if (remaining.length === 0){
    finishSession("done");
    return;
  }

  // Prefer items that match the current time-based phase.
  let itemId = remaining.find(id => itemBank.byId[id] && itemBank.byId[id].phase === phaseNow);
  if (!itemId) itemId = remaining[0];

  state.current = {
    itemId,
    shownAt: nowMs(),
    phaseShown: phaseNow,
    panelStats: initPanelStats()
  };
  renderCurrentItem();
  saveState();
}

function decide(decision){
  const cur = state.current;
  if (!cur) return;
  const item = itemBank.byId[cur.itemId];

  // close any open panels and accumulate time
  panelClose("summary");
  panelClose("meta");
  panelClose("quote");
  panelClose("full");

  // Immediately collapse UI panels so nothing stays expanded between items.
  // (The next item render also collapses, but this prevents visual carry-over.)
  closeAllPanels();

  const decisionAt = nowMs();
  const rtMs = decisionAt - cur.shownAt;

  const userSupports = (decision === "ALLOW" || decision === "SKIP");
  const correct = (userSupports === item.ground_truth.supports);

  const usedAnyPanel = cur.panelStats.opened.summary || cur.panelStats.opened.meta || cur.panelStats.opened.quote || cur.panelStats.opened.full;
  const flagOnly = !usedAnyPanel;

  const assistantSupports = (item.assistant.flag === "SUPPORTED");
  const assistantCorrect = (assistantSupports === item.ground_truth.supports);
  const overrodeAssistant = (userSupports !== assistantSupports);

  state.events.push({
    t: decisionAt,
    type: "decision",
    item_id: item.id,
    phase: item.phase,
    phase_experienced: computePhase(),
    phase_shown: cur.phaseShown || null,
    decision,
    response_time_ms: rtMs,
    user_supports: userSupports,
    correct,
    ground_truth_supports: item.ground_truth.supports,
    assistant_flag: item.assistant.flag,
    assistant_confidence: item.assistant.confidence,
    assistant_correct: assistantCorrect,
    overrode_assistant: overrodeAssistant,
    verification: {
      flag_only: flagOnly,
      opened: cur.panelStats.opened,
      open_time_ms: cur.panelStats.openMs
    }
  });


  // Test mode: log running scoring + correctness after each decision.
  if (TEST_MODE){
    const res = aggregateResults(state.events);
    const n = res.total;
    const sc = res.scoring || {};
    const confPct = Math.round((item.assistant.confidence || 0) * 100);
    tlog(`[TEST] → Decision #${n} on ${item.id}: you=${decision} • correct=${correct ? "YES" : "NO"} • GT=${item.ground_truth.supports ? "SUPPORTED" : "NOT SUPPORTED"} • asst=${item.assistant.flag} @ ${confPct}%`);
    if (!assistantCorrect){
      tlog(`[TEST]   Assistant wrong type: ${(item.assistant && item.assistant.error_type) ? item.assistant.error_type : "—"} • ${describeAssistantIssue(item)}`);
    }
    tlog(`[TEST]   Running: acc=${Math.round(res.acc*100)}% • errors=${res.errors} • highConfMisses=${res.highConfMisses}`);
    tlog(`[TEST]   JudgeTime=${sc.judgeTimeSeconds.toFixed(1)}s = decision ${sc.decisionSeconds.toFixed(1)} + errorPen ${sc.errorPenaltySeconds.toFixed(1)} + highConfPen ${sc.highConfPenaltySeconds.toFixed(1)} • ChambersScore=${sc.chambersScore}`);
  }

  state.completedIds.push(item.id);
  state.current = null;

  saveState();

  // update UI / phase - reorder not needed
  $("reviewedCount").textContent = String(state.completedIds.length);
  $("youReviewed").textContent = String(state.completedIds.length);

  // If time is up, end; else continue
  if (nowMs() >= state.endsAt){
    finishSession("time");
  } else {
    nextItem();
  }
}

function aggregateResults(events){
  const decisions = events.filter(e => e.type==="decision");
  const total = decisions.length;
  const correct = decisions.filter(d=>d.correct).length;
  const acc = total ? correct/total : 0;
  const totalRtMs = decisions.reduce((a,d)=>a+(d.response_time_ms||0),0);
  const avgRt = total ? totalRtMs/total : 0;
  const errors = total - correct;

  const flagOnly = decisions.filter(d=>d.verification.flag_only).length;
  const flagOnlyRate = total ? flagOnly/total : 0;

  function openFlags(d){
    const o = (d.verification && d.verification.opened) ? d.verification.opened : {};
    return {
      summary: !!o.summary,
      meta: !!o.meta,
      full: !!o.full,
      // "quote" exists in older builds; ignore it for metrics
    };
  }

  function phaseAgg(p){
    const ds = decisions.filter(d=>d.phase===p);
    const t = ds.length;
    const c = ds.filter(d=>d.correct).length;
    const a = t ? c/t : 0;
    const r = t ? ds.reduce((x,d)=>x+d.response_time_ms,0)/t : 0;

    let fo = 0, sum = 0, meta = 0, full = 0;
    for (const d of ds){
      const o = openFlags(d);
      if (d.verification && d.verification.flag_only) fo += 1;
      if (o.summary) sum += 1;
      if (o.meta) meta += 1;
      if (o.full) full += 1;
    }

    const forate = t ? fo/t : 0;
    const summaryRate = t ? sum/t : 0;
    const metaRate = t ? meta/t : 0;
    const fullRate = t ? full/t : 0;
    // "Verified" here means they opened authority details and/or primary excerpt.
    const verifyRate = t ? (ds.reduce((x,d)=>{
      const o = openFlags(d);
      return x + ((o.meta || o.full) ? 1 : 0);
    },0)/t) : 0;

    // "Assistant-only" means they opened summary but did not open meta or full.
    const assistantOnlyRate = t ? (ds.reduce((x,d)=>{
      const o = openFlags(d);
      return x + ((o.summary && !o.meta && !o.full) ? 1 : 0);
    },0)/t) : 0;

    return { t, a, r, forate, summaryRate, metaRate, fullRate, verifyRate, assistantOnlyRate };
  }

  const p1 = phaseAgg(1), p2 = phaseAgg(2), p3 = phaseAgg(3);

  // Error patterns
  const highConfMisses = decisions.filter(d => !d.correct && (d.assistant_confidence ?? 0) >= 0.9).length;
  const phase3HighConfMisses = decisions.filter(d => d.phase===3 && !d.correct && (d.assistant_confidence ?? 0) >= 0.9).length;
  const flagOnlyMisses = decisions.filter(d => !d.correct && d.verification && d.verification.flag_only).length;
  const phase3FlagOnlyMisses = decisions.filter(d => d.phase===3 && !d.correct && d.verification && d.verification.flag_only).length;

  // Scoring (Option A): Judge Time = decision time + penalties.
  // Penalties are applied only after the run, once correctness is checked.
  const decisionSeconds = totalRtMs / 1000;
  const errorPenaltySeconds = (errors <= 2) ? (errors * 15) : (2 * 15 + (errors - 2) * 30);
  const highConfPenaltySeconds = highConfMisses * 10;
  const judgeTimeSeconds = decisionSeconds + errorPenaltySeconds + highConfPenaltySeconds;
  // Convert to a higher-is-better score.
  // Use a smooth, non-negative curve so "very bad" runs still get a non-zero score,
  // while better runs separate clearly.
  // Score range is approximately 0–10,000.
  const chambersScore = Math.max(0, Math.round(10000 * Math.exp(-judgeTimeSeconds / 600)));

  // Misses with high assistant confidence
  const misses = decisions.filter(d=>!d.correct);
  const missesSorted = misses.sort((a,b)=> (b.assistant_confidence - a.assistant_confidence));
  const replays = missesSorted.slice(0,3).map(d=>{
    const item = itemBank.byId[d.item_id];
    return { decision:d, item };
  });

  return {
    total, correct, errors, acc, avgRt, totalRtMs,
    flagOnlyRate,
    phases:{1:p1,2:p2,3:p3},
    highConfMisses,
    phase3HighConfMisses,
    flagOnlyMisses,
    phase3FlagOnlyMisses,
    scoring: {
      decisionSeconds,
      errorPenaltySeconds,
      highConfPenaltySeconds,
      judgeTimeSeconds,
      chambersScore
    },
    replays
  };
}

function fmtPct(x){
  if (x === null || x === undefined) return "—";
  return Math.round(x*100) + "%";
}

function fmtPP(delta){
  if (delta === null || delta === undefined || Number.isNaN(delta)) return "—";
  const pp = Math.round(delta*100);
  return (pp>=0? "+" : "") + pp + "pp";
}

function fmtSec(ms){
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "—";
  return (ms/1000).toFixed(1) + "s";
}

function weightedMean(a, aw, b, bw){
  const w = (aw||0) + (bw||0);
  if (!w) return 0;
  return ((a||0)*(aw||0) + (b||0)*(bw||0)) / w;
}

function diagnoseAutomationBias(results){
  const p1 = results.phases[1], p2 = results.phases[2], p3 = results.phases[3];
  const baselineAcc = Math.max(p1.a, p2.a);
  const accDrop = p3.a - baselineAcc; // negative if worse in P3

  const baseFO = weightedMean(p1.forate, p1.t, p2.forate, p2.t);
  const baseFull = weightedMean(p1.fullRate, p1.t, p2.fullRate, p2.t);
  const foShift = p3.forate - baseFO;
  const fullShift = p3.fullRate - baseFull;

  // Heuristics: designed for classroom feedback, not clinical diagnosis.
  const enoughP3 = p3.t >= 6;

  let level = "unlikely";
  if (enoughP3){
    const strongAccDrop = accDrop <= -0.12;
    const moderateAccDrop = accDrop <= -0.07;
    const highFO = p3.forate >= 0.65 || foShift >= 0.12;
    const lowFull = p3.fullRate <= 0.20 || fullShift <= -0.10;
    const confMiss = results.phase3HighConfMisses >= 1;

    if (strongAccDrop && highFO && lowFull && confMiss){
      level = "likely";
    } else if (moderateAccDrop && (highFO || lowFull || confMiss)){
      level = "maybe";
    }
  }

  return {
    level,
    accDrop,
    foShift,
    fullShift,
    baselineAcc,
    baseFO,
    baseFull,
    enoughP3
  };
}

function renderResults(){
  const results = aggregateResults(state.events);

  // Score summary (shown first)
  const sc = results.scoring;
  if ($("scoreSummary")){
    $("scoreSummary").innerHTML = `
      <div class="callout-title">Chambers Score: ${sc.chambersScore.toLocaleString()}</div>
      <p><strong>Judge Time:</strong> ${sc.judgeTimeSeconds.toFixed(1)}s</p>
      <ul>
        <li>Decision time: ${sc.decisionSeconds.toFixed(1)}s</li>
        <li>Error penalties: +${sc.errorPenaltySeconds.toFixed(1)}s (${results.errors} errors)</li>
        <li>High-confidence penalties: +${sc.highConfPenaltySeconds.toFixed(1)}s (${results.highConfMisses} high-confidence misses)</li>
      </ul>
      <p class="small">Your score is finalized here (not during the sprint) because it requires checking correctness and applying penalties.</p>
    `;
  }

  $("statAccuracy").textContent = Math.round(results.acc*100) + "%";
  $("statAvgTime").textContent = (results.avgRt/1000).toFixed(1) + "s";
  $("statFlagOnly").textContent = Math.round(results.flagOnlyRate*100) + "%";

  const tableHtml = `
    <table class="table">
      <thead>
        <tr>
          <th>Phase</th>
          <th>Items</th>
          <th>Accuracy</th>
          <th>Avg time</th>
          <th>Flag-only</th>
          <th>Opened full excerpt</th>
        </tr>
      </thead>
      <tbody>
        ${[1,2,3].map(p=>{
          const ph = results.phases[p];
          return `<tr>
            <td>${p}</td>
            <td>${ph.t}</td>
            <td>${Math.round(ph.a*100)}%</td>
            <td>${(ph.r/1000).toFixed(1)}s</td>
            <td>${Math.round(ph.forate*100)}%</td>
            <td>${Math.round(ph.fullRate*100)}%</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  `;
  $("phaseTable").innerHTML = tableHtml;

  // Assessment
  const d = diagnoseAutomationBias(results);
  const p1 = results.phases[1], p2 = results.phases[2], p3 = results.phases[3];
  const acc1 = p1.a, acc2 = p2.a, acc3 = p3.a;
  const fo1 = p1.forate, fo2 = p2.forate, fo3 = p3.forate;
  const full1 = p1.fullRate, full2 = p2.fullRate, full3 = p3.fullRate;

  let calloutClass = "callout";
  let headline = "";
  let verdictLine = "";
  if (!d.enoughP3){
    calloutClass += " warn";
    headline = "Incomplete signal";
    verdictLine = "You didn't complete enough Phase 3 items to make a confident call. The patterns below are still informative.";
  } else if (d.level === "likely"){
    calloutClass += " bad";
    headline = "You likely fell victim to automation bias";
    verdictLine = "Your performance suggests you kept relying on the assistant as the task got harder, without increasing verification.";
  } else if (d.level === "maybe"){
    calloutClass += " warn";
    headline = "You may have fallen victim to automation bias";
    verdictLine = "Your Phase 3 performance dipped and your verification habits suggest partial overreliance.";
  } else {
    calloutClass += " good";
    headline = "No clear evidence of automation bias";
    verdictLine = "Your results suggest you stayed relatively calibrated (you maintained accuracy and/or increased verification when conditions shifted).";
  }

  const biasBullets = [
    `Accuracy: ${fmtPct(acc1)} (P1) → ${fmtPct(acc2)} (P2) → ${fmtPct(acc3)} (P3)`,
    `Flag-only: ${fmtPct(fo1)} (P1) → ${fmtPct(fo2)} (P2) → ${fmtPct(fo3)} (P3)`,
    `Opened full excerpt: ${fmtPct(full1)} (P1) → ${fmtPct(full2)} (P2) → ${fmtPct(full3)} (P3)`,
    `High-confidence misses (assistant ≥90% confident): ${results.phase3HighConfMisses} in Phase 3 (${results.highConfMisses} total)`,
    `Misses made with flag-only verification: ${results.phase3FlagOnlyMisses} in Phase 3 (${results.flagOnlyMisses} total)`
  ];

  $("biasAssessment").className = calloutClass;
  $("biasAssessment").innerHTML = `
    <div class="callout-title">${headline}</div>
    <p>${escapeHtml(verdictLine)}</p>
    <ul>${biasBullets.map(b=>`<li>${escapeHtml(b)}</li>`).join("")}</ul>
  `;

  // Narrative explanation pointing to their data
  const phaseShiftLine = `Your accuracy changed by ${fmtPP(p2.a - p1.a)} from Phase 1 → 2, then ${fmtPP(p3.a - p2.a)} from Phase 2 → 3.`;
  const relianceLine = `Your flag-only rate changed by ${fmtPP(p2.forate - p1.forate)} (P1→P2) and ${fmtPP(p3.forate - p2.forate)} (P2→P3).`;
  const fullLine = `Your full-excerpt reads changed by ${fmtPP(p2.fullRate - p1.fullRate)} (P1→P2) and ${fmtPP(p3.fullRate - p2.fullRate)} (P2→P3).`;

  let narrative = `
    <p><strong>Automation bias</strong> is a tendency to over-rely on a decision aid — especially under time pressure — leading to <em>commission errors</em> (accepting incorrect recommendations) and <em>omission errors</em> (failing to notice problems because the system signaled “all clear”).</p>
    <p>In this simulation, the assistant was highly reliable early, then the legal context shifted in Phase 3 toward authority-weighting pitfalls (nonbinding authorities, jurisdiction mismatches, circuit splits) while the assistant remained confident. The point is to see whether you adjusted your verification habits when the environment changed.</p>
    <p><strong>What your data shows:</strong> ${escapeHtml(phaseShiftLine)} ${escapeHtml(relianceLine)} ${escapeHtml(fullLine)}</p>
  `;

  if (d.level === "likely"){
    narrative += `<p><strong>Interpretation:</strong> The combination of a Phase 3 accuracy drop and continued low verification suggests classic overreliance: you treated the assistant as a substitute for checking, rather than a cue to check.</p>`;
  } else if (d.level === "maybe"){
    narrative += `<p><strong>Interpretation:</strong> Your results are mixed: some signs of overreliance, but also some adjustment. Compare your results with classmates — you may find that small verification differences drive big accuracy differences in Phase 3.</p>`;
  } else {
    narrative += `<p><strong>Interpretation:</strong> You appear to have stayed calibrated. Even so, wait to see how the class did — Phase 3 is designed to punish “trust inertia,” and the distribution of outcomes is part of the lesson.</p>`;
  }

  $("biasNarrative").innerHTML = narrative;

  // Jagged frontier framing (Mollick et al.)
  $("biasNarrative").innerHTML += `
    <p><strong>Jagged frontier note:</strong> A key takeaway is that the assistant didn’t just “get worse” randomly — it became less reliable after the context shifted. This mirrors what Ethan Mollick and co-authors call the AI “jagged frontier”: systems can be highly capable in one pocket of work but surprisingly unreliable on a nearby-looking task. In this simulation, early items emphasized more uniform, binding authority; later items introduced authority hierarchy, jurisdiction, and splits, where the assistant’s mistakes were more likely — and often overconfident.</p>
    <p><strong>Don’t overcorrect:</strong> After being burned, people sometimes swing to the opposite extreme — <em>algorithm aversion</em> — avoiding the tool even when it is helpful. A practical goal is <em>calibration</em>: use the assistant for throughput, but selectively verify in the “jagged” areas where errors are concentrated. Of course, this is easier said than done. ;)</p>
  `;


  // Phase shift breakdown
  const shiftsHtml = `
    <div><strong>Shifts between phases</strong></div>
    <ul>
      <li><strong>P1 → P2:</strong> accuracy ${fmtPP(p2.a - p1.a)}, avg time ${fmtSec(p2.r - p1.r)}, flag-only ${fmtPP(p2.forate - p1.forate)}, full excerpt ${fmtPP(p2.fullRate - p1.fullRate)}</li>
      <li><strong>P2 → P3:</strong> accuracy ${fmtPP(p3.a - p2.a)}, avg time ${fmtSec(p3.r - p2.r)}, flag-only ${fmtPP(p3.forate - p2.forate)}, full excerpt ${fmtPP(p3.fullRate - p2.fullRate)}</li>
    </ul>
    <div class="small">Tip for discussion: in Phase 3, even modest increases in full-excerpt reading can have outsized accuracy effects.</div>
  `;
  const elShifts = $("phaseShifts");
  if (elShifts) elShifts.innerHTML = shiftsHtml;

  // Replay cards
  if (results.replays.length === 0){
    $("replayList").innerHTML = `<div class="small">No misses — nice work.</div>`;
  } else {
    $("replayList").innerHTML = results.replays.map(({decision, item})=>{
      const badge = decision.assistant_flag==="SUPPORTED" ? "good" : "bad";
      const truthBadge = item.ground_truth.supports ? "good" : "bad";
      return `
        <div class="replay">
          <div class="kicker">Item ${item.id} · Phase ${item.phase}</div>
          <div class="small"><strong>Proposition:</strong> ${escapeHtml(item.proposition)}</div>
          <div class="small"><strong>Citation:</strong> <span class="mono">${escapeHtml(item.citation)}</span></div>
          <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
            <span class="badge ${badge}">Assistant: ${decision.assistant_flag} (${Math.round(decision.assistant_confidence*100)}%)</span>
            <span class="badge ${truthBadge}">Ground truth: ${item.ground_truth.supports ? "SUPPORTED" : "NOT SUPPORTED"}</span>
            <span class="badge">Your decision: ${decision.decision}</span>
            <span class="badge">Flag-only: ${decision.verification.flag_only ? "Yes" : "No"}</span>
          </div>
          <div class="divider"></div>
          <div class="small"><strong>Why it’s wrong:</strong> ${escapeHtml(item.ground_truth.reason)}</div>
          <div class="small" style="margin-top:6px;"><strong>Key excerpt:</strong></div>
          <div class="panel-body quote">${escapeHtml(item.evidence.quote || "(no quote)")}</div>
          ${item.assistant.error_type ? `<div class="small" style="margin-top:8px; color:var(--muted);">Error type tag: <span class="mono">${item.assistant.error_type}</span></div>` : ""}
        </div>
      `;
    }).join("");
  }

  // attach export handlers
  $("btnDownload").onclick = () => downloadResults();
  $("btnCopy").onclick = () => copyResults();
  $("btnRestart").onclick = () => { clearSaved(); window.location.reload(); };
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function buildExportPayload(){
  const results = aggregateResults(state.events);
  return {
    app: {
      name: "citation-clerk-sim",
      version: itemBank.version || "unknown"
    },
    exported_at: new Date().toISOString(),
    session: {
      session_id: state.sessionId,
      alias: state.alias || null,
      started_at: new Date(state.startedAt).toISOString(),
      ended_at: new Date(state.endedAtActual || nowMs()).toISOString(),
      end_reason: state.endReason || null,
      duration_ms_planned: state.endsAt - state.startedAt,
      duration_ms_actual: (state.endedAtActual || nowMs()) - state.startedAt
    },
    summary: {
      total_decisions: results.total,
      accuracy: results.acc,
      avg_response_time_ms: results.avgRt,
      flag_only_rate: results.flagOnlyRate,
      by_phase: results.phases,
      scoring: results.scoring
    },
    event_log: state.events
  };
}

function downloadResults(){
  const payload = buildExportPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const alias = (state.alias || "anon").replace(/[^a-zA-Z0-9_-]/g,"_");
  a.href = url;
  a.download = `citation_clerk_results_${alias}_${state.sessionId}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function copyResults(){
  const payload = buildExportPayload();
  const txt = JSON.stringify(payload);
  try{
    await navigator.clipboard.writeText(txt);
    $("btnCopy").textContent = "Copied!";
    setTimeout(()=> $("btnCopy").textContent = "Copy results to clipboard", 1200);
  } catch (e){
    alert("Copy failed (clipboard permissions). Use Download instead.");
  }
}

function finishSession(reason){
  if (!state || state.status !== "running") return;
  state.status = "finished";
  state.endReason = reason;
  state.endedAtActual = nowMs();
  saveState();

  setScreen("results");
  setTopbarVisible(false);
  renderResults();
}

// Loading items and boot
async function loadItems(){
  const res = await fetch("items.json", {cache:"no-store"});
  const data = await res.json();
  const byId = {};
  for (const it of data.items) byId[it.id] = it;
  return { version: data.version, items: data.items, byId };
}

function buildOrderedIds(allItems, sessionId){
  // Keep phase order but shuffle within each phase using seeded RNG
  const rng = seededRng(sessionId);
  const p1 = shuffle(allItems.filter(i=>i.phase===1).map(i=>i.id), rng);
  const p2 = shuffle(allItems.filter(i=>i.phase===2).map(i=>i.id), rng);
  const p3 = shuffle(allItems.filter(i=>i.phase===3).map(i=>i.id), rng);
  return [...p1, ...p2, ...p3];
}

async function startNewSession(minutes){
  // Brief overlay to make the "rival clerk" mechanic feel real.
  await showRivalFinder(1200);

  const sessionId = uuidv4();
  const alias = $("alias").value.trim();
  const startedAt = nowMs();
  const endsAt = startedAt + (minutes * 60 * 1000);

  const orderedIds = buildOrderedIds(itemBank.items, sessionId);

  state = {
    status: "running",
    sessionId,
    alias,
    startedAt,
    endsAt,
    orderedIds,
    completedIds: [],
    skippedIds: [],
    current: null,
    events: [
      { t: startedAt, type: "session_start", minutes_planned: minutes },
      { t: startedAt, type: "rival_assigned" }
    ]
  };
  saveState();

  setScreen("main");
  setTopbarVisible(true);
  setProgressUI();
  nextItem();
}

function resumeSession(saved){
  state = saved;
  setScreen(state.status==="finished" ? "results" : "main");
  setTopbarVisible(state.status!=="finished");

  if (state.status==="finished"){
    renderResults();
    return;
  }

  // Ensure itemBank exists
  setProgressUI();
  // If current exists, render; else next item
  if (state.current && state.current.itemId){
    renderCurrentItem();
  } else {
    nextItem();
  }
}

function hookButtons(){
  $("btnToggleSummary").onclick = () => togglePanel("summary", $("panelSummary"));
  $("btnToggleMeta").onclick = () => togglePanel("meta", $("panelMeta"));
$("btnToggleFull").onclick = () => togglePanel("full", $("panelFull"));

  $("btnAllow").onclick = () => decide("ALLOW");
  $("btnReject").onclick = () => decide("REJECT");
  $("btnSkip").onclick = () => decide("SKIP");

  $("btnStart").onclick = () => {
    const minutes = 20;
    startNewSession(minutes);
  };

  $("btnReset").onclick = () => {
    if (confirm("Restart the current session on this browser? This will clear your local progress.")){
      clearSaved();
      window.location.reload();
    }
  };

  $("btnResume").onclick = async () => {
    const saved = loadState();
    if (!saved) return;
    if (saved.status !== "finished"){
      await showRivalFinder(1200);
    }
    resumeSession(saved);
  };
}

function updateLoop(){
  if (!state || state.status !== "running") return;
  updateCountdown();
  updateRival();
  requestAnimationFrame(updateLoop);
}

async function boot(){
  itemBank = await loadItems();

  hookButtons();

  // show intro
  setScreen("intro");
  setTopbarVisible(false);
  $("totalCount").textContent = String(itemBank.items.length);

  const saved = loadState();
  if (saved && saved.status){
    $("btnResume").style.display = "inline-block";
    $("btnReset").style.display = "inline-block";
  }

  // If someone loads directly into main after refresh, allow resume
  if (saved && saved.status === "running"){
    // Keep them on intro, but show resume
  }
}

window.addEventListener("load", async () => {
  initTheme();

  await boot();

  // Start loops once session running
  setInterval(() => {
    if (state && state.status === "running"){
      updateCountdown();
      updateRival();
      setProgressUI();
      updatePhaseHintAdaptive();
    }
  }, 250);

  // Also run animation frame loop for smoother rivalry bar
  const raf = () => {
    if (state && state.status === "running"){
      updateRival();
    }
    requestAnimationFrame(raf);
  };
  raf();
});