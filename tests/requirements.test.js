import test from "node:test";
import assert from "node:assert/strict";
import {
  createDepthChoices, parseReferenceToken, detectExternalReferences,
  applyNodeDrag, resolveLookupRoute, getNodeHighlightAttributes,
  filterLookupRangeNodes, analyzeNode
} from "../src/core.js";

function reader(entries) {
  const map = new Map(Object.entries(entries));
  return async (ref) => {
    const item = map.get(ref.address);
    if (!item) throw new Error(`No mock range: ${ref.address}`);
    return { address: item.address || ref.address, values: item.values };
  };
}

const baseRanges = {
  "'S'!A1": { values:[["K2"]] },
  "'S'!B2:B4": { values:[["K1"],["K2"],["K3"]] },
  "'S'!C2:C4": { values:[[10],[20],[30]] },
  "'S'!B2:C4": { values:[["K1",10],["K2",20],["K3",30]] },
  "'S'!B2:D3": { values:[["K1","K2","K3"],[10,20,30]] },
  "'S'!D2:D4": { values:[[100],[200],[300]] },
  "'S'!N2:N4": { values:[[1],[5],[10]] }
};

test("requirement 1: depth choices are exactly 1 through 20", () => {
  assert.deepEqual(createDepthChoices(20), Array.from({length:20}, (_,i)=>i+1));
});

test("requirement 2: same-book and external references are classified without opening files", () => {
  assert.deepEqual(parseReferenceToken("'料金'!$B$12", "S"), { workbook:"", sheet:"料金", cell:"B12", address:"'料金'!B12", external:false });
  const refs = detectExternalReferences("='[Rates.xlsx]単価'!$B$7+1");
  assert.equal(refs.length, 1);
  assert.equal(refs[0].workbook, "Rates.xlsx");
  assert.equal(refs[0].sheet, "単価");
});

test("requirement 3: node drag applies pointer delta adjusted for zoom", () => {
  assert.deepEqual(applyNodeDrag({x:100,y:50}, 40, -20, 2), {x:120,y:40});
});

test("requirement 4: XLOOKUP resolves search, match, and return cells", async () => {
  const route = await resolveLookupRoute({ formula:"=XLOOKUP(A1,B2:B4,C2:C4)", currentSheet:"S", readRange:reader(baseRanges) });
  assert.equal(route.status, "resolved");
  assert.deepEqual(route.cells, [
    {address:"'S'!A1",role:"検索値"}, {address:"'S'!B3",role:"一致セル"}, {address:"'S'!C3",role:"返却セル"}
  ]);
});

test("requirement 4: VLOOKUP and HLOOKUP exact routes resolve", async () => {
  const read = reader(baseRanges);
  const v = await resolveLookupRoute({ formula:"=VLOOKUP(A1,B2:C4,2,FALSE)", currentSheet:"S", readRange:read });
  assert.equal(v.status, "resolved"); assert.equal(v.cells.at(-1).address, "'S'!C3");
  const h = await resolveLookupRoute({ formula:"=HLOOKUP(A1,B2:D3,2,FALSE)", currentSheet:"S", readRange:read });
  assert.equal(h.status, "resolved"); assert.equal(h.cells.at(-1).address, "'S'!C3");
});

test("requirement 4: LOOKUP vector route resolves only with safe sorted input", async () => {
  const route = await resolveLookupRoute({ formula:"=LOOKUP(6,N2:N4,D2:D4)", currentSheet:"S", readRange:reader(baseRanges) });
  assert.equal(route.status, "resolved");
  assert.equal(route.cells.at(-1).address, "'S'!D3");
});

test("requirement 4: INDEX+MATCH and INDEX+XMATCH exact routes resolve", async () => {
  const read = reader(baseRanges);
  const match = await resolveLookupRoute({ formula:"=INDEX(D2:D4,MATCH(A1,B2:B4,0))", currentSheet:"S", readRange:read });
  assert.equal(match.status, "resolved"); assert.equal(match.cells.at(-1).address, "'S'!D3");
  const xmatch = await resolveLookupRoute({ formula:"=INDEX(D2:D4,XMATCH(A1,B2:B4,0))", currentSheet:"S", readRange:read });
  assert.equal(xmatch.status, "resolved"); assert.equal(xmatch.cells.at(-1).address, "'S'!D3");
});

test("requirement 4: complex lookup refuses to guess and full ranges stay expandable", async () => {
  const route = await resolveLookupRoute({ formula:"=XLOOKUP(A1,B2:B4,C2:C4,,2)", currentSheet:"S", readRange:reader(baseRanges) });
  assert.equal(route.status, "unresolved");
  assert.match(route.message, /実採用セルを特定できません/);
  const graph = { nodes:[{id:"lookup"},{id:"range"}], edges:[{from:"range",to:"lookup",kind:"lookup-full-range"}] };
  assert.deepEqual(filterLookupRangeNodes(graph,new Set()).nodes.map(n=>n.id),["lookup"]);
  assert.deepEqual(filterLookupRangeNodes(graph,new Set(["lookup"])).nodes.map(n=>n.id),["lookup","range"]);
});

test("requirement 5: multiple highlight attributes coexist", () => {
  const node = analyzeNode({ id:"n", formula:"=ROUND(XLOOKUP(A1,B:B,C:C),0)+'[Rates.xlsx]S'!A1", value:"#N/A", numberFormat:"0" });
  assert.deepEqual(getNodeHighlightAttributes(node), ["ROUND","lookup","external","error"]);
  const fraction = analyzeNode({ id:"f", formula:"=A1/3", value:1.25, numberFormat:"0" });
  assert.deepEqual(getNodeHighlightAttributes(fraction), ["fraction"]);
});
