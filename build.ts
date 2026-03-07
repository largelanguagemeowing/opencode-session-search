import { build } from "bun";
import path from "path";

const result = await build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "node",
  format: "esm",
  splitting: false,
  sourcemap: "external",
  minify: false,
});

if (!result.success) {
  console.error("Build failed");
  process.exit(1);
}

console.log("Build successful!");
