#!/usr/bin/env node

/**
 * postinstall script for @cdoing/opentuicli
 *
 * Detects the current platform/arch and symlinks the matching
 * platform package binary to dist/cdoing-tui-current/bin/cdoing-tui.
 *
 * Platform binaries are installed via optionalDependencies:
 *   @cdoing/opentuicli-darwin-arm64, @cdoing/opentuicli-linux-x64, etc.
 */

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { createRequire } from "module"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const platform = process.platform
const arch = process.arch
const osName = platform === "win32" ? "windows" : platform
const pkgName = `@cdoing/opentuicli-${osName}-${arch}`

let binaryPath
try {
  const pkgDir = path.dirname(require.resolve(`${pkgName}/package.json`))
  const ext = platform === "win32" ? ".exe" : ""
  binaryPath = path.join(pkgDir, "bin", `cdoing-tui${ext}`)
} catch {
  // Fallback: check if binary exists in dist/ (local dev or bundled publish)
  const dirName = `cdoing-tui-${osName}-${arch}`
  const ext = platform === "win32" ? ".exe" : ""
  const localPath = path.join(__dirname, "dist", dirName, "bin", `cdoing-tui${ext}`)

  if (fs.existsSync(localPath)) {
    binaryPath = localPath
  } else {
    console.error(
      `@cdoing/opentuicli: No pre-built binary for ${platform}-${arch}.\n` +
        `Expected package: ${pkgName}\n` +
        `You may need to build from source: bun run build --single`
    )
    process.exit(0)
  }
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

if (platform !== "win32") {
  fs.chmodSync(binaryPath, 0o755)
}

console.log(`@cdoing/opentuicli: Linked ${path.basename(path.dirname(path.dirname(binaryPath)))} binary`)
