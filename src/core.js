const ROUNDING_FUNCTIONS = [
  "ROUND", "ROUNDUP", "ROUNDDOWN", "MROUND", "INT", "TRUNC", "CEILING", "CEILING.MATH",
  "FLOOR", "FLOOR.MATH", "ODD", "EVEN"
];

const LOOKUP_FUNCTIONS = [
  "XLOOKUP", "VLOOKUP", "HLOOKUP", "LOOKUP", "INDEX", "MATCH", "XMATCH"
];

export function createDepthChoices(maxDepth = 20) {
  return Array.from({ length: Math.max(1, maxDepth) }, (_, index) => index + 1);
}

export function splitQualifiedAddress(address) {
  const bang = address.lastIndexOf("!");
  if (bang < 0) return { sheet: "", cell: address.replaceAll("$", "") };
  let sheet = address.slice(0, bang);
  if (sheet.startsWith("'") && sheet.endsWith("'")) {
    sheet = sheet.slice(1, -1).replaceAll("''", "'");
  }
  return { sheet, cell: address.slice(bang + 1).replaceAll("$", "") };
}

export function qualifyAddress(sheet, cell) {
  const escaped = String(sheet).replaceAll("'", "''");
  return `'${escaped}'!${String(cell).replaceAll("$", "")}`;
}

export function splitAreas(address) {
  const result = [];
  let quoted = false;
  let current = "";
  for (let i = 0; i < address.length; i += 1) {
    const ch = address[i];
    if (ch === "'") {
      if (quoted && address[i + 1] === "'") {
        current += "''";
        i += 1;
        continue;
      }
      quoted = !quoted;
    }
    if (ch === "," && !quoted) {
      if (current.trim()) result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

function colToNumber(col) {
  return [...col.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
}

function numberToCol(n) {
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function expandQualifiedArea(address, cellLimit = 80) {
  const { sheet, cell } = splitQualifiedAddress(address);
  const [startRaw, endRaw = startRaw] = cell.split(":");
  const pattern = /^([A-Z]+)(\d+)$/i;
  const a = startRaw.match(pattern);
  const b = endRaw.match(pattern);
  if (!a || !b) return { cells: [], truncated: true, total: null };
  const c1 = colToNumber(a[1]);
  const c2 = colToNumber(b[1]);
  const r1 = Number(a[2]);
  const r2 = Number(b[2]);
  const minC = Math.min(c1, c2);
  const maxC = Math.max(c1, c2);
  const minR = Math.min(r1, r2);
  const maxR = Math.max(r1, r2);
  const total = (maxC - minC + 1) * (maxR - minR + 1);
  if (total > cellLimit) return { cells: [], truncated: true, total };
  const cells = [];
  for (let row = minR; row <= maxR; row += 1) {
    for (let col = minC; col <= maxC; col += 1) {
      cells.push(qualifyAddress(sheet, `${numberToCol(col)}${row}`));
    }
  }
  return { cells, truncated: false, total };
}

export function getFormulaText(formulas) {
  const value = Array.isArray(formulas) ? formulas?.[0]?.[0] : formulas;
  return typeof value === "string" && value.startsWith("=") ? value : "";
}

export function detectRoundingFunctions(formula) {
  const upper = String(formula || "").toUpperCase();
  return ROUNDING_FUNCTIONS.filter((fn) => new RegExp(`\\b${fn.replace(".", "\\.")}\\s*\\(`).test(upper));
}

export function detectLookupFunctions(formula) {
  const upper = String(formula || "").toUpperCase();
  return LOOKUP_FUNCTIONS.filter((fn) => new RegExp(`\\b${fn}\\s*\\(`).test(upper));
}

export function fractionalPart(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const nearest = Math.round(value);
  const delta = value - nearest;
  return Math.abs(delta) < 1e-10 ? 0 : delta;
}

export function decimalPlacesFromFormat(format) {
  const text = String(format || "").split(";")[0];
  // Excelのロケール非依存書式では小数点はピリオド。カンマは桁区切りなので数えない。
  const decimal = text.match(/\.([0#?]+)/);
  return decimal ? decimal[1].length : 0;
}

export function formatPrecise(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value ?? "");
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 12, useGrouping: true }).format(value);
}

export function analyzeNode(node) {
  const formula = node.formula || "";
  const value = node.value;
  const roundingFunctions = detectRoundingFunctions(formula);
  const lookupFunctions = detectLookupFunctions(formula);
  const fraction = fractionalPart(value);
  const decimalsShown = decimalPlacesFromFormat(node.numberFormat);
  const hiddenFraction = fraction !== 0 && decimalsShown === 0;
  const roundDelta = typeof value === "number" ? Math.round(value) - value : 0;
  const isError = typeof value === "string" && /^#(?:N\/A|VALUE!|REF!|DIV\/0!|NAME\?|NUM!|NULL!|SPILL!|CALC!)/i.test(value);
  const externalReferences = detectExternalReferences(formula);
  return {
    ...node,
    roundingFunctions,
    lookupFunctions,
    isLookup: lookupFunctions.length > 0,
    isError,
    externalReferences,
    hasExternalReference: externalReferences.length > 0,
    fraction,
    decimalsShown,
    hiddenFraction,
    roundDelta,
    isRoundCandidate: Boolean(formula && fraction !== 0 && roundingFunctions.length === 0),
    suggestedFormula: formula ? `=ROUND(${formula.slice(1)},0)` : ""
  };
}

export function detectExternalReferences(formula) {
  const results = [];
  const regex = /(?:'([^']*\[([^\]]+)\][^']*)'|([^'\s,!()]*\[([^\]]+)\][^!\s,()]*))!\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?/gi;
  for (const match of String(formula || "").matchAll(regex)) {
    const prefix = match[1] || match[3] || "";
    const workbook = match[2] || match[4] || "";
    const sheet = prefix.slice(prefix.lastIndexOf("]") + 1);
    const cell = `${match[5]}${match[6]}${match[7] ? `:${match[7]}${match[8]}` : ""}`;
    results.push({ workbook, sheet, cell, address: `'[${workbook}]${sheet}'!${cell}`, external: true });
  }
  return results;
}

export function splitFormulaArguments(text) {
  const args = [];
  let current = "", depth = 0, quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { current += '""'; i += 1; continue; }
      quoted = !quoted;
    } else if (!quoted && ch === "(") depth += 1;
    else if (!quoted && ch === ")") depth -= 1;
    if (!quoted && depth === 0 && (ch === "," || ch === ";")) { args.push(current.trim()); current = ""; }
    else current += ch;
  }
  args.push(current.trim());
  return args;
}

export function parseFunctionCall(expression, expectedName = null) {
  const text = String(expression || "").trim().replace(/^=/, "");
  const head = text.match(/^([A-Z][A-Z0-9.]*)\s*\(/i);
  if (!head || (expectedName && head[1].toUpperCase() !== expectedName.toUpperCase())) return null;
  let depth = 0, quoted = false, close = -1;
  for (let i = head[0].length - 1; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    if (quoted) continue;
    if (ch === "(") depth += 1;
    if (ch === ")") { depth -= 1; if (depth === 0) { close = i; break; } }
  }
  if (close < 0 || text.slice(close + 1).trim()) return null;
  return { name: head[1].toUpperCase(), args: splitFormulaArguments(text.slice(head[0].length, close)) };
}

export function parseReferenceToken(token, currentSheet = "") {
  let text = String(token || "").trim();
  if (!text) return null;
  const external = detectExternalReferences(`=${text}`)[0];
  if (external && external.address.replaceAll("$", "").toUpperCase() === text.replaceAll("$", "").toUpperCase()) return external;
  let sheet = currentSheet, range = text;
  const bang = text.lastIndexOf("!");
  if (bang >= 0) {
    sheet = text.slice(0, bang).trim();
    if (sheet.startsWith("'") && sheet.endsWith("'")) sheet = sheet.slice(1, -1).replaceAll("''", "'");
    range = text.slice(bang + 1);
  }
  range = range.replaceAll("$", "");
  if (!/^(?:[A-Z]{1,3}\d+|[A-Z]{1,3}:[A-Z]{1,3}|\d+:\d+)(?::[A-Z]{1,3}\d+)?$/i.test(range)) return null;
  return { workbook: "", sheet, cell: range, address: qualifyAddress(sheet, range), external: false };
}

function scalarLiteral(token) {
  const text = String(token).trim();
  if (/^"(?:[^"]|"")*"$/.test(text)) return { ok: true, value: text.slice(1, -1).replaceAll('""', '"') };
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) return { ok: true, value: Number(text) };
  if (/^(TRUE|FALSE)$/i.test(text)) return { ok: true, value: /^TRUE$/i.test(text) };
  return { ok: false };
}

function sameValue(a, b) {
  if (typeof a === "string" && typeof b === "string") return a.toLocaleUpperCase() === b.toLocaleUpperCase();
  return a === b;
}

function addressAt(rangeAddress, row, col) {
  const parsed = splitQualifiedAddress(rangeAddress);
  const start = parsed.cell.split(":")[0].match(/^([A-Z]+)(\d+)$/i);
  if (!start) return null;
  return qualifyAddress(parsed.sheet, `${numberToCol(colToNumber(start[1]) + col)}${Number(start[2]) + row}`);
}

async function resolveScalar(token, currentSheet, readRange) {
  const literal = scalarLiteral(token);
  if (literal.ok) return { value: literal.value, address: null };
  const ref = parseReferenceToken(token, currentSheet);
  if (!ref || ref.external) return null;
  const data = await readRange(ref);
  if (!data?.values || data.values.length !== 1 || data.values[0].length !== 1) return null;
  return { value: data.values[0][0], address: addressAt(data.address || ref.address, 0, 0) };
}

async function readVector(ref, readRange) {
  if (!ref || ref.external) return null;
  const data = await readRange(ref);
  const values = data?.values;
  if (!Array.isArray(values) || !values.length || !values[0]?.length) return null;
  if (values.length > 1 && values[0].length > 1) return null;
  const vertical = values.length > 1;
  return { ref, address: data.address || ref.address, values: vertical ? values.map((row) => row[0]) : values[0], vertical };
}

function routeFailure(functionName, message, ranges = []) {
  return { status: "unresolved", functionName, message: `実採用セルを特定できません: ${message}`, cells: [], ranges };
}

function routeSuccess(functionName, lookupScalar, matchAddress, returnAddress, ranges) {
  const cells = [];
  if (lookupScalar?.address) cells.push({ address: lookupScalar.address, role: "検索値" });
  cells.push({ address: matchAddress, role: "一致セル" }, { address: returnAddress, role: "返却セル" });
  const unique = [];
  for (const cell of cells) {
    const existing = unique.find((item) => item.address === cell.address);
    if (existing) existing.role = `${existing.role}・${cell.role}`;
    else unique.push({ ...cell });
  }
  return { status: "resolved", functionName, message: "実採用セルを特定しました", cells: unique, ranges };
}

export async function resolveLookupRoute({ formula, currentSheet, readRange }) {
  const outer = parseFunctionCall(formula);
  if (!outer || !LOOKUP_FUNCTIONS.includes(outer.name)) return routeFailure("LOOKUP", "対応関数が式全体の最外層ではありません");
  const fn = outer.name;
  try {
    if (fn === "XLOOKUP") {
      if (outer.args.length < 3) return routeFailure(fn, "引数が不足しています");
      const lookup = await resolveScalar(outer.args[0], currentSheet, readRange);
      const lookupRef = parseReferenceToken(outer.args[1], currentSheet), returnRef = parseReferenceToken(outer.args[2], currentSheet);
      const ranges = [lookupRef?.address, returnRef?.address].filter(Boolean);
      const matchMode = outer.args[4] === undefined || outer.args[4] === "" ? 0 : Number(outer.args[4]);
      const searchMode = outer.args[5] === undefined || outer.args[5] === "" ? 1 : Number(outer.args[5]);
      if (!lookup || matchMode !== 0 || ![1, -1].includes(searchMode)) return routeFailure(fn, "完全一致・先頭/末尾検索の単純式だけに対応しています", ranges);
      const a = await readVector(lookupRef, readRange), b = await readVector(returnRef, readRange);
      if (!a || !b || a.values.length !== b.values.length || a.vertical !== b.vertical) return routeFailure(fn, "検索範囲と返却範囲が同じ向き・同じ長さではありません", ranges);
      const indices = searchMode === -1 ? [...a.values.keys()].reverse() : [...a.values.keys()];
      const index = indices.find((i) => sameValue(a.values[i], lookup.value));
      if (index === undefined) return routeFailure(fn, "完全一致する値がありません", ranges);
      const row = a.vertical ? index : 0, col = a.vertical ? 0 : index;
      const rRow = b.vertical ? index : 0, rCol = b.vertical ? 0 : index;
      return routeSuccess(fn, lookup, addressAt(a.address, row, col), addressAt(b.address, rRow, rCol), ranges);
    }

    if (fn === "VLOOKUP" || fn === "HLOOKUP") {
      if (outer.args.length < 3) return routeFailure(fn, "引数が不足しています");
      const lookup = await resolveScalar(outer.args[0], currentSheet, readRange);
      const tableRef = parseReferenceToken(outer.args[1], currentSheet);
      const ranges = [tableRef?.address].filter(Boolean);
      const indexNumber = Number(outer.args[2]);
      const exact = outer.args[3] !== undefined && /^(?:0|FALSE)$/i.test(outer.args[3].trim());
      if (!lookup || !tableRef || tableRef.external || !Number.isInteger(indexNumber) || !exact) return routeFailure(fn, "完全一致（FALSE/0）の単純式だけに対応しています", ranges);
      const data = await readRange(tableRef), values = data?.values;
      if (!values?.length || !values[0]?.length) return routeFailure(fn, "表範囲を読み取れません", ranges);
      if (fn === "VLOOKUP") {
        if (indexNumber < 1 || indexNumber > values[0].length) return routeFailure(fn, "列番号が表範囲外です", ranges);
        const row = values.findIndex((item) => sameValue(item[0], lookup.value));
        if (row < 0) return routeFailure(fn, "完全一致する値がありません", ranges);
        return routeSuccess(fn, lookup, addressAt(data.address || tableRef.address, row, 0), addressAt(data.address || tableRef.address, row, indexNumber - 1), ranges);
      }
      if (indexNumber < 1 || indexNumber > values.length) return routeFailure(fn, "行番号が表範囲外です", ranges);
      const col = values[0].findIndex((item) => sameValue(item, lookup.value));
      if (col < 0) return routeFailure(fn, "完全一致する値がありません", ranges);
      return routeSuccess(fn, lookup, addressAt(data.address || tableRef.address, 0, col), addressAt(data.address || tableRef.address, indexNumber - 1, col), ranges);
    }

    if (fn === "LOOKUP") {
      if (outer.args.length !== 3) return routeFailure(fn, "ベクトル形式（3引数）だけに対応しています");
      const lookup = await resolveScalar(outer.args[0], currentSheet, readRange);
      const lookupRef = parseReferenceToken(outer.args[1], currentSheet), returnRef = parseReferenceToken(outer.args[2], currentSheet);
      const ranges = [lookupRef?.address, returnRef?.address].filter(Boolean);
      const a = await readVector(lookupRef, readRange), b = await readVector(returnRef, readRange);
      if (!lookup || !a || !b || a.values.length !== b.values.length || a.vertical !== b.vertical) return routeFailure(fn, "検索・返却ベクトルを安全に対応付けられません", ranges);
      if (!a.values.every((value) => typeof value === typeof lookup.value && (typeof value === "number" || typeof value === "string"))) return routeFailure(fn, "検索値と同じ型の数値または文字列だけで構成されたベクトルではありません", ranges);
      const sorted = a.values.every((value, i) => i === 0 || a.values[i - 1] <= value);
      if (!sorted) return routeFailure(fn, "検索ベクトルが昇順ではありません", ranges);
      let index = -1;
      for (let i = 0; i < a.values.length; i += 1) if (a.values[i] <= lookup.value) index = i;
      if (index < 0) return routeFailure(fn, "採用位置がありません", ranges);
      return routeSuccess(fn, lookup, addressAt(a.address, a.vertical ? index : 0, a.vertical ? 0 : index), addressAt(b.address, b.vertical ? index : 0, b.vertical ? 0 : index), ranges);
    }

    if (fn === "INDEX") {
      const arrayRef = parseReferenceToken(outer.args[0], currentSheet);
      const nestedArgIndex = outer.args.findIndex((arg, i) => i > 0 && /^(?:MATCH|XMATCH)\s*\(/i.test(arg.trim()));
      const match = nestedArgIndex >= 0 ? parseFunctionCall(outer.args[nestedArgIndex]) : null;
      const ranges = [arrayRef?.address].filter(Boolean);
      if (!arrayRef || arrayRef.external || !match || !["MATCH", "XMATCH"].includes(match.name)) return routeFailure("INDEX", "INDEXとMATCH/XMATCHの単純な組み合わせではありません", ranges);
      const lookup = await resolveScalar(match.args[0], currentSheet, readRange);
      const lookupRef = parseReferenceToken(match.args[1], currentSheet);
      if (lookupRef?.address) ranges.push(lookupRef.address);
      const matchMode = match.name === "MATCH" ? Number(match.args[2]) : (match.args[2] === undefined || match.args[2] === "" ? 0 : Number(match.args[2]));
      const searchMode = match.name === "XMATCH" && match.args[3] !== undefined && match.args[3] !== "" ? Number(match.args[3]) : 1;
      if (!lookup || matchMode !== 0 || ![1, -1].includes(searchMode)) return routeFailure(`INDEX+${match.name}`, "完全一致・先頭/末尾検索のMATCH/XMATCHだけに対応しています", ranges);
      const vector = await readVector(lookupRef, readRange), arrayData = await readRange(arrayRef);
      if (!vector || !arrayData?.values?.length || !arrayData.values[0]?.length) return routeFailure(`INDEX+${match.name}`, "参照範囲を読み取れません", ranges);
      const indices = searchMode === -1 ? [...vector.values.keys()].reverse() : [...vector.values.keys()];
      const index = indices.find((i) => sameValue(vector.values[i], lookup.value)) ?? -1;
      if (index < 0) return routeFailure(`INDEX+${match.name}`, "完全一致する値がありません", ranges);
      let row = 0, col = 0;
      if (nestedArgIndex === 1) {
        row = index;
        col = outer.args[2] ? Number(outer.args[2]) - 1 : 0;
      } else if (nestedArgIndex === 2) {
        row = outer.args[1] ? Number(outer.args[1]) - 1 : 0;
        col = index;
      } else return routeFailure(`INDEX+${match.name}`, "MATCH/XMATCHの位置を解釈できません", ranges);
      if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row >= arrayData.values.length || col >= arrayData.values[0].length) return routeFailure(`INDEX+${match.name}`, "INDEXの行・列が範囲外です", ranges);
      const matchAddress = addressAt(vector.address, vector.vertical ? index : 0, vector.vertical ? 0 : index);
      return routeSuccess(`INDEX+${match.name}`, lookup, matchAddress, addressAt(arrayData.address || arrayRef.address, row, col), ranges);
    }
  } catch (error) {
    return routeFailure(fn, error?.message || "解析中にエラーが発生しました");
  }
  return routeFailure(fn, "この形式には対応していません");
}

export function getNodeHighlightAttributes(node) {
  const attrs = [];
  for (const fn of ["ROUND", "ROUNDDOWN", "ROUNDUP"]) if (node.roundingFunctions?.includes(fn)) attrs.push(fn);
  if (node.hiddenFraction) attrs.push("fraction");
  if (node.isLookup) attrs.push("lookup");
  if (node.hasExternalReference || node.isExternalReference) attrs.push("external");
  if (node.isError) attrs.push("error");
  return attrs;
}

export function applyNodeDrag(position, deltaX, deltaY, scale = 1) {
  return { x: position.x + deltaX / scale, y: position.y + deltaY / scale };
}

export function clampGraphZoom(scale, min = 0.25, max = 3) {
  return Math.min(max, Math.max(min, Number(scale) || 1));
}

export function zoomViewportAtPoint(viewport, nextScale, pointer) {
  const scale = clampGraphZoom(nextScale);
  const current = clampGraphZoom(viewport.scale);
  const graphX = (pointer.x - viewport.panX) / current;
  const graphY = (pointer.y - viewport.panY) / current;
  return {
    scale,
    panX: pointer.x - graphX * scale,
    panY: pointer.y - graphY * scale
  };
}

export function panGraphViewport(viewport, deltaX, deltaY) {
  return { ...viewport, panX: viewport.panX + deltaX, panY: viewport.panY + deltaY };
}

export function classifyReferenceNode(node) {
  const ranges = Array.isArray(node.rangeAddresses) && node.rangeAddresses.length ? node.rangeAddresses : [node.address].filter(Boolean);
  if (ranges.length > 1) return { kind: "multiple", label: "複数範囲", addresses: ranges };
  const cellPart = String(ranges[0] || "").slice(String(ranges[0] || "").lastIndexOf("!") + 1);
  if (cellPart.includes(":")) return { kind: "range", label: "範囲", addresses: ranges };
  return { kind: "cell", label: "セル", addresses: ranges };
}

export function filterLookupRangeNodes(graph, expandedLookupIds = new Set()) {
  const hiddenIds = new Set();
  for (const edge of graph.edges) {
    if (edge.kind === "lookup-full-range" && !expandedLookupIds.has(edge.to)) hiddenIds.add(edge.from);
  }
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => !hiddenIds.has(node.id)),
    edges: graph.edges.filter((edge) => !hiddenIds.has(edge.from) && !hiddenIds.has(edge.to))
  };
}

export function rankRoundCandidates(nodes) {
  return nodes
    .filter((node) => node.isRoundCandidate)
    .sort((a, b) => {
      if (a.hiddenFraction !== b.hiddenFraction) return Number(b.hiddenFraction) - Number(a.hiddenFraction);
      if ((a.depth ?? 0) !== (b.depth ?? 0)) return (a.depth ?? 0) - (b.depth ?? 0);
      return Math.abs(b.roundDelta) - Math.abs(a.roundDelta);
    });
}

export function graphSummary(nodes) {
  return {
    nodeCount: nodes.length,
    formulaCount: nodes.filter((n) => n.formula).length,
    hiddenFractionCount: nodes.filter((n) => n.hiddenFraction).length,
    roundedCount: nodes.filter((n) => n.roundingFunctions?.length).length,
    candidateCount: nodes.filter((n) => n.isRoundCandidate).length
  };
}
