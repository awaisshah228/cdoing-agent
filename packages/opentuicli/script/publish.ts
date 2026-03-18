#!/usr/bin/env bun
/// <reference types="bun" />

/**
 * Publish script for @cdoing/opentuicli
 *
 * 1. Reads the per-platform binary packages from dist/
 * 2. Creates the main wrapper package with optionalDependencies
 * 3. Publishes all platform packages, then the main package
 *
 * Usage:
 *   bun run script/publish.ts [--tag <tag>] [--dry-run]
 */

import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dir = path.resolve(__dirname, "..")
process.chdir(dir)

const pkg = await Bun.file("./package.json").json()

// Parse args
const tag = (() => {
  const idx = process.argv.indexOf("--tag")
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : "latest"
})()
const dryRun = process.argv.includes("--dry-run")

// Discover built platform packages from dist/
const binaries: Record<string, string> = {}
for (const entry of fs.readdirSync("./dist", { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const pkgJsonPath = path.join("./dist", entry.name, "package.json")
  if (!fs.existsSync(pkgJsonPath)) continue
  const platformPkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"))
  if (platformPkg.name && platformPkg.version) {
    binaries[platformPkg.name] = platformPkg.version
  }
}

if (Object.keys(binaries).length === 0) {
  console.error("No platform packages found in dist/. Run `bun run build.ts` first.")
  process.exit(1)
}

const version = Object.values(binaries)[0]
console.log(`Publishing version ${version} with tag "${tag}"`)
console.log("Platform packages:", binaries)

// Create the main wrapper package in dist/
const mainPkgDir = `./dist/${pkg.name}`
fs.mkdirSync(mainPkgDir, { recursive: true })

// Copy bin wrapper and postinstall
fs.cpSync("./bin", path.join(mainPkgDir, "bin"), { recursive: true })
fs.copyFileSync("./postinstall.mjs", path.join(mainPkgDir, "postinstall.mjs"))

// Copy LICENSE if it exists
for (const licensePath of ["./LICENSE", "../../LICENSE"]) {
  if (fs.existsSync(licensePath)) {
    fs.copyFileSync(licensePath, path.join(mainPkgDir, "LICENSE"))
    break
  }
}

// Generate the main package.json
const mainPkgJson = {
  name: pkg.name,
  version,
  description: pkg.description,
  bin: {
    "cdoing-tui": "./bin/cdoing-tui.cjs",
  },
  scripts: {
    postinstall: "node ./postinstall.mjs",
  },
  license: pkg.license,
  optionalDependencies: binaries,
}

fs.writeFileSync(
  path.join(mainPkgDir, "package.json"),
  JSON.stringify(mainPkgJson, null, 2),
)

console.log("\nMain package.json:")
console.log(JSON.stringify(mainPkgJson, null, 2))

// Publish each platform binary package
const publishTasks = Object.keys(binaries).map(async (name) => {
  // name is like "@cdoing/cdoing-tui-darwin-arm64", dir name is "cdoing-tui-darwin-arm64"
  const dirName = name.replace("@cdoing/", "")
  const pkgDir = `./dist/${dirName}`

  if (process.platform !== "win32") {
    await $`chmod -R 755 .`.cwd(pkgDir)
  }

  // Clean any leftover .tgz from previous runs
  for (const f of fs.readdirSync(pkgDir)) {
    if (f.endsWith(".tgz")) fs.unlinkSync(path.join(pkgDir, f))
  }

  console.log(`\nPublishing ${name}...`)
  if (dryRun) {
    await $`npm pack`.cwd(pkgDir)
    console.log(`  [dry-run] Would publish ${name}@${version}`)
  } else {
    await $`npm pack`.cwd(pkgDir)
    await $`npm publish *.tgz --access public --tag ${tag}`.cwd(pkgDir)
  }
})

await Promise.all(publishTasks)

// Clean any leftover .tgz from previous runs
for (const f of fs.readdirSync(mainPkgDir)) {
  if (f.endsWith(".tgz")) fs.unlinkSync(path.join(mainPkgDir, f))
}

// Publish the main wrapper package
console.log(`\nPublishing ${pkg.name}@${version}...`)
if (dryRun) {
  await $`npm pack`.cwd(mainPkgDir)
  console.log(`  [dry-run] Would publish ${pkg.name}@${version}`)
} else {
  await $`npm pack`.cwd(mainPkgDir)
  await $`npm publish *.tgz --access public --tag ${tag}`.cwd(mainPkgDir)
}

console.log("\nPublish complete!")
