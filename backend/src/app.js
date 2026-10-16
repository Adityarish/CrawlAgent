import cors from "cors";
import express from "express";
import helmet from "helmet";
import adminRoutes from "./routes/admin.js";
import publicRoutes from "./routes/public.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(
    cors({
      origin: process.env.FRONTEND_ORIGIN || "http://localhost:3000",
      methods: ["GET", "POST"],
    })
  );
  app.use(express.json({ limit: "32kb" }));
  app.use("/api", publicRoutes);
  app.use("/api/admin", adminRoutes);

  app.use((request, response) => {
    response.status(404).json({ error: `Route ${request.method} ${request.path} was not found.` });
  });
  app.use((error, _request, response, _next) => {
    console.error(error);
    response.status(500).json({ error: "The server could not complete that request." });
  });
  return app;
}
