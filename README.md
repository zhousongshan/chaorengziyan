# Chaoren Media AI

电商图片与视频生成 Agent 的全新工程基线。

## 技术基线

- Node.js 24 LTS、TypeScript、pnpm workspace、Turborepo
- Next.js Web
- NestJS + Fastify API
- BullMQ Worker
- PostgreSQL + Drizzle ORM
- Redis
- 本地文件系统媒体存储，后续通过 `StoragePort` 切换到 S3/OSS

## 目录

```text
apps/web             Web 应用
apps/api             API 与 Agent Runtime 入口
apps/worker          异步媒体任务执行器
packages/contracts   API、任务与 AI 结构化契约
packages/database    PostgreSQL 与 Drizzle
packages/image-generation 生图模型目录、指令与厂商适配器
packages/subject-consistency 主体一致性质检、需求失败重整与模型适配器
packages/storage     媒体存储端口和本地适配器
```

## 本地启动

1. 安装 fnm、Node.js 24 和 pnpm 11。仓库的 `.nvmrc` 固定为 Node 24，启动入口会使用 fnm
   显式切换运行时，并拒绝 Node 24 以外的版本。
2. 将 `.env.example` 复制为 `.env`，当前仓库已提供本地默认值。
3. 启动 PostgreSQL 和 Redis。可安装 Docker Desktop 后运行 `pnpm infra:up`；本机也可运行
   `brew services start postgresql@17`，并用 `brew install redis && brew services start redis`
   启动Redis。
4. 首次启动或数据库结构更新后运行 `pnpm db:migrate`。
5. 运行 `./scripts/dev start` 启动 Web、API 和 Worker。启动入口会固定使用 Node 24，并在
   `.local-run` 记录受管进程。启动前会先构建 workspace 包、校验迁移契约，并拒绝重复的项目进程或
   `3000/3001` 端口冲突；发现旧进程时先停止旧服务，不要重复启动。
6. API 和 Worker 会在启动时校验数据库迁移版本与哈希。如果提示数据库迁移不兼容，先备份数据库和
   `.local-data/media`，再运行 `pnpm db:migrate`，不要绕过校验。

地址：

- Web: `http://127.0.0.1:3000`
- API health: `http://127.0.0.1:3001/api/v1/health`
- API readiness: `http://127.0.0.1:3001/api/v1/health/ready`

开发服务管理：

```bash
./scripts/dev status # 同时检查 Web、API、数据库 Schema、Redis 和 Worker
./scripts/dev stop   # 结束完整开发进程树
./scripts/dev clean  # 仅清理构建缓存和测试产物，业务数据与备份不会被删除
```

不要直接删除 `.env`、`.local-data` 或 `backups`。如果 macOS 拒绝访问项目文件并返回
`Operation not permitted`，应将整个仓库移到 `~/Projects` 等非受保护目录，或为运行工具授予
“文稿文件夹”访问权限；重复启动进程无法绕过该系统限制。

## 智能创作 Agent

`GET /api/v1/agents` 提供关键词、类型、创建时间和分页筛选；`POST /api/v1/agents` 创建自建生图
Agent。复制、重命名和删除分别使用 `POST /api/v1/agents/:id/copies`、
`PATCH /api/v1/agents/:id` 和 `DELETE /api/v1/agents/:id`。系统内置 Agent 只能读取和复制，
不能改名或删除；自建 Agent 始终按当前用户隔离。

## 普通模式需求识别

接口：`POST /api/v1/requirements/resolve`

需求 AI 只接收用户文字、图片数量和比例。前端选择的 `modelId` 与
`productImageIds`、`referenceImageIds` 均由 API 保留，不会发送给需求 AI。

可选生图模型：`GET /api/v1/image-models`

需求识别、图片上传前需要先创建项目：

```bash
curl http://127.0.0.1:3001/api/v1/projects \
  --header 'content-type: application/json' \
  --data '{"name":"夏季主图项目","description":"商品主图与详情页素材"}'
```

使用真实模型前，在 `.env` 配置：

```dotenv
REQUIREMENT_AI_BASE_URL=https://jennyapi.site/v1
REQUIREMENT_AI_API_KEY=your-key
REQUIREMENT_AI_MODEL=gpt-5.6-sol
```

请求示例：

```bash
curl http://127.0.0.1:3001/api/v1/requirements/resolve \
  --header 'content-type: application/json' \
  --data '{
    "projectId":"00000000-0000-4000-8000-000000000010",
    "modelId":"bytedance-image",
    "userText":"生成两张简洁的电商主图",
    "imageSettings":{"imageCount":2,"aspectRatio":"1:1"},
    "productImageIds":[],
    "referenceImageIds":[]
  }'
```

本机媒体文件保存在 `.local-data/media`，该目录不会提交到 Git。

## 普通模式生图

普通模式不再调用第二个提示词 AI。需求 AI 返回的 `finalRequirement` 是唯一的
业务需求，模型适配器只将其转换成厂商接口需要的字段，并把商品图、参考图按顺序
发送给前端已经选择的模型。

### 1. 上传商品图或参考图

接口：`POST /api/v1/media-assets/images`

```bash
curl http://127.0.0.1:3001/api/v1/media-assets/images \
  --form projectId=00000000-0000-4000-8000-000000000010 \
  --form file=@/absolute/path/product.png
```

响应中的 `id` 可放入需求识别请求的 `productImageIds` 或
`referenceImageIds`。读取图片内容：`GET /api/v1/media-assets/:id/content`。

### 2. 创建生图任务

需求识别返回 `ready` 后，只提交对应的需求记录 ID：

```bash
curl http://127.0.0.1:3001/api/v1/image-generations \
  --header 'content-type: application/json' \
  --data '{"requirementRunId":"00000000-0000-4000-8000-000000000020"}'
```

接口返回 `202` 和 `taskId`。查询任务：

```bash
curl http://127.0.0.1:3001/api/v1/image-generations/<taskId>
```

状态流转为 `queued -> running -> succeeded/failed`。成功时 `resultAssets`
包含生成图片的资产 ID，可通过媒体内容接口读取。

### 3. 配置真实生图服务

xfastapi.ai 同步 OpenAI 兼容图片接口：

```dotenv
OPENAI_IMAGE_BASE_URL=https://xfastapi.ai
OPENAI_IMAGE_API_KEY=your-key
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_API_MODE=xfastapi
IMAGE_GENERATION_TIMEOUT_MS=300000
```

该模式使用标准 `images/generations` 和 `images/edits` 接口，结果直接读取
`b64_json`。多张图片仍由 Worker 按输出单元独立生成，参考图会通过编辑接口上传。

旧的 Jenny 异步中转仍可通过 `OPENAI_IMAGE_API_MODE=async-relay` 保留，但不再是默认配置。

字节火山方舟图片接口：

```dotenv
BYTEDANCE_IMAGE_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
BYTEDANCE_IMAGE_API_KEY=your-key
BYTEDANCE_IMAGE_MODEL=your-endpoint-or-model-id
```

未配置对应服务时，任务会进入 `failed`，错误码为
`IMAGE_PROVIDER_NOT_CONFIGURED`，不会返回伪造图片或自动切换模型。

项目、需求记录、媒体元数据、生图任务和结果关联均保存在 PostgreSQL，媒体文件写入
本地存储目录，API重启后仍可通过原ID读取。

生图任务通过BullMQ交给独立Worker执行。API只校验请求、持久化任务并投递版本化的
`taskId`；需求、素材和模型选择始终从PostgreSQL重新读取，图片本身不会写入Redis。
Worker负责 `queued -> running -> succeeded/failed` 状态流转、加载素材、调用厂商模型、
保存结果和写入输出关联。队列使用 `taskId` 作为 `jobId`，并支持并发限制、指数退避、
失败重试、stalled任务恢复和优雅停机。API启动时会补投数据库中仍为
`queued/running` 的任务，不再因API重启直接判失败。

Worker参数：

```dotenv
IMAGE_WORKER_CONCURRENCY=2
# 独立输出单元重试退避时间；输出单元固定为首次执行加一次重试
IMAGE_JOB_BACKOFF_MS=2000
```

## 商品主体一致性检查

普通模式当前最多接收一张商品图。商品主体默认保持不变，只有用户明确要求的主体特征
才会写入 `finalRequirement.subjectPolicy.allowedChanges`。背景、场景、构图、风格、
氛围和光线变化不会自动授权主体发生变化。

每张带商品图的生成结果保存成功后，会自动创建独立的主体一致性检查：

```text
原商品图 + 生成图 + 用户原话 + R1
  -> 第一次主体质检
  -> 明确失败：失败原因和具体变化交给需求AI重整主体策略R2
  -> 需求歧义：向用户提问，保存回答后再交给需求AI重整R2
  -> 原图证据不足：停止并要求更换清晰商品图
  -> 第二次主体质检
  -> 通过，或终止并提示用户改变需求/更换商品图
```

主体不完整不是失败条件，局部特写、合理裁切、遮挡、缩放和视角变化均被允许。
质检只比较可见且可比较的商品身份、轮廓、结构、部件、颜色、材质、图案、Logo和
包装特征。需求语义由AI处理，程序仅校验结构、数据归属和最多两轮的工作流边界。

质检模型配置：

```dotenv
SUBJECT_INSPECTION_AI_BASE_URL=https://jennyapi.site/v1
SUBJECT_INSPECTION_AI_API_KEY=your-key
SUBJECT_INSPECTION_AI_MODEL=gpt-5.6-sol
SUBJECT_INSPECTION_AI_TIMEOUT_MS=60000
SUBJECT_INSPECTION_WORKER_CONCURRENCY=2
SUBJECT_INSPECTION_JOB_ATTEMPTS=2
SUBJECT_INSPECTION_JOB_BACKOFF_MS=2000
```

查询某个生图任务的所有质检记录：

```bash
curl http://127.0.0.1:3001/api/v1/image-generations/<taskId>/subject-consistency-checks
```

查询单条质检记录：

```bash
curl http://127.0.0.1:3001/api/v1/subject-consistency-checks/<checkId>
```

提交一次需求歧义回答，并恢复需求重整和第二次检查：

```bash
curl -X POST http://127.0.0.1:3001/api/v1/subject-consistency-checks/<checkId>/responses \
  -H 'Content-Type: application/json' \
  -d '{"answers":[{"question":"原问题","answer":"用户回答"}]}'
```

订阅一个生图任务的聚合质检状态：

```text
GET /api/v1/image-generations/<taskId>/subject-consistency-events
```

用户回答只能消除质检提出的原始歧义，不能扩大或改写用户原意；问题集合、顺序和内容由 API 严格匹配。
同一检查只接受一组不可变回答。原图证据不足不能通过文字补充绕过。

质检状态和业务结论相互独立：`execution_failed` 表示模型或基础设施执行失败；
`completed + rejected` 表示质检正常完成，但生成图主体不符合要求。PostgreSQL保存两轮
质检结果、需求AI重整结果、模型版本和Prompt版本，Worker重启后会从已持久化的阶段继续。

数据库Repository集成测试：

先在 `.env` 配置独立的 `TEST_DATABASE_URL`。测试会拒绝连接普通开发数据库，数据库名称需包含
`test` 标识。下列命令会先自动迁移测试库，并校验最新迁移版本与哈希；不要跳过它直接运行 Vitest。

```bash
pnpm --filter @chaoren/api test:integration
pnpm --filter @chaoren/worker test:integration
```
