#!/usr/bin/env node

/**
 * postinstall script for @cdoing/opentuicli
 *
 * Detects the current platform/arch and symlinks the matching
 * binary from dist/ to dist/cdoing-tui-current/bin/cdoing-tui.
 */

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const platform = process.platform // darwin, linux, win32
const arch = process.arch // arm64, x64

const osName = platform === "win32" ? "windows" : platform
const dirName = `cdoing-tui-${osName}-${arch}`
const ext = platform === "win32" ? ".exe" : ""
const binaryPath = path.join(__dirname, "dist", dirName, "bin", `cdoing-tui${ext}`)

if (!fs.existsSync(binaryPath)) {
  console.error(
    `@cdoing/opentuicli: No pre-built binary for ${platform}-${arch}.\n` +
      `Expected: dist/${dirName}/bin/cdoing-tui${ext}\n` +
      `You may need to build from source: bun run build --single`
  )
  process.exit(0) // Don't fail install
}

// Create dist/cdoing-tui-current/bin/ symlink
const currentDir = path.join(__dirname, "dist", "cdoing-tui-current")
if (fs.existsSync(currentDir)) {
  fs.rmSync(currentDir, { recursive: true })
}
fs.symlinkSync(path.join(__dirname, "dist", dirName), currentDir)

// Ensure executable
if (platform !== "win32") {
  fs.chmodSync(binaryPath, 0o755)
}

console.log(`@cdoing/opentuicli: Linked ${dirName} binary`)
