import { plugin } from "bun"
import path from "path"

// Force ALL react/react-reconciler imports to resolve to the local (React 19) copies
// This prevents the root workspace React 18 (used by @cdoing/cli's Ink) from being picked up
const pkgDir = path.resolve(import.meta.dir)
const reactPath = require.resolve("react", { paths: [pkgDir] })
const reactJsxPath = require.resolve("react/jsx-runtime", { paths: [pkgDir] })
const reactJsxDevPath = require.resolve("react/jsx-dev-runtime", { paths: [pkgDir] })
const reactReconcilerPath = require.resolve("react-reconciler", { paths: [pkgDir] })
const reactReconcilerConstantsPath = require.resolve("react-reconciler/constants", { paths: [pkgDir] })

plugin({
  name: "dedupe-react",
  setup(build) {
    // Intercept all react imports and force them to the local React 19 copy
    build.onResolve({ filter: /^react$/ }, () => ({ path: reactPath }))
    build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: reactJsxPath }))
    build.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({ path: reactJsxDevPath }))
    build.onResolve({ filter: /^react-reconciler$/ }, () => ({ path: reactReconcilerPath }))
    build.onResolve({ filter: /^react-reconciler\/constants$/ }, () => ({ path: reactReconcilerConstantsPath }))
  },
})
