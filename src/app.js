import { analyzeWorkbook, readActiveCellAddress, navigateReference, excelAvailable } from "./excel-adapter.js";
import { formatPrecise, graphSummary, rankRoundCandidates, getNodeHighlightAttributes, applyNodeDrag, createDepthChoices, filterLookupRangeNodes, clampGraphZoom, zoomViewportAtPoint, panGraphViewport, classifyReferenceNode } from "./core.js";

const $ = (id) => document.getElementById(id);
const state = {
  graph: null, selectedNode: null, positions: new Map(), initialPositions: new Map(),
  expandedLookups: new Set(), scale: 1, panX: 0, panY: 0,
  layout: { width: 0, height: 0 }, drag: null, panDrag: null
};
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (ch) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[ch]));
const clonePositions = (positions) => new Map([...positions].map(([id, pos]) => [id, { ...pos }]));

function setStatus(message = "", tone = "info") {
  const el = $("status"); el.textContent = message; el.className = message ? `status show ${tone}` : "status";
}
function shortAddress(address) { return String(address).replaceAll("'", ""); }

function populateDepthOptions() {
  $("depth-select").innerHTML = createDepthChoices(20).map((depth) => `<option value="${depth}" ${depth === 3 ? "selected" : ""}>${depth}階層</option>`).join("");
}

function visibleGraph() {
  if (!state.graph) return { nodes: [], edges: [] };
  return filterLookupRangeNodes(state.graph, state.expandedLookups);
}

function computeAutoPositions(nodes) {
  const byDepth = new Map();
  const maxDepth = Math.max(0, ...nodes.map((n) => n.depth ?? 0));
  nodes.forEach((node) => {
    const level = maxDepth - (node.depth ?? 0);
    if (!byDepth.has(level)) byDepth.set(level, []);
    byDepth.get(level).push(node);
  });
  const nodeW = 190, nodeH = 122, gapX = 72, gapY = 24, pad = 22;
  const maxRows = Math.max(1, ...[...byDepth.values()].map((items) => items.length));
  const width = Math.max(360, pad * 2 + (maxDepth + 1) * nodeW + maxDepth * gapX);
  const height = Math.max(340, pad * 2 + maxRows * nodeH + (maxRows - 1) * gapY);
  const positions = new Map();
  for (const [level, group] of byDepth.entries()) {
    group.sort((a, b) => String(a.address).localeCompare(String(b.address), "ja"));
    const groupHeight = group.length * nodeH + Math.max(0, group.length - 1) * gapY;
    const startY = Math.max(pad, (height - groupHeight) / 2);
    group.forEach((node, row) => positions.set(node.id, { x: pad + level * (nodeW + gapX), y: startY + row * (nodeH + gapY), w: nodeW, h: nodeH }));
  }
  return { positions, width, height };
}

function recalculateBounds(nodes) {
  let maxX = 360, maxY = 340;
  for (const node of nodes) {
    const p = state.positions.get(node.id);
    if (p) { maxX = Math.max(maxX, p.x + p.w + 30); maxY = Math.max(maxY, p.y + p.h + 30); }
  }
  state.layout = { width: maxX, height: maxY };
}

function autoLayout(setInitial = false) {
  const layout = computeAutoPositions(state.graph.nodes);
  state.positions = layout.positions;
  state.layout = { width: layout.width, height: layout.height };
  if (setInitial) state.initialPositions = clonePositions(state.positions);
  state.scale = 1; state.panX = 0; state.panY = 0;
  renderGraph();
}

function renderSummary(nodes) {
  const s = graphSummary(nodes);
  const items = [[s.nodeCount,"解析セル"],[s.formulaCount,"数式セル"],[s.hiddenFractionCount,"表示に隠れた小数"],[s.candidateCount,"丸め候補"]];
  $("summary").innerHTML = items.map(([value,label]) => `<div class="summary-card"><strong>${value}</strong><span>${label}</span></div>`).join("");
}

function nodeBadges(node) {
  const badges = [];
  for (const fn of node.roundingFunctions || []) if (["ROUND","ROUNDDOWN","ROUNDUP"].includes(fn)) badges.push([fn, "good"]);
  if (node.hiddenFraction) badges.push(["小数残存", "warn"]);
  if (node.isLookup) badges.push([node.lookupFunctions.join("/"), "lookup"]);
  if (node.hasExternalReference || node.isExternalReference) badges.push(["外部参照", "external"]);
  if (node.isError) badges.push(["エラー", "error"]);
  for (const role of node.lookupRoles || []) badges.push([role, "route"]);
  const reference = classifyReferenceNode(node);
  badges.unshift([reference.label, "reference-kind"]);
  return badges.map(([label, tone]) => `<span class="mini-tag ${tone}">${escapeHtml(label)}</span>`).join("");
}

function highlightClasses(node) {
  const selected = new Set([...document.querySelectorAll('input[name="highlight"]:checked')].map((el) => el.value));
  const attrs = new Set(getNodeHighlightAttributes(node));
  const matched = [...selected].some((key) => attrs.has(key));
  const dimmed = $("dim-others")?.checked && selected.size > 0 && !matched;
  return `${matched ? "highlight-match" : ""} ${dimmed ? "dimmed" : ""}`;
}

function nodeTone(node) {
  return [node.isTarget ? "target" : "", node.hiddenFraction ? "warning" : "", node.isRangeSummary ? "range-summary" : "", node.isExternalReference ? "external-node" : "", highlightClasses(node)].filter(Boolean).join(" ");
}

function lookupExpandButton(node) {
  const hasFullRanges = state.graph.edges.some((edge) => edge.kind === "lookup-full-range" && edge.to === node.id);
  if (!hasFullRanges) return "";
  const expanded = state.expandedLookups.has(node.id);
  return `<button class="lookup-expand" data-lookup-id="${escapeHtml(node.id)}" title="全参照範囲を${expanded ? "折り畳む" : "展開する"}">${expanded ? "−" : "+"}</button>`;
}

function renderGraph() {
  const graph = visibleGraph(), host = $("graph");
  if (!graph.nodes.length) { host.innerHTML = `<div class="empty-state">参照元セルが見つかりませんでした。</div>`; return; }
  for (const node of graph.nodes) {
    if (!state.positions.has(node.id)) {
      const fallback = computeAutoPositions(state.graph.nodes).positions.get(node.id);
      state.positions.set(node.id, fallback || { x: 20, y: 20, w: 190, h: 122 });
    }
  }
  recalculateBounds(graph.nodes);
  const nodesHtml = graph.nodes.map((node) => {
    const p = state.positions.get(node.id);
    const reference = classifyReferenceNode(node);
    const displayAddress = reference.kind === "multiple" ? reference.addresses.map(shortAddress).join(" / ") : shortAddress(node.address);
    const addressAction = `<a href="#" class="node-address address-link" data-node-id="${escapeHtml(node.id)}" title="Excelで${reference.label}を選択">${escapeHtml(displayAddress)}</a>`;
    const lookupMessage = node.isLookup && node.lookupResolution ? `<span class="node-lookup-status ${node.lookupResolution.status}">${escapeHtml(node.lookupResolution.message)}</span>` : "";
    return `<div class="graph-node ${nodeTone(node)}" data-node-id="${escapeHtml(node.id)}" tabindex="0" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;min-height:${p.h}px">${lookupExpandButton(node)}${addressAction}<span class="node-display">${escapeHtml(node.displayValue)}</span><span class="node-raw">${node.isRangeSummary ? "折り畳まれた参照範囲" : `実値 ${escapeHtml(formatPrecise(node.value))}`}</span><span class="node-formula" title="${escapeHtml(node.formula || "入力値")}">${escapeHtml(node.formula || "入力値")}</span>${lookupMessage}<span class="node-tags">${nodeBadges(node)}</span></div>`;
  }).join("");
  host.innerHTML = `<div class="graph-canvas" style="width:${state.layout.width}px;height:${state.layout.height}px;transform:translate(${state.panX}px,${state.panY}px) scale(${state.scale})"><svg class="edge-svg" width="${state.layout.width}" height="${state.layout.height}"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z" fill="#9bb1c3"/></marker></defs><g id="edge-layer"></g></svg>${nodesHtml}</div>`;
  updateZoomLabel();
  drawEdges(graph.edges);
  bindGraphEvents();
  if (state.selectedNode && graph.nodes.some((n) => n.id === state.selectedNode.id)) markSelected(state.selectedNode.id);
}

function drawEdges(edges = visibleGraph().edges) {
  const layer = $("edge-layer"); if (!layer) return;
  layer.innerHTML = edges.map((edge) => {
    const a = state.positions.get(edge.from), b = state.positions.get(edge.to); if (!a || !b) return "";
    const x1=a.x+a.w,y1=a.y+a.h/2,x2=b.x,y2=b.y+b.h/2,bend=Math.max(25,Math.abs(x2-x1)/2);
    const routeClass = edge.kind === "lookup-actual" ? " lookup-actual" : edge.kind === "external" ? " external" : "";
    return `<path class="edge-path${routeClass}" marker-end="url(#arrow)" d="M ${x1} ${y1} C ${x1+bend} ${y1}, ${x2-bend} ${y2}, ${x2} ${y2}"/>`;
  }).join("");
}

function bindGraphEvents() {
  document.querySelectorAll(".address-link").forEach((link) => link.addEventListener("click", async (event) => {
    event.preventDefault(); event.stopPropagation();
    try {
      const node = state.graph.nodes.find((item) => item.id === link.dataset.nodeId);
      const result = await navigateReference(node);
      if (result?.status === "demo") setStatus("デモ表示のためExcelセルへは移動しません。", "info");
      else if (result?.status === "partial") setStatus(result.message, "warning");
      else setStatus(`${classifyReferenceNode(node).label}をExcelで選択しました。`, "info");
    } catch (error) { setStatus(error?.message || String(error), error?.code === "ExternalWorkbookNavigationUnavailable" ? "warning" : "error"); }
  }));
  document.querySelectorAll(".lookup-expand").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation(); const id = button.dataset.lookupId;
    if (state.expandedLookups.has(id)) state.expandedLookups.delete(id); else state.expandedLookups.add(id);
    renderGraph();
  }));
  document.querySelectorAll(".graph-node").forEach((nodeEl) => {
    nodeEl.addEventListener("pointerdown", startDrag);
    nodeEl.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.target.closest("a,button")) selectNode(nodeEl.dataset.nodeId); });
  });
  const host = $("graph");
  host.removeEventListener("wheel", handleGraphWheel);
  host.removeEventListener("pointerdown", startPan);
  host.addEventListener("wheel", handleGraphWheel, { passive: false });
  host.addEventListener("pointerdown", startPan);
}

function updateCanvasTransform() {
  const canvas = document.querySelector(".graph-canvas");
  if (canvas) canvas.style.transform = `translate(${state.panX}px,${state.panY}px) scale(${state.scale})`;
  updateZoomLabel();
}

function updateZoomLabel() {
  if ($("zoom-label")) $("zoom-label").textContent = `${Math.round(state.scale * 100)}%`;
}

function setGraphZoom(nextScale, point = null) {
  const host = $("graph");
  const focal = point || { x: host.clientWidth / 2, y: host.clientHeight / 2 };
  const next = zoomViewportAtPoint(state, clampGraphZoom(nextScale), focal);
  state.scale = next.scale; state.panX = next.panX; state.panY = next.panY;
  updateCanvasTransform();
}

function handleGraphWheel(event) {
  event.preventDefault();
  const rect = $("graph").getBoundingClientRect();
  const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
  setGraphZoom(state.scale * factor, { x: event.clientX - rect.left, y: event.clientY - rect.top });
}

function startPan(event) {
  if (event.button !== 0 || event.target.closest(".graph-node,a,button,input,label")) return;
  const host = $("graph");
  state.panDrag = { startX: event.clientX, startY: event.clientY, origin: { scale: state.scale, panX: state.panX, panY: state.panY } };
  host.setPointerCapture(event.pointerId); host.classList.add("panning");
  host.addEventListener("pointermove", movePan); host.addEventListener("pointerup", endPan, { once: true }); host.addEventListener("pointercancel", endPan, { once: true });
}

function movePan(event) {
  if (!state.panDrag) return;
  const next = panGraphViewport(state.panDrag.origin, event.clientX - state.panDrag.startX, event.clientY - state.panDrag.startY);
  state.panX = next.panX; state.panY = next.panY; updateCanvasTransform();
}

function endPan(event) {
  const host = $("graph");
  host.classList.remove("panning"); host.removeEventListener("pointermove", movePan);
  try { host.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  state.panDrag = null;
}

function startDrag(event) {
  if (event.button !== 0 || event.target.closest("a,button")) return;
  const el = event.currentTarget, id = el.dataset.nodeId, start = state.positions.get(id);
  state.drag = { id, el, startX: event.clientX, startY: event.clientY, origin: { x: start.x, y: start.y }, moved: false };
  el.setPointerCapture(event.pointerId); el.classList.add("dragging");
  el.addEventListener("pointermove", moveDrag); el.addEventListener("pointerup", endDrag, { once: true }); el.addEventListener("pointercancel", endDrag, { once: true });
}

function moveDrag(event) {
  if (!state.drag) return;
  const dx = event.clientX - state.drag.startX, dy = event.clientY - state.drag.startY;
  if (Math.abs(dx) + Math.abs(dy) > 3) state.drag.moved = true;
  const next = applyNodeDrag(state.drag.origin, dx, dy, state.scale);
  const p = state.positions.get(state.drag.id); p.x = Math.max(0, next.x); p.y = Math.max(0, next.y);
  state.drag.el.style.left = `${p.x}px`; state.drag.el.style.top = `${p.y}px`; drawEdges();
}

function endDrag(event) {
  if (!state.drag) return;
  const drag = state.drag; drag.el.classList.remove("dragging"); drag.el.removeEventListener("pointermove", moveDrag);
  try { drag.el.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  state.drag = null; recalculateBounds(visibleGraph().nodes);
  if (!drag.moved) selectNode(drag.id); else renderGraph();
}

function markSelected(id) { document.querySelectorAll(".graph-node").forEach((el) => el.classList.toggle("selected", el.dataset.nodeId === id)); }
function selectNode(nodeId) {
  const node = state.graph?.nodes.find((item) => item.id === nodeId); if (!node) return;
  state.selectedNode = node; markSelected(nodeId);
  const deltaClass = node.roundDelta > 0 ? "delta-positive" : node.roundDelta < 0 ? "delta-negative" : "";
  const resolution = node.lookupResolution ? `<dt>LOOKUP経路</dt><dd>${escapeHtml(node.lookupResolution.message)}</dd>` : "";
  $("detail").innerHTML = `<dl class="detail-grid"><dt>セル／範囲</dt><dd><strong>${escapeHtml(node.address)}</strong></dd><dt>表示値</dt><dd>${escapeHtml(node.displayValue)}</dd><dt>実値</dt><dd class="value-raw">${escapeHtml(formatPrecise(node.value))}</dd><dt>表示形式</dt><dd class="code">${escapeHtml(node.numberFormat)}</dd><dt>数式</dt><dd class="code">${escapeHtml(node.formula || "（入力値／集約範囲）")}</dd>${resolution}<dt>属性</dt><dd>${nodeBadges(node) || "なし"}</dd><dt>整数丸め差</dt><dd class="${deltaClass}">${typeof node.value === "number" ? escapeHtml(`${node.roundDelta >= 0 ? "+" : ""}${formatPrecise(node.roundDelta)}`) : "－"}</dd></dl>`;
}

function renderCandidates(nodes) {
  const candidates = rankRoundCandidates(nodes);
  if (!candidates.length) { $("candidates").innerHTML = `<div class="empty-state">現在の解析範囲に明確な候補はありません。</div>`; return; }
  $("candidates").innerHTML = candidates.map((node,index) => `<article class="candidate"><div class="candidate-header"><span class="candidate-address">${escapeHtml(shortAddress(node.address))}</span><span class="candidate-rank">候補 ${index+1}</span></div><p>実値 ${escapeHtml(formatPrecise(node.value))}／整数丸め差 ${node.roundDelta>=0?"+":""}${escapeHtml(formatPrecise(node.roundDelta))}</p><code>${escapeHtml(node.suggestedFormula)}</code></article>`).join("");
}

function fitGraph() {
  const host = $("graph"); if (!state.layout.width || !state.layout.height) return;
  const width = Math.max(1, host.clientWidth - 18), height = Math.max(1, host.clientHeight - 18);
  state.scale = clampGraphZoom(Math.min(width / state.layout.width, height / state.layout.height));
  state.panX = (host.clientWidth - state.layout.width * state.scale) / 2;
  state.panY = (host.clientHeight - state.layout.height * state.scale) / 2;
  updateCanvasTransform();
}

async function refreshActiveAddress() { try { $("selected-address").textContent = await readActiveCellAddress(); } catch { $("selected-address").textContent = "選択セルを取得できません"; } }
async function runAnalysis() {
  const button=$("analyze-button"); button.disabled=true; button.textContent="解析中…"; setStatus("選択セルから参照元を探索しています。","info");
  try {
    const graph=await analyzeWorkbook({maxDepth:Number($("depth-select").value),maxCells:Number($("limit-select").value),rangeCellLimit:80});
    state.graph=graph; state.selectedNode=null; state.expandedLookups.clear(); state.scale=1; state.panX=0; state.panY=0;
    $("selected-address").textContent=graph.targetAddress; renderSummary(graph.nodes); autoLayout(true); renderCandidates(graph.nodes);
    const resolved=graph.nodes.filter((n)=>n.lookupResolution?.status==="resolved").length, unresolved=graph.nodes.filter((n)=>n.lookupResolution?.status==="unresolved").length;
    const lookupText=(resolved||unresolved)?` LOOKUP実経路: ${resolved}件特定、${unresolved}件未特定。`:"";
    setStatus((graph.warnings.join(" ")||`${graph.nodes.length}セルを${graph.maxDepth}階層まで解析しました。`)+lookupText,graph.warnings.length||unresolved?"warning":"info");
  } catch(error) { console.error(error); setStatus(`解析できませんでした: ${error?.message||error}`,"error"); }
  finally { button.disabled=false; button.textContent="選択セルを解析"; }
}

function initialize() {
  populateDepthOptions();
  const live=excelAvailable(); $("runtime-badge").textContent=live?"Excel接続":"デモ"; $("runtime-badge").className=`badge ${live?"live":"demo"}`;
  $("analyze-button").addEventListener("click",runAnalysis);
  $("auto-layout-button").addEventListener("click",()=>autoLayout(false));
  $("reset-layout-button").addEventListener("click",()=>{state.positions=clonePositions(state.initialPositions);state.scale=1;state.panX=0;state.panY=0;renderGraph();});
  $("zoom-out-button").addEventListener("click",()=>setGraphZoom(state.scale / 1.2));
  $("zoom-in-button").addEventListener("click",()=>setGraphZoom(state.scale * 1.2));
  $("fit-button").addEventListener("click",fitGraph);
  document.querySelectorAll('input[name="highlight"],#dim-others').forEach((el)=>el.addEventListener("change",renderGraph));
  refreshActiveAddress(); runAnalysis();
}
if(globalThis.Office?.onReady) Office.onReady(initialize); else window.addEventListener("DOMContentLoaded",initialize);
