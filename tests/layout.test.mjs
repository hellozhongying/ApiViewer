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

test("readable text keeps GitHub-like minimum sizes while allowing user scaling", async () => {
  const css = await readFile(new URL("../sidepanel.css", import.meta.url), "utf8");

  assert.match(css, /--text-body:\s*max\(1rem,\s*16px\)/);
  assert.match(css, /--text-ui:\s*max\(\.875rem,\s*14px\)/);
  assert.match(css, /--text-code:\s*max\(\.8125rem,\s*13px\)/);
  assert.match(css, /--text-small:\s*max\(\.75rem,\s*12px\)/);
  assert.match(css, /#detailContent\s*\{[^}]*font:\s*var\(--text-code\)\/1\.5\s+var\(--mono\)/s);
  assert.match(css, /\.consent-heading p\s*\{[^}]*font-size:\s*var\(--text-body\)[^}]*line-height:\s*1\.5/s);
});
