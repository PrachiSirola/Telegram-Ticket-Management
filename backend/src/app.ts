import "express-async-errors";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { env } from "./env.js";
import { loadUser } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.js";
import { meRouter } from "./routes/me.js";
import { orgsRouter } from "./routes/orgs.js";
import { invitesRouter } from "./routes/invites.js";
import { projectsRouter } from "./routes/projects.js";
import { projectTicketsRouter, ticketsRouter } from "./routes/tickets.js";
import { commentsRouter } from "./routes/comments.js";
import { attachmentsRouter, attachmentFileRouter } from "./routes/attachments.js";
import { ticketActionsRouter } from "./routes/ticketActions.js";

export function createApp() {
  const app = express();

  if (env.isProd) app.set("trust proxy", 1);

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true);

        if (env.frontendOrigins.includes(origin)) {
          return callback(null, true);
        }

        try {
          const url = new URL(origin);
          const normalizedHostname = url.hostname.replace(/^www\./, "");
          const knownHostnames = new Set([
            "ticketmanagement.site",
            "localhost",
            "127.0.0.1",
            "[::1]",
          ]);

          if (knownHostnames.has(normalizedHostname)) {
            return callback(null, true);
          }
        } catch {
          // Ignore malformed origins and reject them below.
        }

        callback(new Error("Not allowed by CORS"));
      },
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser());

  // Attach req.user (if logged in) to every request.
  app.use(loadUser);

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/auth", authRouter);
  app.use("/me", meRouter);

  app.use("/orgs", orgsRouter);
  app.use("/orgs/:orgId/invites", invitesRouter);
  app.use("/orgs/:orgId/projects", projectsRouter);
  app.use("/orgs/:orgId/projects/:projectId/tickets", projectTicketsRouter);

  app.use("/tickets", ticketsRouter);
  app.use("/tickets/:id/comments", commentsRouter);
  app.use("/tickets/:id/attachments", attachmentsRouter);
  app.use("/tickets/:id", ticketActionsRouter);
  app.use("/attachments", attachmentFileRouter);

  // Central error handler.
  app.use(
    (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error("[error]", err);
      res.status(err.status ?? 500).json({ error: err.message ?? "Internal server error" });
    },
  );

  return app;
}