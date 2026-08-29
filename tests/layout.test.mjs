import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("replay regions keep their grid rows when the optional error summary is hidden", async () => {
  const css = await readFile(new URL("../sidepanel.css", import.meta.url), "utf8");
  const expectedRows = [
    [".replay-header", 1],
    [".replay-request-line", 2],
    [".replay-tabs", 3],
    [".replay-error-summary", 4],
    [".replay-editor-panel", 5],
    [".replay-action-bar", 6],
  ];

  for (const [selector, row] of expectedRows) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(css, new RegExp(`${escapedSelector}\\s*\\{[^}]*grid-row:\\s*${row}\\s*;`, "s"));
  }
});
