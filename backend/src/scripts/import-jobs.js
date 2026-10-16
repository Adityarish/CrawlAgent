import "dotenv/config";
import { connectDatabase, disconnectDatabase } from "../config/database.js";
import { importJobsFromFile } from "../services/job-importer.js";
import { syncSourcesFromFile } from "../services/source-sync.js";

try {
  await connectDatabase();
  const jobs = await importJobsFromFile();
  const sources = await syncSourcesFromFile();
  console.log(`Imported ${jobs.imported} jobs and synchronized ${sources} sources.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
