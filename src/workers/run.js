import { startStandalone } from "./index.js";

try {
  const { loadEnvFile } = await import("../shopify-sellvia-sync.js");
  await loadEnvFile();
} catch (error) {
  console.warn(JSON.stringify({ level: "warn", worker: "scheduler", message: "could not load .env file", error: error.message }));
}
startStandalone();
