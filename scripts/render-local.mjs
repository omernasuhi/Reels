// Yerel render: node scripts/render-local.mjs <props.json> <out.mp4>
// Önizlemedeki kompozisyonun (src/remotion) aynısını @remotion/renderer ile MP4'e çevirir.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const [propsFile, outFile] = process.argv.slice(2);
if (!propsFile || !outFile) {
  console.error("usage: render-local.mjs <props.json> <out.mp4>");
  process.exit(1);
}
const inputProps = JSON.parse(fs.readFileSync(propsFile, "utf8"));
const root = process.cwd();
const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || undefined;
const chromeMode = process.env.REMOTION_CHROME_MODE || undefined; // "headless-shell" (varsayılan) ya da "chrome-for-testing"

// Paket bir kez üretilir ve kaynak değişmedikçe yeniden kullanılır.
const srcDir = path.join(root, "src/remotion");
const stamp = fs.readdirSync(srcDir).map((f) => fs.statSync(path.join(srcDir, f)).mtimeMs).join("-");
const cacheDir = path.join(os.tmpdir(), "reels-remotion-bundle");
const stampFile = path.join(cacheDir, ".stamp");
let serveUrl = cacheDir;
if (!fs.existsSync(stampFile) || fs.readFileSync(stampFile, "utf8") !== stamp) {
  fs.rmSync(cacheDir, { recursive: true, force: true });
  serveUrl = await bundle({
    entryPoint: path.join(srcDir, "index.ts"),
    publicDir: path.join(root, "public"),
    outDir: cacheDir,
  });
  fs.writeFileSync(stampFile, stamp);
}

const composition = await selectComposition({ serveUrl, id: "Story", inputProps, browserExecutable, chromeMode });
await renderMedia({
  composition,
  serveUrl,
  codec: "h264",
  outputLocation: outFile,
  inputProps,
  browserExecutable,
  chromeMode,
  timeoutInMilliseconds: 120000,
  onProgress: ({ progress }) => {
    if (process.stdout.isTTY) process.stdout.write(`\rrender ${(progress * 100).toFixed(0)}%`);
  },
});
console.log(`\nrendered ${outFile}`);
