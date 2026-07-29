import {
  cp,
  copyFile,
  mkdir,
  rm,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const buildRoot = fileURLToPath(new URL("../dist/", import.meta.url));
const publishedAssets = fileURLToPath(new URL("../assets/", import.meta.url));

await rm(publishedAssets, { recursive: true, force: true });
await mkdir(publishedAssets);
await cp(`${buildRoot}assets`, publishedAssets, { recursive: true });
await copyFile(`${buildRoot}index.html`, `${projectRoot}index.html`);

console.log("Published static package to index.html and assets/");
