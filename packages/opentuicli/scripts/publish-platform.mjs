#!/usr/bin/env node

/**
 * Generates and publishes a platform-specific package for the current OS/arch.
 *
 * Usage:
 *   node scripts/publish-platform.mjs [--dry-run]
 *
 * Run after `bun run build` (which builds for current platform only).
 * This creates a temp package like @cdoing/opentuicli-darwin-arm64
 * containing just the binary, then publishes it.
 */

import fs from "fs"
import path from "path"
import { execSync } from "child_process"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, "..")
const dryRun = process.argv.includes("--dry-run")

const platform = process.platform
const arch = process.arch
const osName = platform === "win32" ? "windows" : platform

const mainPkg = JSON.parse(
  fs.readFileSync(path.join(rootDir, "package.json"), "utf8")
)
const version = mainPkg.version

const pkgName = `@cdoing/opentuicli-${osName}-${arch}`
const dirName = `cdoing-tui-${osName}-${arch}`
const binaryDir = path.join(rootDir, "dist", dirName, "bin")

if (!fs.existsSync(path.join(binaryDir, "cdoing-tui"))) {
  console.error(`Binary not found at ${binaryDir}/cdoing-tui`)
  console.error("Run 'bun run build' first.")
  process.exit(1)
}

// Create temp package directory
const tmpDir = path.join(rootDir, "dist", `_pkg-${osName}-${arch}`)
const tmpBinDir = path.join(tmpDir, "bin")
fs.mkdirSync(tmpBinDir, { recursive: true })

// Copy binary
const ext = platform === "win32" ? ".exe" : ""
fs.copyFileSync(
  path.join(binaryDir, "cdoing-tui"),
  path.join(tmpBinDir, `cdoing-tui${ext}`)
)

// Write package.json
const platformPkg = {
  name: pkgName,
  version,
  description: `Platform binary for @cdoing/opentuicli (${osName}-${arch})`,
  os: [platform],
  cpu: [arch],
  bin: { "cdoing-tui": `bin/cdoing-tui${ext}` },
  license: "Apache-2.0",
  repository: {
    type: "git",
    url: "https://github.com/awaisshah228/cdoing-agent.git",
    directory: "packages/opentuicli",
  },
}

fs.writeFileSync(
  path.join(tmpDir, "package.json"),
  JSON.stringify(platformPkg, null, 2) + "\n"
)

// Write minimal README
fs.writeFileSync(
  path.join(tmpDir, "README.md"),
  `# ${pkgName}\n\nPlatform-specific binary for [@cdoing/opentuicli](https://www.npmjs.com/package/@cdoing/opentuicli).\n\nThis package is installed automatically — use \`npm install -g @cdoing/opentuicli\` instead.\n`
)

console.log(`\nPackage: ${pkgName}@${version}`)
console.log(`Binary:  ${tmpBinDir}/cdoing-tui${ext}`)
console.log(`Dir:     ${tmpDir}\n`)

// Publish
const cmd = dryRun
  ? `npm publish --access public --dry-run`
  : `npm publish --access public`

console.log(`Running: ${cmd}`)
execSync(cmd, { cwd: tmpDir, stdio: "inherit" })

// Cleanup
fs.rmSync(tmpDir, { recursive: true })
console.log(`\nDone! Published ${pkgName}@${version}`)
