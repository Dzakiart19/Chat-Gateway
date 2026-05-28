import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import v1Router from "./routes/v1";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (_req, res) => {
  res.json({
    name: "Qwen API Gateway",
    version: "1.0.0",
    status: "ok",
    docs: "https://platform.openai.com/docs/api-reference",
    endpoints: {
      chat: "POST /v1/chat/completions",
      models: "GET /v1/models",
      health: "GET /api/healthz",
      register: "POST /api/auth/register",
      login: "POST /api/auth/login",
      apikeys: "GET/POST /api/apikeys",
    },
  });
});

app.use("/api", router);
app.use("/v1", v1Router);

export default app;
