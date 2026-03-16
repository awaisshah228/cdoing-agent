/**
 * Dashboard static file serving route.
 *
 * Serves the pre-built Next.js static export from packages/dashboard/out/
 * at the /dashboard/ path on the gateway.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import * as path from "path";
import * as fs from "fs";
import express from "express";
import { Logger } from "../../utils/logger";

/**
 * Lightweight cookie parser middleware (avoids adding cookie-parser dependency).
 * Parses the Cookie header into req.cookies object.
 */
function parseCookies(req: Request, _res: Response, next: NextFunction): void {
  const cookieHeader = req.headers.cookie || "";
  (req as any).cookies = {};
  for (const pair of cookieHeader.split(";")) {
    const [key, ...rest] = pair.trim().split("=");
    if (key) (req as any).cookies[key] = rest.join("=");
  }
  next();
}

export interface DashboardRouteOptions {
  /** Absolute path to the dashboard static files directory. */
  staticDir?: string;
  /** Auth token required to access the dashboard. If set, validates ?token= query param. */
  authToken?: string;
  logLevel?: string;
}

/**
 * Resolve the dashboard static files directory.
 * Searches in order:
 *   1. Explicit staticDir option
 *   2. packages/dashboard/out (monorepo dev)
 *   3. ../dashboard/out (relative to remote-coding-agent dist)
 */
function resolveDashboardDir(staticDir?: string): string | null {
  if (staticDir && fs.existsSync(staticDir)) return staticDir;

  // Try monorepo layout: packages/dashboard/out
  const candidates = [
    path.resolve(__dirname, "../../../../dashboard/out"),       // from dist/gateway/routes/
    path.resolve(__dirname, "../../../dashboard/out"),          // from src/gateway/routes/
    path.resolve(process.cwd(), "packages/dashboard/out"),     // from repo root
    path.resolve(process.cwd(), "../dashboard/out"),           // from packages/remote-coding-agent/
  ];

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "index.html")) || fs.existsSync(path.join(dir, "dashboard", "index.html"))) {
      return dir;
    }
  }
  return null;
}

export function dashboardRoutes(opts: DashboardRouteOptions = {}): Router {
  const router = Router();
  const logger = new Logger("Dashboard", opts.logLevel);
  const staticDir = resolveDashboardDir(opts.staticDir);

  if (!staticDir) {
    // Dashboard not built yet — serve a helpful message
    router.get("/dashboard", (_req: Request, res: Response) => {
      res.status(503).send(`
        <html>
          <head><title>Dashboard Not Built</title>
          <style>
            body { font-family: system-ui; background: #0a0a0a; color: #e5e5e5; display: flex;
                   align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
            .card { background: #171717; border: 1px solid #262626; border-radius: 12px; padding: 40px;
                    max-width: 480px; text-align: center; }
            h1 { font-size: 20px; margin-bottom: 12px; }
            p { color: #a3a3a3; font-size: 14px; line-height: 1.6; }
            code { background: #262626; padding: 2px 8px; border-radius: 4px; font-size: 13px; }
          </style></head>
          <body>
            <div class="card">
              <h1>Dashboard Not Built</h1>
              <p>Run the following to build the dashboard:</p>
              <p><code>cd packages/dashboard && yarn build</code></p>
              <p>Then restart the agent to serve it.</p>
            </div>
          </body>
        </html>
      `);
    });
    logger.warn("Dashboard static files not found — run 'cd packages/dashboard && yarn build'");
    return router;
  }

  logger.info(`Serving dashboard from ${staticDir}`);

  // Parse cookies for token-based session auth
  router.use("/dashboard", parseCookies);

  // Dashboard auth middleware: validate ?token= query param or session cookie
  if (opts.authToken) {
    router.use("/dashboard", (req: Request, res: Response, next) => {
      // Allow static assets (CSS, JS, images) without auth
      if (req.path.match(/\.(js|css|ico|png|svg|jpg|woff2?|map|txt)$/)) {
        return next();
      }

      const token = (req.query.token as string) || req.cookies?.dashboardToken;
      if (token === opts.authToken) {
        // Set a session cookie so user doesn't need token in every URL
        if (!req.cookies?.dashboardToken) {
          res.cookie("dashboardToken", token, {
            httpOnly: true,
            sameSite: "strict",
            maxAge: 24 * 60 * 60 * 1000, // 24 hours
          });
        }
        return next();
      }

      // No valid token — show login page
      res.status(401).send(`
        <html>
          <head><title>Dashboard — Authentication Required</title>
          <style>
            body { font-family: system-ui; background: #0a0a0a; color: #e5e5e5; display: flex;
                   align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
            .card { background: #171717; border: 1px solid #262626; border-radius: 12px; padding: 40px;
                    max-width: 420px; text-align: center; }
            h1 { font-size: 20px; margin-bottom: 8px; }
            p { color: #a3a3a3; font-size: 14px; line-height: 1.6; }
            form { margin-top: 24px; }
            input { width: 100%; padding: 10px 14px; background: #262626; border: 1px solid #404040;
                    border-radius: 8px; color: #fff; font-size: 14px; margin-bottom: 12px;
                    box-sizing: border-box; }
            input:focus { outline: none; border-color: #3b82f6; }
            button { width: 100%; padding: 10px; background: #3b82f6; color: white; border: none;
                     border-radius: 8px; font-size: 14px; cursor: pointer; font-weight: 500; }
            button:hover { background: #2563eb; }
            .hint { font-size: 12px; color: #525252; margin-top: 16px; }
          </style></head>
          <body>
            <div class="card">
              <h1>Authentication Required</h1>
              <p>Enter your auth token to access the dashboard.</p>
              <form method="GET" action="/dashboard/">
                <input type="password" name="token" placeholder="Auth token" autofocus required />
                <button type="submit">Sign In</button>
              </form>
              <p class="hint">Your token was generated during setup.<br/>
              Check your config file or run <code>remote-coding-agent setup</code>.</p>
            </div>
          </body>
        </html>
      `);
    });
  }

  // Serve static files at /dashboard/
  router.use("/dashboard", express.static(staticDir, {
    maxAge: "1h",
    index: false,  // We handle index ourselves for SPA routing
  }));

  // Serve the dashboard sub-path (Next.js static export puts pages in subdirs)
  // e.g., /dashboard/ → /dashboard/index.html
  //       /dashboard/sessions/ → /dashboard/sessions/index.html (or sessions.html)
  router.get("/dashboard/*", (req: Request, res: Response) => {
    const reqPath = req.path.replace("/dashboard", "").replace(/\/$/, "") || "";

    // Try: exact file, then dir/index.html, then .html extension
    const candidates = [
      path.join(staticDir, reqPath),
      path.join(staticDir, reqPath, "index.html"),
      path.join(staticDir, `${reqPath}.html`),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return res.sendFile(candidate);
      }
    }

    // Fallback: serve the root index.html for client-side routing
    const indexPath = path.join(staticDir, "index.html");
    if (fs.existsSync(indexPath)) {
      return res.sendFile(indexPath);
    }

    res.status(404).send("Not found");
  });

  // Redirect /dashboard → /dashboard/
  router.get("/dashboard", (_req: Request, res: Response) => {
    res.redirect("/dashboard/");
  });

  return router;
}
