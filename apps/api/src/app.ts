import express, { type NextFunction, type Request, type Response } from "express";
import type { ApiError } from "@remotefit/core";
import { HttpError, jobsRouter, type JobsRoutesOptions } from "./jobs/routes.js";

/** Without `jobs` only /health is mounted (used by the smoke test and before the database exists). */
export function createApp(options: { jobs?: JobsRoutesOptions } = {}): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  if (options.jobs) app.use("/api", jobsRouter(options.jobs));

  app.use("/api", (_req: Request, res: Response) => {
    const body: ApiError = { error: { code: "not_found", message: "Unknown route" } };
    res.status(404).json(body);
  });
  // One error format for every route. Internal details stay in the server log. Express recognises an error handler
  // by its four parameters, so `_next` must stay even though it is unused.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) {
      const body: ApiError = { error: { code: error.code, message: error.message } };
      res.status(error.status).json(body);
      return;
    }
    console.error(error);
    const body: ApiError = { error: { code: "internal", message: "Internal error" } };
    res.status(500).json(body);
  });
  return app;
}
