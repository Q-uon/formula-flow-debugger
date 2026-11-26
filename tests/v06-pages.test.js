import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [index, app, adapter, core, manifest, workflow] = await Promise.all([
  read("index.html"), read("src/app.js"), read("src/excel-adapter.js"), read("src/core.js"),
  read("manifest.github-pages.xml"), read(".github/workflows/deploy-pages.yml")
]);

test("v0.6 task pane always displays product version and build information", () => {
  assert.match(index, /Formula Flow Debugger v0\.6/);
  assert.match(index, /id="build-info">Build: dev-local/);
});

test("v0.6 manifest template has Pages placeholders and Excel-visible v0.6 names", () => {
  assert.match(manifest, /__PAGES_BASE_URL__/);
  assert.match(manifest, /__PAGES_ORIGIN__/);
  assert.match(manifest, /DisplayName DefaultValue="Formula Flow Debugger v0\.6"/);
  assert.match(manifest, /計算フロー v0\.6/);
});

test("v0.6 GitHub Actions workflow tests, builds, and deploys dist", () => {
  assert.match(workflow, /node --test/);
  assert.match(workflow, /tools\/build_pages\.py/);
  assert.match(workflow, /actions\/upload-pages-artifact@v3/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /path: dist/);
});

test("client application has no workbook-data egress API", () => {
  const productSource = [app, adapter, core].join("\n");
  for (const forbidden of ["fetch(", "XMLHttpRequest", "WebSocket", "sendBeacon"]) {
    assert.equal(productSource.includes(forbidden), false, forbidden);
  }
});

test("browser source has no insecure asset URL", () => {
  for (const [name, content] of [["index", index], ["app", app], ["adapter", adapter], ["core", core]]) {
    assert.equal(content.includes("http://"), false, name);
  }
  assert.match(index, /https:\/\/appsforoffice\.microsoft\.com\/lib\/1\/hosted\/office\.js/);
});
