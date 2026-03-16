/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  distDir: "out",
  // Dashboard is served at /dashboard/ on the gateway
  basePath: "/dashboard",
  trailingSlash: true,
};

module.exports = nextConfig;
