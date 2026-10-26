import path from "node:path";
import express from "express";
import { loadEnvFile } from "./src/shopify-sellvia-sync.js";
import routes from "./src/routes.js";

await loadEnvFile(path.resolve(".env"));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use("/api", routes);

app.listen(PORT, async () => {
  console.log(`Fabulous Gems server running on port ${PORT}`);

  // Optional: host the background workers inside this process (see docs/BACKGROUND_WORKERS.md).
  if (process.env.BACKGROUND_WORKERS_ENABLED === "true" && process.env.WORKERS_IN_PROCESS === "true") {
    const { PrismaClient } = await import("@prisma/client");
    const { startWorkers } = await import("./src/workers/index.js");
    startWorkers({ prisma: new PrismaClient() });
  }
});
