#!/usr/bin/env node

/**
 * postinstall script for @cdoing/opentuicli
 *
 * Detects the current platform/arch and symlinks the matching
 * platform-specific package binary to bin/cdoing-tui.
 */

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { createRequire } from "module"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const platform = process.platform // darwin, linux, win32
const arch = process.arch // arm64, x64

const osName = platform === "win32" ? "windows" : platform
const pkgName = `@cdoing/opentuicli-${osName}-${arch}`

let binaryPath
try {
  const pkgDir = path.dirname(require.resolve(`${pkgName}/package.json`))
  const ext = platform === "win32" ? ".exe" : ""
  binaryPath = path.join(pkgDir, "bin", `cdoing-tui${ext}`)
} catch {
  console.error(
    `@cdoing/opentuicli: No pre-built binary package for ${platform}-${arch}.\n` +
      `Expected package: ${pkgName}\n` +
      `You may need to build from source: cd packages/opentuicli && bun run build --single`
  )
  process.exit(0) // Don't fail install
}

if (!fs.existsSync(binaryPath)) {
  console.error(`@cdoing/opentuicli: Binary not found at ${binaryPath}`)
  process.exit(0)
}

// Create dist/cdoing-tui-current/bin/ and symlink the binary
const currentBinDir = path.join(__dirname, "dist", "cdoing-tui-current", "bin")
fs.mkdirSync(currentBinDir, { recursive: true })

const targetPath = path.join(currentBinDir, "cdoing-tui")
if (fs.existsSync(targetPath)) {
  fs.unlinkSync(targetPath)
}
fs.symlinkSync(binaryPath, targetPath)

// Ensure executable
if (platform !== "win32") {
  fs.chmodSync(binaryPath, 0o755)
}

console.log(`@cdoing/opentuicli: Linked ${pkgName} binary`)
