import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appPath = path.join(root, "app.js");
const source = fs.readFileSync(appPath, "utf8");
const names = [...source.matchAll(/^(?:async )?function (\w+)/gm)]
  .map((m) => m[1])
  .filter((n) => n !== "init");

const block = `if (typeof globalThis.__JANA_REGISTER_TEST_EXPORTS__ === "function") {
  globalThis.__JANA_REGISTER_TEST_EXPORTS__({
    ${names.join(",\n    ")},
    injectSupabaseClientForTests,
    resetSupabaseClientForTests,
    state,
    refs,
    PENDING_ORDER_ID,
    THEME_PRESETS
  });
}
`;

fs.writeFileSync(path.join(root, "tests", ".export-block.js"), block);
console.log(`Generated export block with ${names.length} functions.`);
