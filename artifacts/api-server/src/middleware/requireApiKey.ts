import type { Request, Response, NextFunction } from "express";
import { hashApiKey } from "../lib/auth-helpers";
import { getDb } from "../lib/mongo";

declare global {
  namespace Express {
    interface Request {
      apiKeyDoc?: { id: string; userId: string; name: string };
    }
  }
}

export async function requireApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authorization header with API key required", code: "missing_key" });
    return;
  }
  const key = auth.slice(7);
  if (!key.startsWith("sk-dzcx")) {
    res.status(401).json({ error: "Invalid API key format", code: "invalid_key" });
    return;
  }
  try {
    const db = await getDb();
    const hash = hashApiKey(key);
    const doc = await db.collection("api_keys").findOne({ key_hash: hash, is_active: true });
    if (!doc) {
      res.status(401).json({ error: "Invalid API key", code: "invalid_key" });
      return;
    }
    req.apiKeyDoc = { id: String(doc._id), userId: String(doc.user_id), name: String(doc.name) };
    // Update usage asynchronously — don't block the request
    void db.collection("api_keys").updateOne(
      { _id: doc._id },
      { $inc: { usage_count: 1 }, $set: { last_used_at: new Date() } }
    );
    next();
  } catch (err) {
    res.status(500).json({ error: "Failed to validate API key" });
  }
}
