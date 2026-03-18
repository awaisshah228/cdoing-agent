#!/usr/bin/env node

/**
 * Publishes platform-specific packages for all built targets.
 *
 * Usage:
 *   node scripts/publish-platform.mjs [--dry-run]
 *
 * Run after `bun run build:all` (which cross-compiles all platforms).
 * Creates temp packages like @cdoing/opentuicli-darwin-arm64 and publishes each.
 */

import fs from "fs"
import path from "path"
import { execSync } from "child_process"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, "..")
const dryRun = process.argv.includes("--dry-run")

const mainPkg = JSON.parse(
  fs.readFileSync(path.join(rootDir, "package.json"), "utf8")
)
const version = mainPkg.version

const platforms = [
  { os: "darwin", arch: "arm64", npmOs: "darwin" },
  { os: "darwin", arch: "x64", npmOs: "darwin" },
  { os: "linux", arch: "arm64", npmOs: "linux" },
  { os: "linux", arch: "x64", npmOs: "linux" },
  { os: "windows", arch: "x64", npmOs: "win32" },
]

for (const { os, arch, npmOs } of platforms) {
  const dirName = `cdoing-tui-${os}-${arch}`
  const binaryDir = path.join(rootDir, "dist", dirName, "bin")
  const ext = os === "windows" ? ".exe" : ""
  const binaryFile = path.join(binaryDir, `cdoing-tui${ext}`)

  if (!fs.existsSync(binaryFile)) {
    console.log(`Skipping ${os}-${arch}: binary not found`)
    continue
  }

  const pkgName = `@cdoing/opentuicli-${os}-${arch}`

  // Create temp package directory
  const tmpDir = path.join(rootDir, "dist", `_pkg-${os}-${arch}`)
  const tmpBinDir = path.join(tmpDir, "bin")
  fs.mkdirSync(tmpBinDir, { recursive: true })

  // Copy binary
  fs.copyFileSync(binaryFile, path.join(tmpBinDir, `cdoing-tui${ext}`))

  // Write package.json
  const platformPkg = {
    name: pkgName,
    version,
    description: `Platform binary for @cdoing/opentuicli (${os}-${arch})`,
    os: [npmOs],
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

  console.log(`\nPublishing ${pkgName}@${version}...`)

  const cmd = dryRun
    ? `npm publish --access public --dry-run`
    : `npm publish --access public`

  try {
    execSync(cmd, { cwd: tmpDir, stdio: "inherit" })
    console.log(`Done: ${pkgName}@${version}`)
  } catch (err) {
    console.error(`Failed to publish ${pkgName}@${version}`)
    process.exit(1)
  } finally {
    fs.rmSync(tmpDir, { recursive: true })
  }
}
