import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");

test("UI contract: address is a dedicated link and node body handles pointer dragging", () => {
  assert.match(app, /class=\"node-address address-link\"/);
  assert.match(app, /addEventListener\(\"pointerdown\", startDrag\)/);
  assert.match(app, /event\.target\.closest\(\"a,button\"\)/);
});

test("UI contract: automatic layout, reset, and fit controls exist", () => {
  for (const id of ["auto-layout-button","reset-layout-button","fit-button"]) assert.match(index, new RegExp(`id="${id}"`));
});

test("UI contract: all seven highlights and dim-others setting exist", () => {
  for (const value of ["ROUND","ROUNDDOWN","ROUNDUP","fraction","lookup","external","error"]) assert.match(index, new RegExp(`value="${value}"`));
  assert.match(index, /id="dim-others"/);
});
