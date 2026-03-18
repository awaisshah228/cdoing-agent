#!/usr/bin/env node

/**
 * postinstall script for @cdoing/opentuicli
 *
 * Finds the platform-specific binary package (@cdoing/opentuicli-{platform}-{arch})
 * and hard-links (or copies) the binary into bin/.cdoing-tui for the wrapper to use.
 */

import fs from "fs"
import path from "path"
import os from "os"
import { fileURLToPath } from "url"
import { createRequire } from "module"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

function detectPlatformAndArch() {
  const platformMap = { darwin: "darwin", linux: "linux", win32: "windows" }
  const archMap = { x64: "x64", arm64: "arm64", arm: "arm" }

  const platform = platformMap[os.platform()] || os.platform()
  const arch = archMap[os.arch()] || os.arch()

  return { platform, arch }
}

function findBinary() {
  const { platform, arch } = detectPlatformAndArch()
  const packageName = `@cdoing/cdoing-tui-${platform}-${arch}`
  const binaryName = platform === "windows" ? "cdoing-tui.exe" : "cdoing-tui"

  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`)
    const packageDir = path.dirname(packageJsonPath)
    const binaryPath = path.join(packageDir, "bin", binaryName)

    if (!fs.existsSync(binaryPath)) {
      throw new Error(`Binary not found at ${binaryPath}`)
    }

    return { binaryPath, binaryName }
  } catch (error) {
    throw new Error(`Could not find package ${packageName}: ${error.message}`)
  }
}

async function main() {
  try {
    if (os.platform() === "win32") {
      console.log("Windows detected: binary setup not needed (using packaged .exe)")
      return
    }

    const { binaryPath } = findBinary()
    const binDir = path.join(__dirname, "bin")
    const target = path.join(binDir, ".cdoing-tui")

    // Ensure bin directory exists
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true })
    }

    // Remove existing binary if it exists
    if (fs.existsSync(target)) {
      fs.unlinkSync(target)
    }

    // Hard-link preferred, copy as fallback
    try {
      fs.linkSync(binaryPath, target)
    } catch {
      fs.copyFileSync(binaryPath, target)
    }
    fs.chmodSync(target, 0o755)

    console.log(`@cdoing/opentuicli: Linked binary from ${binaryPath}`)
  } catch (error) {
    console.error("Failed to setup cdoing-tui binary:", error.message)
    process.exit(1)
  }
}

try {
  main()
} catch (error) {
  console.error("Postinstall script error:", error.message)
  process.exit(0)
}
