import test from "node:test";
import assert from "node:assert/strict";
import {
  splitQualifiedAddress, qualifyAddress, splitAreas, expandQualifiedArea,
  detectRoundingFunctions, fractionalPart, decimalPlacesFromFormat,
  analyzeNode, rankRoundCandidates, graphSummary, detectLookupFunctions
} from "../src/core.js";

test("quoted worksheet address is parsed and rebuilt", () => {
  assert.deepEqual(splitQualifiedAddress("'売上''西'!$B$12"), { sheet: "売上'西", cell: "B12" });
  assert.equal(qualifyAddress("売上'西", "B12"), "'売上''西'!B12");
});

test("area list respects commas inside quoted sheet names", () => {
  assert.deepEqual(splitAreas("'東,西'!A1:B2,'単価'!C3"), ["'東,西'!A1:B2", "'単価'!C3"]);
});

test("small range expands in row-major order", () => {
  assert.deepEqual(expandQualifiedArea("'料金'!A1:B2", 4), {
    cells: ["'料金'!A1", "'料金'!B1", "'料金'!A2", "'料金'!B2"], truncated: false, total: 4
  });
  assert.equal(expandQualifiedArea("'料金'!A1:B2", 3).truncated, true);
});

test("rounding functions and hidden fractions are detected", () => {
  assert.deepEqual(detectRoundingFunctions("=ROUNDUP(A1,0)+FLOOR.MATH(B1)"), ["ROUNDUP", "FLOOR.MATH"]);
  assert.equal(fractionalPart(100.25), 0.25);
  assert.equal(decimalPlacesFromFormat("#,##0.00"), 2);
  const node = analyzeNode({ id:"x", formula:"=A1*B1", value:10.6, numberFormat:"#,##0", depth:1 });
  assert.equal(node.hiddenFraction, true);
  assert.equal(node.isRoundCandidate, true);
});

test("candidate ranking and graph summary remain available", () => {
  const nodes = [
    analyzeNode({ id:"far", formula:"=A1/3", value:1.2, numberFormat:"0.00", depth:3 }),
    analyzeNode({ id:"near", formula:"=B1/3", value:2.2, numberFormat:"0", depth:1 })
  ];
  assert.equal(rankRoundCandidates(nodes)[0].id, "near");
  assert.deepEqual(graphSummary(nodes), { nodeCount:2, formulaCount:2, hiddenFractionCount:1, roundedCount:0, candidateCount:2 });
});

test("lookup functions are detected", () => {
  assert.deepEqual(detectLookupFunctions("=XLOOKUP(A1,B:B,C:C)+INDEX(D:D,MATCH(A1,E:E,0))"), ["XLOOKUP", "INDEX", "MATCH"]);
});
