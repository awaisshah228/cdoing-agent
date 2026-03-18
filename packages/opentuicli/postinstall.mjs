#!/usr/bin/env node

/**
 * postinstall script for @cdoing/opentuicli
 *
 * Detects the current platform/arch and symlinks the matching
 * binary directory to dist/cdoing-tui-current.
 */

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const platform = process.platform
const arch = process.arch
const osName = platform === "win32" ? "windows" : platform
const dirName = `cdoing-tui-${osName}-${arch}`
const ext = platform === "win32" ? ".exe" : ""
const targetDir = path.join(__dirname, "dist", dirName)
const binaryPath = path.join(targetDir, "bin", `cdoing-tui${ext}`)

if (!fs.existsSync(binaryPath)) {
  console.error(
    `@cdoing/opentuicli: No pre-built binary for ${platform}-${arch}.\n` +
      `Expected: dist/${dirName}/bin/cdoing-tui${ext}\n` +
      `You may need to build from source: bun run build --single`
  )
  process.exit(0)
}

// Symlink dist/cdoing-tui-current -> dist/cdoing-tui-{os}-{arch}
const currentLink = path.join(__dirname, "dist", "cdoing-tui-current")
try { fs.rmSync(currentLink, { recursive: true, force: true }) } catch {}
fs.symlinkSync(targetDir, currentLink)

// Ensure executable
if (platform !== "win32") {
  fs.chmodSync(fs.realpathSync(binaryPath), 0o755)
}

console.log(`@cdoing/opentuicli: Linked ${dirName} binary`)
