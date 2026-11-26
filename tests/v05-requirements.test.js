import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  clampGraphZoom, zoomViewportAtPoint, panGraphViewport, classifyReferenceNode
} from "../src/core.js";
import { createDemoGraph, navigateReference } from "../src/excel-adapter.js";

const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");

test("v0.5 requirement 1: graph zoom is clamped from 25% through 300%", () => {
  assert.equal(clampGraphZoom(0.1), 0.25);
  assert.equal(clampGraphZoom(1.75), 1.75);
  assert.equal(clampGraphZoom(4), 3);
});

test("v0.5 requirement 1: pointer-centered zoom preserves the graph point under pointer", () => {
  const before = { scale:1, panX:40, panY:-20 };
  const pointer = { x:240, y:180 };
  const graphPoint = { x:(pointer.x-before.panX)/before.scale, y:(pointer.y-before.panY)/before.scale };
  const after = zoomViewportAtPoint(before, 2, pointer);
  assert.equal(after.panX + graphPoint.x * after.scale, pointer.x);
  assert.equal(after.panY + graphPoint.y * after.scale, pointer.y);
});

test("v0.5 requirement 2: background pan changes only viewport translation", () => {
  assert.deepEqual(panGraphViewport({scale:1.5,panX:10,panY:20}, -30, 15), {scale:1.5,panX:-20,panY:35});
});

test("v0.5 requirement 3: cell, one range, and multiple ranges are classified", () => {
  assert.deepEqual(classifyReferenceNode({address:"'S'!B2"}), {kind:"cell",label:"セル",addresses:["'S'!B2"]});
  assert.deepEqual(classifyReferenceNode({address:"'S'!B2:B1000"}), {kind:"range",label:"範囲",addresses:["'S'!B2:B1000"]});
  assert.deepEqual(classifyReferenceNode({address:"2個",rangeAddresses:["'S'!A1:A3","'S'!C1:C3"]}), {kind:"multiple",label:"複数範囲",addresses:["'S'!A1:A3","'S'!C1:C3"]});
});

test("v0.5 requirement 3: demo exposes a grouped multi-range lookup node", () => {
  const node = createDemoGraph().nodes.find((item) => item.rangeAddresses?.length > 1);
  assert.ok(node);
  assert.equal(classifyReferenceNode(node).label, "複数範囲");
});

test("v0.5 requirement 3: multiple-range fallback selects first range and explicitly reports partial selection", async () => {
  const savedOffice = globalThis.Office, savedExcel = globalThis.Excel;
  const selected = [];
  const worksheet = {
    activate() {},
    getRange(cell) { return { select() { selected.push(cell); } }; },
    getRanges() { return {}; }
  };
  globalThis.Office = { context:{host:"Excel"}, HostType:{Excel:"Excel"} };
  globalThis.Excel = { run: async (callback) => callback({ workbook:{worksheets:{getItem:()=>worksheet}}, sync:async()=>{} }) };
  try {
    const result = await navigateReference({ rangeAddresses:["'S'!A1:A3","'S'!C1:C3"] });
    assert.equal(result.status, "partial");
    assert.deepEqual(selected, ["A1:A3"]);
    assert.match(result.message, /一括選択できなかった/);
    assert.match(result.message, /先頭の範囲/);
  } finally {
    globalThis.Office = savedOffice; globalThis.Excel = savedExcel;
  }
});

test("v0.5 requirement 3: a single folded range selects the whole range", async () => {
  const savedOffice = globalThis.Office, savedExcel = globalThis.Excel;
  const selected = [];
  const worksheet = { activate() {}, getRange(cell) { return { select() { selected.push(cell); } }; } };
  globalThis.Office = { context:{host:"Excel"}, HostType:{Excel:"Excel"} };
  globalThis.Excel = { run: async (callback) => callback({ workbook:{worksheets:{getItem:()=>worksheet}}, sync:async()=>{} }) };
  try {
    const result = await navigateReference({ address:"'売上明細'!B2:B1000", isRangeSummary:true });
    assert.equal(result.status, "selected");
    assert.equal(result.selectionKind, "range");
    assert.deepEqual(selected, ["B2:B1000"]);
  } finally {
    globalThis.Office = savedOffice; globalThis.Excel = savedExcel;
  }
});

test("v0.5 requirement 3: multiple same-sheet ranges are selected together when runtime supports it", async () => {
  const savedOffice = globalThis.Office, savedExcel = globalThis.Excel;
  let selectedExpression = "";
  const worksheet = {
    activate() {},
    getRange() { return { select() { throw new Error("fallback should not run"); } }; },
    getRanges(expression) { return { select() { selectedExpression = expression; } }; }
  };
  globalThis.Office = { context:{host:"Excel"}, HostType:{Excel:"Excel"} };
  globalThis.Excel = { run: async (callback) => callback({ workbook:{worksheets:{getItem:()=>worksheet}}, sync:async()=>{} }) };
  try {
    const result = await navigateReference({ rangeAddresses:["'S'!A1:A3","'S'!C1:C3"] });
    assert.equal(result.status, "selected");
    assert.equal(result.selectionKind, "multiple");
    assert.equal(selectedExpression, "A1:A3,C1:C3");
  } finally {
    globalThis.Office = savedOffice; globalThis.Excel = savedExcel;
  }
});

test("v0.5 UI contract: zoom controls, wheel zoom, pan, and separated node drag exist", () => {
  for (const id of ["zoom-out-button","zoom-label","zoom-in-button","fit-button"]) assert.match(index, new RegExp(`id="${id}"`));
  assert.match(app, /addEventListener\("wheel", handleGraphWheel/);
  assert.match(app, /addEventListener\("pointerdown", startPan\)/);
  assert.match(app, /addEventListener\("pointerdown", startDrag\)/);
  assert.match(app, /event\.target\.closest\("\.graph-node,a,button,input,label"\)/);
  assert.match(app, /classifyReferenceNode\(node\)/);
});
