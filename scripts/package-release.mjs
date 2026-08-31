import { readFile, rm, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(projectRoot, "manifest.json"), "utf8"));
const releaseDir = path.join(projectRoot, "release");
const archiveName = `ApiViewer-${manifest.version}.zip`;
const archivePath = path.join(releaseDir, archiveName);
const runtimeFiles = [
  "manifest.json",
  "background.js",
  "sidepanel.html",
  "sidepanel.css",
  "sidepanel.js",
  "json-formatter.js",
  "privacy.html",
  "privacy-en.html",
  "privacy.css",
  "_locales",
  "icons",
];

for (const file of [
  "privacy.html",
  "privacy-en.html",
  "store-assets/README.md",
  "store-assets/store-listing-en.md",
  "store-assets/store-listing-zh-CN.md",
  "store-assets/privacy-practices.md",
  "store-assets/publishing-checklist.md",
  "store-assets/privacy-policy.md",
]) {
  const content = await readFile(path.join(projectRoot, file), "utf8");
  const placeholders = [...content.matchAll(/\{\{[A-Z_]+\}\}/g)].map((match) => match[0]);
  if (placeholders.length) {
    console.error(`无法生成发布包：${file} 仍包含 ${[...new Set(placeholders)].join(", ")}`);
    console.error("请先填写发布者名称、支持邮箱和公开 URL。");
    process.exit(1);
  }
}

await mkdir(releaseDir, { recursive: true });
await rm(archivePath, { force: true });
const result = spawnSync("zip", ["-q", "-r", archivePath, ...runtimeFiles], {
  cwd: projectRoot,
  encoding: "utf8",
});

if (result.status !== 0) {
  console.error(result.stderr || "zip 命令执行失败。");
  process.exit(result.status || 1);
}

console.log(archivePath);
