import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("new requests are appended and reveal the bottom without scrolling on lifecycle updates", async () => {
  const source = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");

  assert.match(source, /renderRequestList\(\{ newRequestId: isNew \? message\.request\.id : null \}\)/);
  assert.match(source, /if \(!existing\) state\.order\.push\(request\.id\)/);
  assert.match(source, /visible\.at\(-1\)\?\.id === newRequestId/);
  assert.match(source, /elements\.requestRows\.scrollHeight\s*:\s*previousScrollTop/);
});

test("snapshots select and reveal the latest request at the bottom", async () => {
  const source = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");

  assert.match(source, /renderRequestList\(\{ followLatest: true \}\)/);
  assert.match(source, /selectRequest\(state\.order\.at\(-1\)\)/);
});

test("the background keeps requests oldest-to-newest and trims the oldest first", async () => {
  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");

  assert.match(source, /session\.order\.push\(request\.id\)/);
  assert.match(source, /const oldestId = session\.order\.shift\(\)/);
});

test("restoring keyboard focus after a render does not undo the chosen scroll position", async () => {
  const source = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");

  assert.match(source, /focusRequestRow\(focusedRequestId, false\)/);
  assert.match(source, /function focusRequestRow\(requestId, scrollIntoView = true\)/);
  assert.match(source, /if \(scrollIntoView\) row\?\.scrollIntoView/);
});
