const esbuild = require("esbuild");
const path = require("path");

const isWatch = process.argv.includes("--watch");

const build = {
  entryPoints: [path.resolve(__dirname, "src/index.ts")],
  bundle: true,
  outfile: path.resolve(__dirname, "dist/index.js"),
  format: "esm",
  platform: "node",
  target: "esnext",
  sourcemap: true,
  minify: !isWatch,
  jsx: "automatic",
  jsxImportSource: "@opentui/react",
  // @opentui packages are Bun-only — keep them external, resolved at runtime by Bun
  external: [
    "@cdoing/core",
    "@cdoing/ai",
    "@cdoing/remote-coding-agent",
    "@opentui/core",
    "@opentui/react",
    "react",
    "react/jsx-runtime",
    "commander",
    "chalk",
  ],
};

async function main() {
  if (isWatch) {
    const ctx = await esbuild.context(build);
    await ctx.watch();
    console.log("Watching for changes...");
  } else {
    await esbuild.build(build);
    console.log("Build complete.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
