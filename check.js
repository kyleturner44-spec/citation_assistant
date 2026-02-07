/* Instructor item bank checker/editor (static, offline) */
const DRAFT_KEY = "cc_items_editor_draft_v1";

const state = {
  loaded: null,    // the last loaded JSON (baseline for reset)
  data: null,      // working editable JSON
  items: [],
  filters: { phase: "all", view: "all", err: "all", q: "" },
  errorTypes: [],
  renderRefs: new Map(), // item.id -> DOM refs
};

function $(id){ return document.getElementById(id); }

function deepClone(x){ return JSON.parse(JSON.stringify(x)); }

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

function setPath(obj, path, value){
  const parts = path.split(".");
  let cur = obj;
  for (let i=0;i<parts.length-1;i++){
    const k = parts[i];
    if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length-1]] = value;
}

function normFlag(flag){
  if (!flag) return null;
  const f = String(flag).toUpperCase().trim();
  if (f === "SUPPORTED" || f === "NOT_SUPPORTED") return f;
  // Accept common variants
  if (f === "NOT SUPPORTED" || f === "NOT-SUPPORTED") return "NOT_SUPPORTED";
  if (f === "SUPPORT") return "SUPPORTED";
  return f;
}

function assistantCorrect(item){
  const gt = !!safeGet(item, "ground_truth.supports", false);
  const af = normFlag(safeGet(item, "assistant.flag", null));
  if (!af) return null;
  const aSupports = (af === "SUPPORTED");
  return aSupports === gt;
}

function expectedAssistantCorrect(item){
  const phase = Number(item.phase);
  if (phase === 1 || phase === 2) return true;
  if (phase === 3){
    const et = safeGet(item, "assistant.error_type", null);
    return et ? false : true;
  }
  return true;
}

function idPhaseMismatch(item){
  const id = String(item.id || "");
  const m = id.match(/^P(\d)-/);
  if (!m) return false;
  const p = Number(m[1]);
  return p !== Number(item.phase);
}

function computeStats(items){
  const total = items.length;
  const p1 = items.filter(x=>Number(x.phase)===1).length;
  const p2 = items.filter(x=>Number(x.phase)===2).length;
  const p3 = items.filter(x=>Number(x.phase)===3).length;

  const wrong = items.filter(x=>assistantCorrect(x)===false).length;
  const mism = items.filter(x=>{
    const ac = assistantCorrect(x);
    if (ac === null) return true; // missing assistant flag is a mismatch worth surfacing
    return ac !== expectedAssistantCorrect(x);
  }).length;

  const idm = items.filter(idPhaseMismatch).length;
  return {total,p1,p2,p3,wrong,mism,idm};
}

function uniqueErrorTypes(items){
  const s = new Set();
  for (const it of items){
    const et = safeGet(it, "assistant.error_type", null);
    if (et) s.add(String(et));
  }
  return Array.from(s).sort();
}

function filterItems(items){
  const {phase, view, err, q} = state.filters;
  const query = (q || "").trim().toLowerCase();

  return items.filter(it=>{
    if (phase !== "all" && String(it.phase) !== phase) return false;

    const ac = assistantCorrect(it);
    const exp = expectedAssistantCorrect(it);
    const mismatch = (ac === null) ? true : (ac !== exp);

    if (view === "mismatch" && !mismatch) return false;
    if (view === "assistant_wrong" && ac !== false) return false;
    if (view === "assistant_correct" && ac !== true) return false;

    const et = safeGet(it,"assistant.error_type", null);
    if (err !== "all" && String(et || "") !== err) return false;

    if (query){
      const blob = [
        it.id, it.citation, it.proposition,
        safeGet(it, "evidence.quote",""),
        safeGet(it, "evidence.full_source",""),
        safeGet(it, "evidence.full_excerpt",""),
        safeGet(it, "assistant.summary",""),
        safeGet(it, "ground_truth.reason",""),
      ].join("\n").toLowerCase();
      if (!blob.includes(query)) return false;
    }

    return true;
  });
}

function badge(text, cls){
  const span = document.createElement("span");
  span.className = `badge ${cls||""}`.trim();
  span.textContent = text;
  return span;
}

function render(){
  const list = $("list");
  list.innerHTML = "";
  state.renderRefs.clear();

  const items = state.items.slice().sort((a,b)=>{
    const pa = Number(a.phase), pb = Number(b.phase);
    if (pa !== pb) return pa - pb;
    return String(a.id).localeCompare(String(b.id), undefined, {numeric:true});
  });

  const filtered = filterItems(items);

  const stats = computeStats(items);
  $("sumItems").textContent = String(stats.total);
  $("sumPhases").textContent = `${stats.p1} / ${stats.p2} / ${stats.p3}`;
  $("sumWrong").textContent = String(stats.wrong);
  $("sumMismatch").textContent = String(stats.mism);
  $("sumIdPhase").textContent = String(stats.idm);

  $("statusText").textContent = `${filtered.length} shown • ${stats.total} total`;

  for (const it of filtered){
    const el = renderItem(it);
    list.appendChild(el);
  }
}

function renderItem(it){
  const det = document.createElement("details");
  det.className = "item";

  const sum = document.createElement("summary");

  const left = document.createElement("div");
  left.className = "hdrLeft";

  const title = document.createElement("div");
  title.className = "hdrTitle";

  const id = String(it.id || "—");
  const ph = Number(it.phase || 0);

  const idSpan = document.createElement("span");
  idSpan.className = "mono";
  idSpan.textContent = id;

  title.appendChild(idSpan);
  title.appendChild(badge(`Phase ${ph}`, "warn"));

  const ac = assistantCorrect(it);
  const exp = expectedAssistantCorrect(it);

  if (ac === true) title.appendChild(badge("Assistant correct", "good"));
  else if (ac === false) title.appendChild(badge("Assistant wrong", "bad"));
  else title.appendChild(badge("Assistant flag missing", "warn"));

  // Expectation
  const mismatch = (ac === null) ? true : (ac !== exp);
  title.appendChild(badge(exp ? "Expected: correct" : "Expected: wrong", exp ? "good" : "bad"));
  if (mismatch) title.appendChild(badge("Expectation mismatch", "bad"));

  if (idPhaseMismatch(it)) title.appendChild(badge("ID/phase mismatch", "warn"));

  const et = safeGet(it, "assistant.error_type", null);
  if (et) title.appendChild(badge(`error_type: ${et}`, "warn"));

  const sub = document.createElement("div");
  sub.className = "hdrSub";
  sub.textContent = (it.citation || "").slice(0, 140) || "(no citation)";

  left.appendChild(title);
  left.appendChild(sub);

  const right = document.createElement("div");
  right.className = "badges";
  // Quick glance: assistant conf
  const conf = safeGet(it, "assistant.confidence", null);
  if (typeof conf === "number"){
    right.appendChild(badge(`conf ${(conf*100).toFixed(0)}%`, ""));
  }

  sum.appendChild(left);
  sum.appendChild(right);

  det.appendChild(sum);

  const body = document.createElement("div");
  body.className = "body";

  const grid = document.createElement("div");
  grid.className = "grid2";

  // Panel: Brief
  grid.appendChild(panel("Brief", [
    fieldTextArea("Proposition", it, "proposition", 80),
    fieldTextArea("The brief contained the following (pinpoint quote)", it, "evidence.quote", 80),
    fieldTextArea("Citation", it, "citation", 60),
  ]));

  // Panel: Ground truth
  grid.appendChild(panel("Ground truth", [
    fieldSelect("Supports?", it, "ground_truth.supports", [
      {label:"true", value:"true"}, {label:"false", value:"false"}
    ], v => (String(v) === "true")),
    fieldTextArea("Reason (for instructor)", it, "ground_truth.reason", 80),
  ]));

  // Panel: Authority metadata
  grid.appendChild(panel("Authority", [
    rowFields([
      fieldText("Court level", it, "authority.court_level"),
      fieldText("Jurisdiction", it, "authority.jurisdiction"),
    ]),
    fieldSelect("Binding?", it, "authority.binding", [
      {label:"true", value:"true"}, {label:"false", value:"false"}
    ], v => (String(v) === "true")),
  ]));

  // Panel: Assistant output
  const errTypes = [{label:"(none)", value:""}].concat(state.errorTypes.map(t=>({label:t, value:t})));
  grid.appendChild(panel("Assistant", [
    rowFields([
      fieldSelect("Flag", it, "assistant.flag", [
        {label:"SUPPORTED", value:"SUPPORTED"},
        {label:"NOT_SUPPORTED", value:"NOT_SUPPORTED"}
      ]),
      fieldNumber("Confidence (0–1)", it, "assistant.confidence", 0, 1, 0.01),
    ]),
    fieldTextArea("Auto-summary", it, "assistant.summary", 120),
    fieldSelect("error_type", it, "assistant.error_type", errTypes, v => v),
  ]));

  // Panel: Evidence (primary text)
  const evPanel = panel("Evidence (primary text)", [
    fieldText("Full excerpt source (e.g., “Majority opinion (Justice X), Part II.B”)",
      it, "evidence.full_source"),
    fieldTextArea("Full excerpt (quoted authority text)", it, "evidence.full_excerpt", 200),
    helpLine(`Check: full excerpt should read like primary text. Avoid summary voice.`),
  ]);
  grid.appendChild(evPanel);

  body.appendChild(grid);

  // Footer
  const footer = document.createElement("div");
  footer.className = "footerRow";
  const small = document.createElement("div");
  small.className = "small muted";
  small.textContent = `Assistant correctness is computed from assistant.flag vs ground_truth.supports.`;

  const btns = document.createElement("div");
  btns.className = "btnRow";

  const btnOpen = document.createElement("button");
  btnOpen.className = "pill pill-button";
  btnOpen.type = "button";
  btnOpen.textContent = "Open in new tab (anchor)";
  btnOpen.onclick = (e)=>{
    e.preventDefault();
    location.hash = `#${encodeURIComponent(id)}`;
    // Force open
    det.open = true;
  };

  btns.appendChild(btnOpen);
  footer.appendChild(small);
  footer.appendChild(btns);

  body.appendChild(footer);

  det.appendChild(body);

  // store ref for later header updates
  state.renderRefs.set(id, {det, sum, left, right, title, sub});

  // anchor id
  det.id = id;

  return det;
}

function helpLine(text){
  const div = document.createElement("div");
  div.className = "small muted";
  div.textContent = text;
  return div;
}

function panel(titleText, children){
  const p = document.createElement("div");
  p.className = "panel";
  const h = document.createElement("h3");
  h.textContent = titleText;
  p.appendChild(h);
  for (const ch of children){
    if (Array.isArray(ch)) ch.forEach(x=>p.appendChild(x));
    else p.appendChild(ch);
  }
  return p;
}

function rowFields(children){
  const row = document.createElement("div");
  row.className = "row";
  for (const c of children) row.appendChild(c);
  return row;
}

function fieldBase(labelText){
  const wrap = document.createElement("div");
  wrap.className = "field";
  const k = document.createElement("div");
  k.className = "k";
  k.textContent = labelText;
  wrap.appendChild(k);
  return wrap;
}

function bindInput(input, item, path, parseFn){
  input.addEventListener("input", ()=>{
    const val = parseFn ? parseFn(input.value) : input.value;
    setPath(item, path, val);
    onItemChanged(item);
  });
}

function fieldText(labelText, item, path){
  const wrap = fieldBase(labelText);
  const input = document.createElement("input");
  input.type = "text";
  input.value = safeGet(item, path, "") ?? "";
  bindInput(input, item, path, v => v);
  wrap.appendChild(input);
  return wrap;
}

function fieldNumber(labelText, item, path, min, max, step){
  const wrap = fieldBase(labelText);
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(safeGet(item, path, 0.5) ?? 0.5);
  bindInput(input, item, path, v => {
    const n = Number(v);
    if (Number.isNaN(n)) return 0.5;
    return Math.min(max, Math.max(min, n));
  });
  wrap.appendChild(input);
  return wrap;
}

function fieldTextArea(labelText, item, path, minHeight){
  const wrap = fieldBase(labelText);
  const ta = document.createElement("textarea");
  ta.value = safeGet(item, path, "") ?? "";
  if (minHeight) ta.style.minHeight = `${minHeight}px`;
  bindInput(ta, item, path, v => v);
  wrap.appendChild(ta);
  return wrap;
}

function fieldSelect(labelText, item, path, options, parseFn){
  const wrap = fieldBase(labelText);
  const sel = document.createElement("select");
  const cur = safeGet(item, path, "");
  for (const opt of options){
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    sel.appendChild(o);
  }
  sel.value = (cur === null || cur === undefined) ? "" : String(cur);
  sel.addEventListener("change", ()=>{
    let v = sel.value;
    if (parseFn) v = parseFn(v);
    setPath(item, path, v);
    onItemChanged(item);
  });
  wrap.appendChild(sel);
  return wrap;
}

let saveTimer = null;
function scheduleDraftSave(){
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(()=>{
    try{
      localStorage.setItem(DRAFT_KEY, JSON.stringify(state.data));
    } catch {}
  }, 400);
}

function onItemChanged(item){
  // Normalize booleans that come in as strings
  const b = safeGet(item, "authority.binding", null);
  if (typeof b === "string") setPath(item, "authority.binding", b === "true");
  const s = safeGet(item, "ground_truth.supports", null);
  if (typeof s === "string") setPath(item, "ground_truth.supports", s === "true");
  const flag = safeGet(item, "assistant.flag", null);
  if (flag) setPath(item, "assistant.flag", normFlag(flag));

  updateItemHeader(item);
  scheduleDraftSave();
}

function updateItemHeader(item){
  const id = String(item.id || "");
  const ref = state.renderRefs.get(id);
  if (!ref) return;

  const title = ref.title;
  // rebuild title badges
  title.innerHTML = "";
  const idSpan = document.createElement("span");
  idSpan.className = "mono";
  idSpan.textContent = id;
  title.appendChild(idSpan);

  const ph = Number(item.phase || 0);
  title.appendChild(badge(`Phase ${ph}`, "warn"));

  const ac = assistantCorrect(item);
  const exp = expectedAssistantCorrect(item);

  if (ac === true) title.appendChild(badge("Assistant correct", "good"));
  else if (ac === false) title.appendChild(badge("Assistant wrong", "bad"));
  else title.appendChild(badge("Assistant flag missing", "warn"));

  title.appendChild(badge(exp ? "Expected: correct" : "Expected: wrong", exp ? "good" : "bad"));

  const mismatch = (ac === null) ? true : (ac !== exp);
  if (mismatch) title.appendChild(badge("Expectation mismatch", "bad"));
  if (idPhaseMismatch(item)) title.appendChild(badge("ID/phase mismatch", "warn"));

  const et = safeGet(item, "assistant.error_type", null);
  if (et) title.appendChild(badge(`error_type: ${et}`, "warn"));

  // Right: confidence badge
  ref.right.innerHTML = "";
  const conf = safeGet(item, "assistant.confidence", null);
  if (typeof conf === "number"){
    ref.right.appendChild(badge(`conf ${(conf*100).toFixed(0)}%`, ""));
  }

  // Update summary line
  ref.sub.textContent = (item.citation || "").slice(0, 140) || "(no citation)";

  // Update overall summary stats as edits happen
  const stats = computeStats(state.items);
  $("sumItems").textContent = String(stats.total);
  $("sumPhases").textContent = `${stats.p1} / ${stats.p2} / ${stats.p3}`;
  $("sumWrong").textContent = String(stats.wrong);
  $("sumMismatch").textContent = String(stats.mism);
  $("sumIdPhase").textContent = String(stats.idm);
}

function populateErrorTypeSelect(){
  state.errorTypes = uniqueErrorTypes(state.items);
  const sel = $("errSel");
  const cur = sel.value;
  sel.innerHTML = `<option value="all">All</option>`;
  for (const t of state.errorTypes){
    const o = document.createElement("option");
    o.value = t;
    o.textContent = t;
    sel.appendChild(o);
  }
  if (state.errorTypes.includes(cur)) sel.value = cur;
}

function collapseAll(){
  for (const ref of state.renderRefs.values()){
    ref.det.open = false;
  }
}

function openMismatches(){
  for (const it of state.items){
    const ac = assistantCorrect(it);
    const exp = expectedAssistantCorrect(it);
    const mismatch = (ac === null) ? true : (ac !== exp);
    const ref = state.renderRefs.get(String(it.id||""));
    if (ref) ref.det.open = mismatch;
  }
}

function downloadText(text, filename, mime="application/json"){
  const blob = new Blob([text], {type:mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 3000);
}

function exportItems(){
  const out = deepClone(state.data);
  out.generated_at = new Date().toISOString();

  // Ensure schema basics
  if (!out.version) out.version = "1.0";
  if (!Array.isArray(out.items)) out.items = state.items;

  downloadText(JSON.stringify(out, null, 2), "items.json", "application/json");
}

function resetToLoaded(){
  if (!state.loaded) return;
  state.data = deepClone(state.loaded);
  state.items = state.data.items || [];
  populateErrorTypeSelect();
  render();
  scheduleDraftSave();
}

async function loadFromFetch(){
  const res = await fetch("items.json", {cache:"no-store"});
  if (!res.ok) throw new Error(`Failed to load items.json (${res.status})`);
  const data = await res.json();
  state.loaded = deepClone(data);
  state.data = deepClone(data);
  state.items = state.data.items || [];
  populateErrorTypeSelect();
  render();

  // If there's an anchor (#P3-07), open it after render
  if (location.hash){
    const id = decodeURIComponent(location.hash.slice(1));
    const ref = state.renderRefs.get(id);
    if (ref){
      ref.det.open = true;
      ref.det.scrollIntoView({behavior:"smooth", block:"start"});
    }
  }
}

async function importFile(file){
  const txt = await file.text();
  const data = JSON.parse(txt);
  state.loaded = deepClone(data);
  state.data = deepClone(data);
  state.items = state.data.items || (Array.isArray(data) ? data : []);
  populateErrorTypeSelect();
  render();
  scheduleDraftSave();
}

function initTheme(){
  const saved = localStorage.getItem("cc_theme");
  if (saved === "dark"){
    document.documentElement.setAttribute("data-theme","dark");
    $("btnTheme").textContent = "Light mode";
  } else {
    document.documentElement.removeAttribute("data-theme");
    $("btnTheme").textContent = "Dark mode";
  }
}

function toggleTheme(){
  const isDark = document.documentElement.getAttribute("data-theme")==="dark";
  if (isDark){
    document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("cc_theme","light");
    $("btnTheme").textContent = "Dark mode";
  } else {
    document.documentElement.setAttribute("data-theme","dark");
    localStorage.setItem("cc_theme","dark");
    $("btnTheme").textContent = "Light mode";
  }
}

function showDraftBannerIfNeeded(){
  try{
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const b = $("draftBanner");
    b.style.display = "flex";
  } catch {}
}

function clearDraft(){
  try{ localStorage.removeItem(DRAFT_KEY); } catch {}
  $("draftBanner").style.display = "none";
}

function restoreDraft(){
  try{
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    state.loaded = state.loaded || deepClone(data);
    state.data = deepClone(data);
    state.items = state.data.items || [];
    populateErrorTypeSelect();
    render();
    $("draftBanner").style.display = "none";
  } catch (e){
    alert("Could not restore draft: " + e);
  }
}

function wireControls(){
  $("phaseSel").addEventListener("change", e=>{ state.filters.phase = e.target.value; render(); });
  $("viewSel").addEventListener("change", e=>{ state.filters.view = e.target.value; render(); });
  $("errSel").addEventListener("change", e=>{ state.filters.err = e.target.value; render(); });

  const search = $("searchBox");
  let t=null;
  search.addEventListener("input", ()=>{
    if (t) clearTimeout(t);
    t = setTimeout(()=>{
      state.filters.q = search.value || "";
      render();
    }, 120);
  });

  $("btnCollapse").onclick = ()=>collapseAll();
  $("btnExpandMismatch").onclick = ()=>openMismatches();

  $("btnExport").onclick = ()=>exportItems();
  $("btnExport2").onclick = ()=>exportItems();
  $("btnReset").onclick = ()=>{
    if (confirm("Reset all edits to the last loaded items?")) resetToLoaded();
  };

  $("btnTheme").onclick = ()=>toggleTheme();

  $("btnClearDraft").onclick = ()=>{
    if (confirm("Clear the auto-saved draft from this browser?")) clearDraft();
  };

  $("btnRestore").onclick = ()=>restoreDraft();
  $("btnDismiss").onclick = ()=>{$("draftBanner").style.display="none";};

  const fileInput = $("fileInput");
  fileInput.addEventListener("change", async (e)=>{
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    await importFile(f);
    e.target.value = "";
    $("draftBanner").style.display = "none";
  });
  // Make the label clickable
  document.querySelector('label.pill').addEventListener("click", ()=>{
    fileInput.click();
  });
}

window.addEventListener("DOMContentLoaded", async ()=>{
  initTheme();
  wireControls();
  showDraftBannerIfNeeded();
  try{
    await loadFromFetch();
    // If draft exists, keep banner displayed but do not auto-restore.
  } catch (e){
    $("statusText").textContent = "Could not load items.json — import a file.";
    console.error(e);
  }
});
