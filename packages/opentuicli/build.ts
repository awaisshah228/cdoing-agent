#!/usr/bin/env bun
/// <reference types="bun" />

/**
 * Build script for cdoing-tui
 * Uses Bun.build with compile to produce a standalone binary
 * that embeds the Bun runtime (no Bun install needed to run).
 */

import path from "path"
import fs from "fs"
import type { BunPlugin } from "bun"
import pkg from "./package.json"

const dir = import.meta.dir
const singleFlag = process.argv.includes("--single")

// Deduplicate React — ensure all imports of "react" resolve to the exact same file
// so @opentui/react's reconciler and our code share one React instance.
const reactPath = require.resolve("react")
const reactJsxPath = require.resolve("react/jsx-runtime")
const reactJsxDevPath = require.resolve("react/jsx-dev-runtime")
const reactReconcilerPath = require.resolve("react-reconciler")
const reactReconcilerConstantsPath = require.resolve("react-reconciler/constants")

// Stub out @opentui/core-{platform}-{arch} native imports for cross-platform targets.
// At runtime, @opentui/core dynamically imports the correct native package for the
// host platform, so we only need the host's native package at build time.
const hostPlatform = process.platform
const hostArch = process.arch
const nativeStubPlugin: BunPlugin = {
  name: "native-platform-stub",
  setup(build) {
    // Match @opentui/core-<platform>-<arch>/index.ts
    build.onResolve({ filter: /^@opentui\/core-[a-z0-9]+-[a-z0-9]+/ }, (args) => {
      // Check if this is for a non-host platform — if so, stub it
      const hostPkg = `@opentui/core-${hostPlatform}-${hostArch}`
      if (!args.path.startsWith(hostPkg)) {
        return {
          path: args.path,
          namespace: "native-stub",
        }
      }
      return undefined // let Bun resolve the host platform normally
    })
    build.onLoad({ filter: /.*/, namespace: "native-stub" }, () => {
      return {
        contents: `export default "";`,
        loader: "js",
      }
    })
  },
}

// Resolve @cdoing/* workspace packages to their real paths so cross-compilation works
// (Bun's cross-compile doesn't follow workspace symlinks reliably)
const workspacePlugin: BunPlugin = {
  name: "resolve-workspace",
  setup(build) {
    build.onResolve({ filter: /^@cdoing\/(ai|core)/ }, (args) => {
      const pkg = args.path.startsWith("@cdoing/ai") ? "ai" : "core"
      const subpath = args.path.replace(`@cdoing/${pkg}`, "").replace(/^\//, "")
      const resolved = subpath
        ? path.join(dir, "..", pkg, subpath)
        : path.join(dir, "..", pkg, "dist", "index.js")
      return { path: resolved }
    })
  },
}

const dedupeReactPlugin: BunPlugin = {
  name: "dedupe-react",
  setup(build) {
    // Force all "react" imports to the same physical file
    build.onResolve({ filter: /^react$/ }, () => ({ path: reactPath }))
    build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: reactJsxPath }))
    build.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({ path: reactJsxDevPath }))
    build.onResolve({ filter: /^react-reconciler$/ }, () => ({ path: reactReconcilerPath }))
    build.onResolve({ filter: /^react-reconciler\/constants$/ }, () => ({ path: reactReconcilerConstantsPath }))
  },
}

const allTargets: {
  os: string
  arch: "arm64" | "x64"
}[] = [
  { os: "linux", arch: "arm64" },
  { os: "linux", arch: "x64" },
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "win32", arch: "x64" },
]

const targets = singleFlag
  ? allTargets.filter(
      (item) => item.os === process.platform && item.arch === process.arch,
    )
  : allTargets

// Clean dist
fs.rmSync(path.join(dir, "dist"), { recursive: true, force: true })

for (const item of targets) {
  const name = [
    "cdoing-tui",
    item.os === "win32" ? "windows" : item.os,
    item.arch,
  ].join("-")

  console.log(`Building ${name}...`)

  const outdir = path.join(dir, "dist", name, "bin")
  fs.mkdirSync(outdir, { recursive: true })

  const result = await Bun.build({
    entrypoints: [path.join(dir, "src/index.ts")],
    plugins: [nativeStubPlugin, workspacePlugin, dedupeReactPlugin],
    tsconfig: path.join(dir, "tsconfig.json"),
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      target: `bun-${item.os}-${item.arch}` as any,
      outfile: path.join(outdir, item.os === "win32" ? "cdoing-tui.exe" : "cdoing-tui"),
    },
    define: {
      CDOING_TUI_VERSION: `'${pkg.version}'`,
    },
  })

  if (!result.success) {
    console.error(`Build failed for ${name}:`)
    for (const log of result.logs) {
      console.error(`  ${log}`)
    }
    process.exit(1)
  }

  console.log(`  -> dist/${name}/bin/cdoing-tui`)

  // For --single builds, also create a "current" symlink for easy access
  if (singleFlag) {
    const currentDir = path.join(dir, "dist", "cdoing-tui-current")
    if (fs.existsSync(currentDir)) fs.rmSync(currentDir, { recursive: true })
    fs.symlinkSync(path.join(dir, "dist", name), currentDir)
  }
}

console.log("Build complete.")
