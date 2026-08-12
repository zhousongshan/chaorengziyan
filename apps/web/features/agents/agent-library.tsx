"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  ImageIcon,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
  X
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import type { Agent, CreateAgentRequest } from "@chaoren/contracts";

import { Button } from "@/components/ui/button";
import { apiClient, ApiError } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";

import styles from "./agent-library.module.css";

type AgentTypeFilter = "all" | "image";
type AgentTimeRange = "all" | "today" | "7d" | "30d";

export function AgentLibrary() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [type, setType] = useState<AgentTypeFilter>("all");
  const [timeRange, setTimeRange] = useState<AgentTimeRange>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Agent | null>(null);
  const [renameName, setRenameName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);
  const [notice, setNotice] = useState("");

  const listQuery = { keyword, type, timeRange, page, pageSize };
  const agentsQuery = useQuery({
    queryKey: queryKeys.agents(listQuery),
    queryFn: () => apiClient.getAgents(listQuery)
  });

  const refreshAgents = () => queryClient.invalidateQueries({ queryKey: ["agents"] });
  const createMutation = useMutation({
    mutationFn: (input: CreateAgentRequest) => apiClient.createAgent(input),
    onSuccess: async (agent) => {
      await refreshAgents();
      router.push(`/create/image?agentId=${encodeURIComponent(agent.id)}`);
    }
  });
  const copyMutation = useMutation({
    mutationFn: (agent: Agent) => apiClient.copyAgent(agent.id),
    onSuccess: async (copied) => {
      setPage(1);
      setNotice(`已复制为「${copied.name}」，历史数据未继承。`);
      await refreshAgents();
    },
    onError: (error) => setNotice(errorMessage(error, "复制 Agent 失败"))
  });
  const renameMutation = useMutation({
    mutationFn: (input: { agent: Agent; name: string }) =>
      apiClient.renameAgent(input.agent.id, { name: input.name }),
    onSuccess: async (renamed) => {
      setRenameTarget(null);
      setNotice(`已重命名为「${renamed.name}」。`);
      await refreshAgents();
    }
  });
  const deleteMutation = useMutation({
    mutationFn: (agent: Agent) => apiClient.deleteAgent(agent.id),
    onSuccess: async (_, deleted) => {
      setDeleteTarget(null);
      if ((agentsQuery.data?.items.length ?? 0) === 1 && page > 1) setPage(page - 1);
      setNotice(`已删除「${deleted.name}」。`);
      await refreshAgents();
    }
  });

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setKeyword(searchInput.trim());
  };

  const openRename = (agent: Agent) => {
    renameMutation.reset();
    setRenameName(agent.name);
    setRenameTarget(agent);
  };

  const totalPages = Math.max(1, agentsQuery.data?.pagination.totalPages ?? 1);

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>智能创作</h1>
          <p>管理已创建的电商内容生成 Agent，快速复制与配置。</p>
        </div>
        <Button className={styles.createButton} type="button" onClick={() => setCreateOpen(true)}>
          <Plus />
          新建 Agent
        </Button>
      </header>

      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          <label>
            <span>类型</span>
            <select
              value={type}
              onChange={(event) => {
                setPage(1);
                setType(event.target.value as AgentTypeFilter);
              }}
            >
              <option value="all">全部类型</option>
              <option value="image">生图 Agent</option>
              <option value="video" disabled>
                视频 Agent（后续开放）
              </option>
            </select>
          </label>
          <label>
            <span>创建时间</span>
            <select
              value={timeRange}
              onChange={(event) => {
                setPage(1);
                setTimeRange(event.target.value as AgentTimeRange);
              }}
            >
              <option value="all">全部时间</option>
              <option value="today">今天创建</option>
              <option value="7d">近 7 天</option>
              <option value="30d">近 30 天</option>
            </select>
          </label>
        </div>
        <form className={styles.searchForm} onSubmit={submitSearch}>
          <label>
            <Search />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="搜索名称或简介"
              aria-label="搜索 Agent"
            />
          </label>
          <Button type="submit" variant="secondary">
            <Search />
            搜索
          </Button>
        </form>
      </div>

      <div className={styles.table} aria-busy={agentsQuery.isFetching}>
        <div className={styles.tableHeader} aria-hidden="true">
          <span>名称</span>
          <span>简介</span>
          <span>类型</span>
          <span>创建时间</span>
          <span>操作</span>
        </div>
        {agentsQuery.isPending ? (
          <div className={styles.loading}>
            <LoaderCircle />
            正在加载 Agent
          </div>
        ) : agentsQuery.isError ? (
          <div className={styles.empty}>
            <span>{errorMessage(agentsQuery.error, "Agent 列表加载失败")}</span>
            <Button type="button" variant="secondary" onClick={() => agentsQuery.refetch()}>
              重新加载
            </Button>
          </div>
        ) : agentsQuery.data.items.length === 0 ? (
          <div className={styles.empty}>没有找到符合当前条件的 Agent，请调整关键词或筛选条件。</div>
        ) : (
          agentsQuery.data.items.map((agent) => (
            <article className={styles.row} key={agent.id}>
              <Link
                className={styles.primary}
                href={`/create/image?agentId=${encodeURIComponent(agent.id)}`}
              >
                <span className={styles.agentIcon}>
                  <ImageIcon />
                </span>
                <span>
                  <strong>{agent.name}</strong>
                  <small>{agentModeLabel(agent.mode)}</small>
                </span>
              </Link>
              <p title={agent.description || "暂未填写简介"}>
                {agent.description || "暂未填写简介"}
              </p>
              <span className={styles.tag}>生图</span>
              <time dateTime={agent.createdAt}>{formatAgentTime(agent.createdAt)}</time>
              <div className={styles.actions}>
                <button
                  type="button"
                  onClick={() => copyMutation.mutate(agent)}
                  disabled={copyMutation.isPending}
                  aria-label={`复制 ${agent.name}`}
                >
                  <Copy />
                  复制
                </button>
                <button
                  type="button"
                  onClick={() => openRename(agent)}
                  disabled={agent.origin === "system"}
                  title={agent.origin === "system" ? "系统内置 Agent 不支持重命名" : undefined}
                  aria-label={`重命名 ${agent.name}`}
                >
                  <Pencil />
                  重命名
                </button>
                <button
                  type="button"
                  onClick={() => {
                    deleteMutation.reset();
                    setDeleteTarget(agent);
                  }}
                  disabled={agent.origin === "system"}
                  title={agent.origin === "system" ? "系统内置 Agent 不支持删除" : undefined}
                  aria-label={`删除 ${agent.name}`}
                >
                  <Trash2 />
                  删除
                </button>
              </div>
            </article>
          ))
        )}
        <footer className={styles.pagination}>
          <span>共 {agentsQuery.data?.pagination.total ?? 0} 个 Agent</span>
          <div>
            <span>每页显示</span>
            <select
              value={pageSize}
              aria-label="每页显示数量"
              onChange={(event) => {
                setPage(1);
                setPageSize(Number(event.target.value));
              }}
            >
              <option value="10">10 条</option>
              <option value="20">20 条</option>
              <option value="50">50 条</option>
            </select>
            <button
              type="button"
              aria-label="上一页"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft />
            </button>
            <button type="button" className={styles.currentPage} aria-current="page">
              {page}
            </button>
            <button
              type="button"
              aria-label="下一页"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              <ChevronRight />
            </button>
            <span>跳至</span>
            <select
              value={Math.min(page, totalPages)}
              aria-label="选择目标页码"
              onChange={(event) => setPage(Number(event.target.value))}
            >
              {Array.from({ length: totalPages }, (_, index) => (
                <option key={index + 1} value={index + 1}>
                  {index + 1}
                </option>
              ))}
            </select>
            <span>页</span>
          </div>
        </footer>
      </div>

      <p className={styles.notice} aria-live="polite">
        {notice}
      </p>

      <CreateAgentDialog
        open={createOpen}
        pending={createMutation.isPending}
        error={createMutation.error}
        onOpenChange={(open) => {
          if (!open) createMutation.reset();
          setCreateOpen(open);
        }}
        onCreate={(input) => createMutation.mutateAsync(input).then(() => undefined)}
      />
      <RenameAgentDialog
        agent={renameTarget}
        name={renameName}
        pending={renameMutation.isPending}
        error={renameMutation.error}
        onNameChange={setRenameName}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        onSubmit={() => {
          const name = renameName.trim();
          if (renameTarget && name) renameMutation.mutate({ agent: renameTarget, name });
        }}
      />
      <DeleteAgentDialog
        agent={deleteTarget}
        pending={deleteMutation.isPending}
        error={deleteMutation.error}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
      />
    </section>
  );
}

function CreateAgentDialog({
  open,
  pending,
  error,
  onOpenChange,
  onCreate
}: Readonly<{
  open: boolean;
  pending: boolean;
  error: unknown;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: CreateAgentRequest) => Promise<void>;
}>) {
  const [step, setStep] = useState<"type" | "details">("type");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [agentInstruction, setAgentInstruction] = useState("");
  const [validationError, setValidationError] = useState("");

  const reset = () => {
    setStep("type");
    setName("");
    setDescription("");
    setAgentInstruction("");
    setValidationError("");
  };

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen && !pending) reset();
    if (!pending) onOpenChange(nextOpen);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setValidationError("请填写 Agent 名称");
      return;
    }
    setValidationError("");
    await onCreate({
      name: trimmedName,
      description: description.trim(),
      agentInstruction: agentInstruction.trim(),
      type: "image"
    }).catch(() => undefined);
  };

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={styles.dialog}>
          <div className={styles.dialogHeader}>
            <div>
              <Dialog.Title>{step === "type" ? "新建 Agent" : "填写 Agent 信息"}</Dialog.Title>
              <Dialog.Description>
                {step === "type"
                  ? "请选择要创建的 Agent 类型"
                  : "名称用于列表识别，其余内容可以稍后再完善。"}
              </Dialog.Description>
            </div>
            <Dialog.Close className={styles.dialogClose} aria-label="关闭" disabled={pending}>
              <X />
            </Dialog.Close>
          </div>
          {step === "type" ? (
            <div className={styles.dialogBody}>
              <button type="button" className={styles.typeCard} aria-pressed="true">
                <span className={styles.typeIcon}>
                  <ImageIcon />
                </span>
                <span>
                  <strong>生图 Agent</strong>
                  <small>用于生成电商主图、场景图、推广图、详情图和视频封面图。</small>
                </span>
                <span className={styles.radioDot} />
              </button>
              <button type="button" className={styles.typeCard} disabled>
                <span className={styles.typeIcon}>V</span>
                <span>
                  <strong>视频 Agent</strong>
                  <small>视频生成将在后续阶段开放。</small>
                </span>
                <span className={styles.radioDot} />
              </button>
              <div className={styles.dialogFooter}>
                <Button type="button" variant="secondary" onClick={() => changeOpen(false)}>
                  取消
                </Button>
                <Button type="button" onClick={() => setStep("details")}>
                  下一步
                </Button>
              </div>
            </div>
          ) : (
            <form className={styles.dialogBody} onSubmit={submit} noValidate>
              <label className={styles.formField}>
                <span>Agent 名称 *</span>
                <input
                  value={name}
                  maxLength={40}
                  autoFocus
                  placeholder="例如：夏季活动海报 Agent"
                  onChange={(event) => {
                    setName(event.target.value);
                    if (event.target.value.trim()) setValidationError("");
                  }}
                  aria-invalid={Boolean(validationError)}
                />
                <small>{validationError || `${name.length}/40`}</small>
              </label>
              <label className={styles.formField}>
                <span>简介（选填）</span>
                <textarea
                  value={description}
                  maxLength={120}
                  placeholder="简单说明这个 Agent 可以完成什么任务"
                  onChange={(event) => setDescription(event.target.value)}
                />
                <small>{description.length}/120</small>
              </label>
              <label className={styles.formField}>
                <span>Agent 设定（选填）</span>
                <textarea
                  className={styles.instructionInput}
                  value={agentInstruction}
                  maxLength={1_000}
                  placeholder="输入角色身份、工作流程、生成约束、风格要求等内容"
                  onChange={(event) => setAgentInstruction(event.target.value)}
                />
                <small>{agentInstruction.length}/1000</small>
              </label>
              {(error || validationError) && (
                <p className={styles.formError} role="alert">
                  {validationError || errorMessage(error, "创建 Agent 失败")}
                </p>
              )}
              <div className={styles.dialogFooter}>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => setStep("type")}
                >
                  上一步
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending && <LoaderCircle className={styles.spinning} />}
                  创建 Agent
                </Button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RenameAgentDialog({
  agent,
  name,
  pending,
  error,
  onNameChange,
  onOpenChange,
  onSubmit
}: Readonly<{
  agent: Agent | null;
  name: string;
  pending: boolean;
  error: unknown;
  onNameChange: (name: string) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
}>) {
  return (
    <Dialog.Root open={Boolean(agent)} onOpenChange={(open) => !pending && onOpenChange(open)}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={styles.smallDialog}>
          <Dialog.Title>重命名 Agent</Dialog.Title>
          <Dialog.Description>只修改 Agent 名称，不影响配置和历史数据。</Dialog.Description>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            <label className={styles.formField}>
              <span>Agent 名称</span>
              <input
                value={name}
                maxLength={40}
                autoFocus
                required
                onChange={(event) => onNameChange(event.target.value)}
              />
            </label>
            {Boolean(error) && (
              <p className={styles.formError}>{errorMessage(error, "重命名失败")}</p>
            )}
            <div className={styles.dialogFooter}>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => onOpenChange(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={pending || !name.trim()}>
                {pending && <LoaderCircle className={styles.spinning} />}
                保存
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DeleteAgentDialog({
  agent,
  pending,
  error,
  onOpenChange,
  onConfirm
}: Readonly<{
  agent: Agent | null;
  pending: boolean;
  error: unknown;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}>) {
  return (
    <Dialog.Root open={Boolean(agent)} onOpenChange={(open) => !pending && onOpenChange(open)}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={styles.smallDialog}>
          <Dialog.Title>删除 Agent</Dialog.Title>
          <Dialog.Description>
            确定要删除「{agent?.name}」吗？删除后该 Agent 将从列表中移除，此操作无法撤销。
          </Dialog.Description>
          {Boolean(error) && <p className={styles.formError}>{errorMessage(error, "删除失败")}</p>}
          <div className={styles.dialogFooter}>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="button" variant="danger" disabled={pending} onClick={onConfirm}>
              {pending && <LoaderCircle className={styles.spinning} />}
              确认删除
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function agentModeLabel(mode: Agent["mode"]) {
  return mode === "normal" ? "普通模式" : "智能模式";
}

function formatAgentTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  })
    .format(new Date(value))
    .replaceAll("/", "-");
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return fallback;
}
