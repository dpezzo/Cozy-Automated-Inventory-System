import "dotenv/config";
import express from "express";
import session from "express-session";
import path from "node:path";
import { initRepository, getDbDriver } from "./db";
import { createSessionStore } from "./sessionStore";
import { router, errorHandler } from "./routes";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is required.`);
  return value;
}

async function main() {
  const driver = getDbDriver();
  const repo = await initRepository();
  // eslint-disable-next-line no-console
  console.log(`Database driver: ${driver}`);

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "5mb" }));

  // Cookie "secure" must reflect whether the connection is actually HTTPS,
  // not merely NODE_ENV: this app is served over plain http://localhost in
  // its default native deployment, and a "secure" cookie is silently
  // dropped (no Set-Cookie header at all) over a non-TLS connection. Set
  // COOKIE_SECURE=true only when running behind a TLS-terminating proxy.
  const cookieSecure = process.env.COOKIE_SECURE === "true";
  app.set("trust proxy", 1);
  app.use(
    session({
      store: await createSessionStore(repo),
      secret: requireEnv("SESSION_SECRET"),
      name: "cw.sid",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: cookieSecure,
        maxAge: 1000 * 60 * 60 * 12,
      },
    }),
  );

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", dbDriver: driver });
  });

  app.use("/api", router);

  // Serve the built React app as static files (single-process modular
  // monolith deployment; no separate frontend server or CDN needed).
  // Uploaded/generated private files live under data/files, never here.
  const webDist = path.resolve(__dirname, "../../web/dist");
  app.use(express.static(webDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) {
      next();
      return;
    }
    res.sendFile(path.join(webDist, "index.html"), (err) => {
      if (err) next();
    });
  });

  app.use(errorHandler);

  const port = Number(process.env.PORT ?? 3000);
  const server = app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`CozyWinters Olliix reconciliation server listening on port ${port}`);
  });

  function shutdown() {
    // eslint-disable-next-line no-console
    console.log("Shutting down...");
    server.close(() => process.exit(0));
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server:", err);
  process.exit(1);
});
