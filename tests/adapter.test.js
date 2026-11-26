import test from "node:test";
import assert from "node:assert/strict";
import { createDemoGraph, jumpToCell } from "../src/excel-adapter.js";

test("demo graph contains actual lookup route, folded full ranges, and an external node", () => {
  const graph = createDemoGraph();
  assert.ok(graph.edges.some((edge) => edge.kind === "lookup-actual"));
  assert.ok(graph.edges.some((edge) => edge.kind === "lookup-full-range"));
  assert.ok(graph.nodes.some((node) => node.isExternalReference));
});

test("external workbook navigation never auto-opens a workbook", async () => {
  await assert.rejects(() => jumpToCell("'[Rates.xlsx]単価'!B7"), (error) => {
    assert.equal(error.code, "ExternalWorkbookNavigationUnavailable");
    assert.match(error.message, /自動で開くことはしません/);
    return true;
  });
});

test("same-workbook navigation is a no-op demo outside Excel", async () => {
  assert.deepEqual(await jumpToCell("'単価'!B7"), { status:"demo" });
});
