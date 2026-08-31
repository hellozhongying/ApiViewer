import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, root), "utf8");
}

test("manifest uses Chrome localization with English default and Simplified Chinese support", async () => {
  const manifest = JSON.parse(await read("manifest.json"));
  const english = JSON.parse(await read("_locales/en/messages.json"));
  const chinese = JSON.parse(await read("_locales/zh_CN/messages.json"));

  assert.equal(manifest.default_locale, "en");
  assert.equal(manifest.name, "__MSG_app_name__");
  assert.equal(manifest.description, "__MSG_app_description__");
  assert.equal(manifest.action.default_title, "__MSG_action_title__");
  for (const key of ["app_name", "app_description", "action_title"]) {
    assert.ok(english[key]?.message, `English locale is missing ${key}`);
    assert.ok(chinese[key]?.message, `Chinese locale is missing ${key}`);
  }
});

test("every runtime localization key has an English message", async () => {
  const [html, sidePanelScript, backgroundScript, englishText] = await Promise.all([
    read("sidepanel.html"),
    read("sidepanel.js"),
    read("background.js"),
    read("_locales/en/messages.json"),
  ]);
  const english = JSON.parse(englishText);
  const keys = new Set([
    ...[...html.matchAll(/data-i18n(?:-[a-z-]+)?="([a-z0-9_]+)"/g)].map((match) => match[1]),
    ...[...`${sidePanelScript}\n${backgroundScript}`.matchAll(/\bt\("([a-z0-9_]+)"/g)].map((match) => match[1]),
  ]);

  assert.ok(keys.size > 100, "Expected the complete side-panel UI to be localized");
  for (const key of keys) assert.ok(english[key]?.message, `English locale is missing ${key}`);
  assert.match(html, /data-localized-privacy-link/);
});

test("release package includes locales and both privacy policies", async () => {
  const packagingScript = await read("scripts/package-release.mjs");
  assert.match(packagingScript, /"_locales"/);
  assert.match(packagingScript, /"privacy\.html"/);
  assert.match(packagingScript, /"privacy-en\.html"/);

  const englishPolicy = await read("privacy-en.html");
  const publicEnglishPolicy = await read("docs/privacy-en.html");
  assert.match(englishPolicy, /<html lang="en">/);
  assert.match(englishPolicy, /<h1>Privacy Policy<\/h1>/);
  assert.match(publicEnglishPolicy, /<html lang="en">/);
});
