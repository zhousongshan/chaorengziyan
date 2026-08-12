import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import multipart from "@fastify/multipart";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { config } from "dotenv";
import { ProxyAgent, setGlobalDispatcher } from "undici";

import { assertSupportedNodeRuntime } from "@chaoren/contracts";
import { resolveWorkspacePath } from "@chaoren/storage";

import { AppModule } from "./app.module.js";
import { assertSafeDeploymentConfiguration } from "./deployment-security.js";
import { readEnvironment } from "./environment.js";

assertSupportedNodeRuntime();
config({ path: await resolveWorkspacePath(".env"), quiet: true });
const environment = readEnvironment();
assertSafeDeploymentConfiguration(environment);
if (environment.OUTBOUND_HTTP_PROXY_URL) {
  setGlobalDispatcher(new ProxyAgent(environment.OUTBOUND_HTTP_PROXY_URL));
}

const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter({ bodyLimit: environment.MAX_UPLOAD_BYTES + 1024 * 1024 }),
  {
    logger: environment.LOG_LEVEL === "silent" ? false : ["error", "warn", "log"]
  }
);

app.setGlobalPrefix("api/v1");
app.enableCors({
  origin: environment.CORS_ORIGIN,
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
});
app.enableShutdownHooks();
await app.register(helmet, { contentSecurityPolicy: false });
await app.register(rateLimit, {
  max: environment.API_RATE_LIMIT_MAX,
  timeWindow: environment.API_RATE_LIMIT_WINDOW_MS
});
await app.register(multipart, {
  limits: { files: 1, fileSize: environment.MAX_UPLOAD_BYTES }
});

await app.listen(environment.API_PORT, environment.API_HOST);
