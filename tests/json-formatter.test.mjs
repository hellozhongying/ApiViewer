import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadFormatter() {
  const source = await readFile(new URL("../json-formatter.js", import.meta.url), "utf8");
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return context;
}

test("formats replay JSON with readable indentation", async () => {
  const { formatJsonText } = await loadFormatter();

  assert.equal(
    formatJsonText('{"column":"createTime","filters":{"active":true},"items":[]}'),
    [
      "{",
      '  "column": "createTime",',
      '  "filters": {',
      '    "active": true',
      "  },",
      '  "items": []',
      "}",
    ].join("\n"),
  );
});

test("formatting preserves JSON token text that parse and stringify can change", async () => {
  const { formatJsonText } = await loadFormatter();
  const formatted = formatJsonText('{"id":9007199254740993,"id":-0,"escaped":"a\\tb"}');

  assert.match(formatted, /9007199254740993/);
  assert.match(formatted, /"id": -0/);
  assert.match(formatted, /"escaped": "a\\tb"/);
  assert.equal((formatted.match(/"id"/g) || []).length, 2);
});

test("invalid JSON is left unchanged when preparing the replay editor", async () => {
  const { formatJsonText, tryFormatJsonText } = await loadFormatter();
  const invalid = '{"name":';

  assert.throws(() => formatJsonText(invalid));
  assert.equal(tryFormatJsonText(invalid), invalid);
});

test("the replay editor formats JSON while creating its initial draft", async () => {
  const [html, source] = await Promise.all([
    readFile(new URL("../sidepanel.html", import.meta.url), "utf8"),
    readFile(new URL("../sidepanel.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /<script src="json-formatter\.js"><\/script>\s*<script src="sidepanel\.js"><\/script>/);
  assert.match(source, /const editorBody = bodyMode === "json" && body\.trim\(\) \? tryFormatJsonText\(body\) : body;/);
  assert.match(source, /body: editorBody,/);
});
