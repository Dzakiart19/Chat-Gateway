import { MongoClient, type Db } from "mongodb";
import { logger } from "./logger";

const uri = process.env["MONGODB_URI"];
const dbName = process.env["MONGODB_DATABASE"] ?? "manus";

if (!uri) {
  logger.warn("MONGODB_URI not set — MongoDB features will be unavailable");
}

let client: MongoClient | null = null;
let dbInstance: Db | null = null;

export async function getDb(): Promise<Db> {
  if (dbInstance) return dbInstance;
  if (!uri) throw new Error("MONGODB_URI environment variable is not set");
  if (!client) {
    client = new MongoClient(uri);
    await client.connect();
    logger.info({ dbName }, "Connected to MongoDB");
  }
  dbInstance = client.db(dbName);
  // Ensure indexes
  await dbInstance.collection("users").createIndex({ email: 1 }, { unique: true });
  await dbInstance.collection("api_keys").createIndex({ key_hash: 1 });
  await dbInstance.collection("api_keys").createIndex({ user_id: 1 });
  return dbInstance;
}
