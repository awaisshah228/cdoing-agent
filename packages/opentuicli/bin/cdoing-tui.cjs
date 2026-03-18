#!/usr/bin/env node

const childProcess = require("child_process")
const fs = require("fs")
const path = require("path")
const os = require("os")

function run(target) {
  const result = childProcess.spawnSync(target, process.argv.slice(2), {
    stdio: "inherit",
  })
  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }
  const code = typeof result.status === "number" ? result.status : 0
  process.exit(code)
}

const envPath = process.env.CDOING_TUI_BIN_PATH
if (envPath) {
  run(envPath)
}

const scriptPath = fs.realpathSync(__filename)
const scriptDir = path.dirname(scriptPath)

// Check for hard-linked binary from postinstall
const localBinary = path.join(scriptDir, ".cdoing-tui")
if (fs.existsSync(localBinary)) {
  run(localBinary)
}

const platformMap = {
  darwin: "darwin",
  linux: "linux",
  win32: "windows",
}
const archMap = {
  x64: "x64",
  arm64: "arm64",
}

let platform = platformMap[os.platform()]
if (!platform) {
  platform = os.platform()
}
let arch = archMap[os.arch()]
if (!arch) {
  arch = os.arch()
}

const base = "@cdoing/opentuicli-" + platform + "-" + arch
const binary = platform === "windows" ? "cdoing-tui.exe" : "cdoing-tui"

const names = [base]

function findBinary(startDir) {
  let current = startDir
  for (;;) {
    const modules = path.join(current, "node_modules")
    if (fs.existsSync(modules)) {
      for (const name of names) {
        const candidate = path.join(modules, name, "bin", binary)
        if (fs.existsSync(candidate)) return candidate
      }
    }
    const parent = path.dirname(current)
    if (parent === current) {
      return
    }
    current = parent
  }
}

const resolved = findBinary(scriptDir)
if (!resolved) {
  console.error(
    "No pre-built binary found for your platform (" + os.platform() + "-" + os.arch() + ").\n" +
      "Try manually installing " +
      names.map((n) => '"' + n + '"').join(" or ") +
      " package",
  )
  process.exit(1)
}

run(resolved)
