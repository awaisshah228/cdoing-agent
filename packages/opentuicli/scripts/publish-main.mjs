#!/usr/bin/env node

/**
 * Publishes the main @cdoing/opentuicli package with optionalDependencies injected.
 *
 * Usage:
 *   node scripts/publish-main.mjs [--dry-run]
 *
 * This injects platform package references into package.json before publishing,
 * then reverts the change so the source stays clean for yarn workspaces.
 */

import fs from "fs"
import path from "path"
import { execSync } from "child_process"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, "..")
const pkgPath = path.join(rootDir, "package.json")
const dryRun = process.argv.includes("--dry-run")

// Save original
const original = fs.readFileSync(pkgPath, "utf8")
const pkg = JSON.parse(original)
const version = pkg.version

// Inject optionalDependencies
pkg.optionalDependencies = {
  "@cdoing/opentuicli-darwin-arm64": version,
  "@cdoing/opentuicli-darwin-x64": version,
  "@cdoing/opentuicli-linux-arm64": version,
  "@cdoing/opentuicli-linux-x64": version,
  "@cdoing/opentuicli-windows-x64": version,
}

// Main package should be lightweight — binaries come from platform packages.
// Only ship the bin script (which finds and runs the platform binary).
pkg.files = ["bin/"]

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n")
console.log(`Injected optionalDependencies for v${version}`)
console.log(`Set files to: ${JSON.stringify(pkg.files)}`)

try {
  const cmd = dryRun
    ? "npm publish --access public --dry-run"
    : "npm publish --access public"

  console.log(`Running: ${cmd}\n`)
  execSync(cmd, { cwd: rootDir, stdio: "inherit" })
  console.log(`\nDone! Published @cdoing/opentuicli@${version}`)
} finally {
  // Always revert package.json
  fs.writeFileSync(pkgPath, original)
  console.log("Reverted package.json")
}
