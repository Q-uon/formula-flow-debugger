import {
  splitQualifiedAddress, qualifyAddress, splitAreas, expandQualifiedArea,
  getFormulaText, analyzeNode, resolveLookupRoute, parseReferenceToken
} from "./core.js";

const isExcelHost = () => Boolean(globalThis.Office?.context?.host === globalThis.Office?.HostType?.Excel && globalThis.Excel);

function first(matrix, fallback = "") {
  return Array.isArray(matrix) && Array.isArray(matrix[0]) ? matrix[0][0] : fallback;
}

function normalizeAddress(address, fallbackSheet = "") {
  if (String(address).includes("!")) {
    const parsed = splitQualifiedAddress(address);
    return qualifyAddress(parsed.sheet, parsed.cell);
  }
  return qualifyAddress(fallbackSheet, address);
}

function columnName(value) {
  let result = "";
  while (value > 0) { const rem = (value - 1) % 26; result = String.fromCharCode(65 + rem) + result; value = Math.floor((value - 1) / 26); }
  return result;
}

async function readRangeData(context, ref) {
  if (!ref || ref.external) throw new Error("外部ブックの範囲はこのアドインから読み取れません。");
  const worksheet = context.workbook.worksheets.getItem(ref.sheet);
  let range;
  const fullColumns = ref.cell.match(/^([A-Z]{1,3}):([A-Z]{1,3})$/i);
  const fullRows = ref.cell.match(/^(\d+):(\d+)$/);
  if (fullColumns || fullRows) {
    const used = worksheet.getUsedRangeOrNullObject(true);
    used.load("rowIndex,rowCount,columnIndex,columnCount");
    await context.sync();
    if (used.isNullObject) return { address: ref.address, values: [] };
    if (fullColumns) {
      const firstRow = used.rowIndex + 1, lastRow = used.rowIndex + used.rowCount;
      range = worksheet.getRange(`${fullColumns[1]}${firstRow}:${fullColumns[2]}${lastRow}`);
    } else {
      const firstCol = columnName(used.columnIndex + 1), lastCol = columnName(used.columnIndex + used.columnCount);
      range = worksheet.getRange(`${firstCol}${fullRows[1]}:${lastCol}${fullRows[2]}`);
    }
  } else {
    range = worksheet.getRange(ref.cell);
  }
  range.load("address,rowCount,columnCount");
  await context.sync();
  if (range.rowCount * range.columnCount > 50000) throw new Error(`${ref.address} は50,000セルを超えるため、実採用経路を安全に解析しません。`);
  range.load("values");
  await context.sync();
  return { address: normalizeAddress(range.address, ref.sheet), values: range.values };
}

async function readCell(context, qualifiedAddress, depth, isTarget = false, roles = []) {
  const { sheet, cell } = splitQualifiedAddress(qualifiedAddress);
  const range = context.workbook.worksheets.getItem(sheet).getRange(cell);
  range.load("address,values,text,formulas,numberFormat");
  await context.sync();
  return analyzeNode({
    id: qualifyAddress(sheet, cell), address: qualifyAddress(sheet, cell),
    value: first(range.values, ""), displayValue: first(range.text, ""),
    formula: getFormulaText(range.formulas), numberFormat: first(range.numberFormat, "General"),
    depth, isTarget, lookupRoles: roles
  });
}

function makeRangeSummary(address, total, depth, options = {}) {
  return analyzeNode({
    id: `${options.isLookupRangeSummary ? "lookup-range" : "range"}:${address}`,
    address, value: "", displayValue: total == null ? "参照範囲" : `${total.toLocaleString("ja-JP")}セル`,
    formula: "", numberFormat: "", depth, isRangeSummary: true,
    isLookupRangeSummary: Boolean(options.isLookupRangeSummary), rangeCellCount: total
  });
}


function makeMultiRangeSummary(addresses, total, depth, options = {}) {
  const unique = [...new Set(addresses)];
  return analyzeNode({
    id: `${options.isLookupRangeSummary ? "lookup-ranges" : "ranges"}:${unique.join("|")}`,
    address: `${unique.length}個の参照範囲`, rangeAddresses: unique,
    value: "", displayValue: total == null ? `${unique.length}範囲` : `${total.toLocaleString("ja-JP")}セル / ${unique.length}範囲`,
    formula: "", numberFormat: "", depth, isRangeSummary: true,
    isLookupRangeSummary: Boolean(options.isLookupRangeSummary), rangeCellCount: total
  });
}

async function directPrecedentAddresses(context, qualifiedAddress, rangeCellLimit, foldRanges = false) {
  const { sheet, cell } = splitQualifiedAddress(qualifiedAddress);
  const source = context.workbook.worksheets.getItem(sheet).getRange(cell);
  const areas = source.getDirectPrecedents();
  areas.areas.load("address,worksheet/name");
  try {
    await context.sync();
  } catch (error) {
    const code = error?.code || error?.debugInfo?.code;
    if (code === "ItemNotFound") return { cells: [], summaries: [], warnings: [] };
    return { cells: [], summaries: [], warnings: [`${qualifiedAddress} の参照元をExcel APIから取得できませんでした。`] };
  }

  const cells = [], summaries = [], warnings = [];
  for (const area of areas.areas.items) {
    const areaSheet = area.worksheet?.name || sheet;
    for (const rawPart of splitAreas(area.address)) {
      const normalizedArea = normalizeAddress(rawPart, areaSheet);
      const expanded = expandQualifiedArea(normalizedArea, rangeCellLimit);
      const isRange = splitQualifiedAddress(normalizedArea).cell.includes(":");
      if (expanded.truncated || (foldRanges && isRange && expanded.total !== 1)) {
        summaries.push(makeRangeSummary(normalizedArea, expanded.total, 0));
        warnings.push(`${normalizedArea} は折り畳んだ参照範囲として表示しました。`);
        continue;
      }
      cells.push(...expanded.cells);
    }
  }
  return { cells: [...new Set(cells)], summaries, warnings };
}

function addSummary(nodes, edges, summary, target, depth, kind = "range") {
  const node = { ...summary, depth };
  nodes.set(node.id, node);
  edges.push({ from: node.id, to: target, kind });
}

export async function readActiveCellAddress() {
  if (!isExcelHost()) return "'請求額'!H35";
  return Excel.run(async (context) => {
    const cell = context.workbook.getActiveCell();
    const sheet = context.workbook.worksheets.getActiveWorksheet();
    cell.load("address"); sheet.load("name");
    await context.sync();
    return normalizeAddress(cell.address, sheet.name);
  });
}

export async function analyzeWorkbook({ maxDepth = 3, maxCells = 150, rangeCellLimit = 80 } = {}) {
  if (!isExcelHost()) return createDemoGraph();
  const depthLimit = Math.max(1, Math.min(20, Number(maxDepth) || 3));

  return Excel.run(async (context) => {
    const active = context.workbook.getActiveCell();
    const activeSheet = context.workbook.worksheets.getActiveWorksheet();
    active.load("address"); activeSheet.load("name");
    await context.sync();
    const targetAddress = normalizeAddress(active.address, activeSheet.name);

    const nodes = new Map(), edges = [], warnings = [];
    const queue = [{ address: targetAddress, depth: 0 }];
    const queued = new Set([targetAddress]);
    const roles = new Map();

    const enqueue = (address, depth, target, kind = "normal", role = "") => {
      edges.push({ from: address, to: target, kind, role });
      if (role) {
        if (!roles.has(address)) roles.set(address, new Set());
        roles.get(address).add(role);
      }
      if (!queued.has(address) && nodes.size + queue.length < maxCells) {
        queue.push({ address, depth }); queued.add(address);
      }
    };

    while (queue.length && nodes.size < maxCells) {
      const current = queue.shift();
      const node = await readCell(context, current.address, current.depth, current.depth === 0, [...(roles.get(current.address) || [])]);
      nodes.set(current.address, node);

      for (const external of node.externalReferences || []) {
        const id = `external:${external.address}`;
        if (!nodes.has(id)) nodes.set(id, analyzeNode({
          id, address: external.address, displayValue: "外部ブック参照", value: "", formula: "",
          numberFormat: "", depth: current.depth + 1, isExternalReference: true,
          externalWorkbook: external.workbook, externalSheet: external.sheet, externalCell: external.cell
        }));
        edges.push({ from: id, to: current.address, kind: "external" });
      }

      if (!node.formula || current.depth >= depthLimit) continue;

      if (node.isLookup) {
        const { sheet } = splitQualifiedAddress(current.address);
        const route = await resolveLookupRoute({
          formula: node.formula, currentSheet: sheet,
          readRange: (ref) => readRangeData(context, ref)
        });
        node.lookupResolution = route;
        if (route.status === "resolved") {
          for (const cell of route.cells) enqueue(cell.address, current.depth + 1, current.address, "lookup-actual", cell.role);
          const fullRanges = [...new Set(route.ranges)];
          let total = 0, totalKnown = true;
          for (const rangeAddress of fullRanges) {
            const ref = parseReferenceToken(rangeAddress, sheet);
            try {
              const data = await readRangeData(context, ref);
              total += data.values?.reduce((sum, row) => sum + row.length, 0) ?? 0;
            } catch { totalKnown = false; }
          }
          const summary = fullRanges.length > 1
            ? makeMultiRangeSummary(fullRanges, totalKnown ? total : null, current.depth + 1, { isLookupRangeSummary: true })
            : makeRangeSummary(fullRanges[0], totalKnown ? total : null, current.depth + 1, { isLookupRangeSummary: true });
          addSummary(nodes, edges, summary, current.address, current.depth + 1, "lookup-full-range");
          continue;
        }
        warnings.push(`${current.address}: ${route.message}`);
        const fallback = await directPrecedentAddresses(context, current.address, rangeCellLimit, true);
        warnings.push(...fallback.warnings);
        for (const summary of fallback.summaries) addSummary(nodes, edges, summary, current.address, current.depth + 1, "lookup-folded-range");
        for (const precedent of fallback.cells) enqueue(precedent, current.depth + 1, current.address, "lookup-fallback");
        continue;
      }

      const result = await directPrecedentAddresses(context, current.address, rangeCellLimit, false);
      warnings.push(...result.warnings);
      for (const summary of result.summaries) addSummary(nodes, edges, summary, current.address, current.depth + 1);
      for (const precedent of result.cells) enqueue(precedent, current.depth + 1, current.address);
    }

    for (const [address, roleSet] of roles.entries()) {
      const node = nodes.get(address);
      if (node) node.lookupRoles = [...roleSet];
    }
    if (queue.length) warnings.push(`最大セル数 ${maxCells} に達したため、残りの参照元は省略しました。`);
    return { nodes: [...nodes.values()], edges, warnings: [...new Set(warnings)], targetAddress, isDemo: false, maxDepth: depthLimit };
  });
}

export async function navigateReference(reference) {
  const addresses = Array.isArray(reference?.rangeAddresses) && reference.rangeAddresses.length
    ? reference.rangeAddresses : [typeof reference === "string" ? reference : reference?.address].filter(Boolean);
  const external = parseReferenceToken(addresses[0], "");
  if (external?.external) {
    const error = new Error(`外部ブック [${external.workbook}] の参照です。Office.jsでは開いている別ブックの列挙・選択ができないため、このアドインからは移動できません。ブックを自動で開くことはしません。`);
    error.code = "ExternalWorkbookNavigationUnavailable";
    throw error;
  }
  if (!isExcelHost()) return { status: "demo" };
  const parsed = addresses.map((address) => splitQualifiedAddress(address));
  return Excel.run(async (context) => {
    const first = parsed[0];
    const worksheet = context.workbook.worksheets.getItem(first.sheet);
    worksheet.activate();
    if (parsed.length === 1) {
      worksheet.getRange(first.cell).select();
      await context.sync();
      return { status: "selected", selectionKind: first.cell.includes(":") ? "range" : "cell", addresses };
    }

    const sameSheet = parsed.every((item) => item.sheet === first.sheet);
    if (sameSheet && typeof worksheet.getRanges === "function") {
      try {
        const areas = worksheet.getRanges(parsed.map((item) => item.cell).join(","));
        if (typeof areas.select === "function") {
          areas.select();
          await context.sync();
          return { status: "selected", selectionKind: "multiple", addresses };
        }
      } catch { /* runtime does not support selecting RangeAreas; fall back explicitly */ }
    }
    worksheet.getRange(first.cell).select();
    await context.sync();
    return {
      status: "partial", selectionKind: "multiple", addresses, selectedAddress: addresses[0],
      message: `Office.jsの制約により${addresses.length}個の範囲を一括選択できなかったため、先頭の範囲 ${addresses[0]} へ移動しました。`
    };
  });
}

export async function jumpToCell(address) {
  return navigateReference(address);
}

export function excelAvailable() { return isExcelHost(); }

export function createDemoGraph() {
  const raw = [
    { address:"'請求額'!H35", value:1234567.6234, displayValue:"1,234,568", formula:"=F35+G35+J35", numberFormat:"#,##0", depth:0, isTarget:true },
    { address:"'請求額'!F35", value:456789, displayValue:"456,789", formula:"=ROUND(B35+C35,0)", numberFormat:"#,##0", depth:1 },
    { address:"'請求額'!G35", value:777778.6234, displayValue:"777,779", formula:"=D35*E35", numberFormat:"#,##0", depth:1 },
    { address:"'請求額'!J35", value:"#N/A", displayValue:"#N/A", formula:"=XLOOKUP(A35,'割引'!A2:A5001,'割引'!C2:C5001)", numberFormat:"#,##0", depth:1, lookupResolution:{ status:"resolved", functionName:"XLOOKUP", message:"実採用セルを特定しました", cells:[], ranges:["'割引'!A2:A5001","'割引'!C2:C5001"] } },
    { address:"'請求額'!B35", value:420000.3, displayValue:"420,000", formula:"='基本料金'!D18*B4", numberFormat:"#,##0", depth:2 },
    { address:"'請求額'!C35", value:36788.4, displayValue:"36,788", formula:"='割引'!C12", numberFormat:"#,##0", depth:2 },
    { address:"'請求額'!D35", value:12345.67, displayValue:"12,345.67", formula:"='使用量'!D35", numberFormat:"#,##0.00", depth:2 },
    { address:"'請求額'!E35", value:63.0012, displayValue:"63.0012", formula:"='単価'!E18", numberFormat:"0.0000", depth:2 },
    { address:"'請求額'!A35", value:"A-100", displayValue:"A-100", formula:"", numberFormat:"General", depth:2, lookupRoles:["検索値"] },
    { address:"'割引'!A12", value:"A-100", displayValue:"A-100", formula:"", numberFormat:"General", depth:2, lookupRoles:["一致セル"] },
    { address:"'割引'!C12", value:36788.4, displayValue:"36,788", formula:"=C8*C9", numberFormat:"#,##0", depth:2, lookupRoles:["返却セル"] },
    { id:"lookup-ranges:discount", address:"2個の参照範囲", rangeAddresses:["'割引'!A2:A5001","'割引'!C2:C5001"], value:"", displayValue:"10,000セル / 2範囲", formula:"", numberFormat:"", depth:2, isRangeSummary:true, isLookupRangeSummary:true, rangeCellCount:10000 },
    { id:"external:'[Rates.xlsx]単価'!B7", address:"'[Rates.xlsx]単価'!B7", value:"", displayValue:"外部ブック参照", formula:"", numberFormat:"", depth:3, isExternalReference:true, externalWorkbook:"Rates.xlsx", externalSheet:"単価", externalCell:"B7" }
  ];
  const nodes = raw.map((n) => analyzeNode({ ...n, id:n.id || n.address }));
  const edges = [
    ["'請求額'!F35","'請求額'!H35","normal"],["'請求額'!G35","'請求額'!H35","normal"],["'請求額'!J35","'請求額'!H35","normal"],
    ["'請求額'!B35","'請求額'!F35","normal"],["'請求額'!C35","'請求額'!F35","normal"],["'請求額'!D35","'請求額'!G35","normal"],["'請求額'!E35","'請求額'!G35","normal"],
    ["'請求額'!A35","'請求額'!J35","lookup-actual"],["'割引'!A12","'請求額'!J35","lookup-actual"],["'割引'!C12","'請求額'!J35","lookup-actual"],
    ["lookup-ranges:discount","'請求額'!J35","lookup-full-range"],
    ["external:'[Rates.xlsx]単価'!B7","'請求額'!E35","external"]
  ].map(([from,to,kind]) => ({ from,to,kind }));
  return { nodes, edges, warnings:["デモデータを表示しています。"], targetAddress:"'請求額'!H35", isDemo:true, maxDepth:3 };
}
