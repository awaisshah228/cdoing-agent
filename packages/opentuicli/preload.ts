import { plugin } from "bun"

const reactPath = require.resolve("react")
const reactJsxPath = require.resolve("react/jsx-runtime")
const reactJsxDevPath = require.resolve("react/jsx-dev-runtime")
const reactReconcilerPath = require.resolve("react-reconciler")
const reactReconcilerConstantsPath = require.resolve("react-reconciler/constants")

plugin({
  name: "dedupe-react",
  setup(build) {
    build.onResolve({ filter: /^react$/ }, () => ({ path: reactPath }))
    build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: reactJsxPath }))
    build.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({ path: reactJsxDevPath }))
    build.onResolve({ filter: /^react-reconciler$/ }, () => ({ path: reactReconcilerPath }))
    build.onResolve({ filter: /^react-reconciler\/constants$/ }, () => ({ path: reactReconcilerConstantsPath }))
  },
})
