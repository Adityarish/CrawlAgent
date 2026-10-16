import "dotenv/config";
import { createApp } from "./app.js";
import { connectDatabase, disconnectDatabase } from "./config/database.js";
import { importJobsFromFile } from "./services/job-importer.js";
import { syncSourcesFromFile } from "./services/source-sync.js";

const host = process.env.API_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.API_PORT || "8000", 10);

async function start() {
  await connectDatabase();
  const [jobs, sources] = await Promise.all([importJobsFromFile(), syncSourcesFromFile()]);
  const server = createApp().listen(port, host, () => {
    console.log(`JobAtlas API ready at http://${host}:${port}`);
    console.log(`MongoDB synced: ${jobs.imported} jobs and ${sources} sources.`);
  });

  const shutdown = async () => {
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((error) => {
  console.error(`Unable to start API: ${error.message}`);
  process.exit(1);
});
