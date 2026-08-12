"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { AssetFolder, MediaAssetListItem, MediaAssetResponse } from "@chaoren/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Ellipsis,
  Folder,
  FolderPlus,
  Images,
  LoaderCircle,
  Pencil,
  Search,
  Trash2,
  Upload,
  X
} from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { activeProjectQueryOptions } from "@/lib/api/active-project";
import { ApiError, apiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";

import { AssetCard } from "./asset-card";
import { AssetDateRangePicker, type AssetDateRange } from "./asset-date-range-picker";
import styles from "./asset-library.module.css";
import {
  runAssetUploadQueue,
  validateAssetUploadFile,
  type AssetUploadUpdate
} from "./asset-upload";

type AssetSourceFilter = "all" | "uploaded" | "generated";
type AssetScope = "all" | "favorites";
type UploadItem = {
  id: string;
  file: File;
  status: "queued" | "uploading" | "succeeded" | "failed";
  error?: string;
};
type NameDialogTarget =
  | { kind: "create-folder" }
  | { kind: "rename-folder"; folder: AssetFolder }
  | { kind: "rename-asset"; asset: MediaAssetListItem };
type DeleteDialogTarget =
  { kind: "folder"; folder: AssetFolder } | { kind: "asset"; asset: MediaAssetListItem };

export function AssetLibrary() {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<AssetScope>("all");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [source, setSource] = useState<AssetSourceFilter>("all");
  const [dateRange, setDateRange] = useState<AssetDateRange | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [previewAsset, setPreviewAsset] = useState<MediaAssetListItem | null>(null);
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [nameDialogTarget, setNameDialogTarget] = useState<NameDialogTarget | null>(null);
  const [deleteDialogTarget, setDeleteDialogTarget] = useState<DeleteDialogTarget | null>(null);
  const [folderChoiceTarget, setFolderChoiceTarget] = useState<MediaAssetListItem | null>(null);
  const [folderChoiceId, setFolderChoiceId] = useState<string>("default");
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const atFavoriteRoot = scope === "favorites" && folderId === null;
  const query = {
    keyword,
    scope,
    ...(folderId ? { folderId } : {}),
    ...(dateRange ? { dateFrom: dateRange.from, dateTo: dateRange.to } : {}),
    source,
    sort: "newest" as const,
    page,
    pageSize
  };
  const assetsQuery = useQuery({
    queryKey: queryKeys.mediaAssets(query),
    queryFn: () => apiClient.getMediaAssets(query),
    enabled: !atFavoriteRoot
  });
  const foldersQuery = useQuery({
    queryKey: queryKeys.assetFolders,
    queryFn: () => apiClient.getAssetFolders()
  });
  const activeProjectQuery = useQuery(activeProjectQueryOptions);
  const pagination = assetsQuery.data?.pagination;
  const uploadInProgress = uploadItems.some(
    (item) => item.status === "queued" || item.status === "uploading"
  );
  const currentFolder = foldersQuery.data?.items.find((folder) => folder.id === folderId);
  const visibleFolders = (foldersQuery.data?.items ?? []).filter(
    (folder) => !keyword || folder.name.toLocaleLowerCase().includes(keyword.toLocaleLowerCase())
  );

  const refreshLibrary = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["media-assets"] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.assetFolders })
    ]);
  };

  const assetMutation = useMutation({
    mutationFn: async (
      input:
        | { kind: "rename"; asset: MediaAssetListItem; name: string }
        | { kind: "favorite"; asset: MediaAssetListItem; folderId: string | null }
        | { kind: "unfavorite"; asset: MediaAssetListItem }
        | { kind: "delete"; asset: MediaAssetListItem }
    ) => {
      if (input.kind === "rename") {
        await apiClient.renameMediaAsset(input.asset.id, { name: input.name });
      } else if (input.kind === "favorite") {
        await apiClient.favoriteMediaAsset(input.asset.id, input.folderId);
      } else if (input.kind === "unfavorite") {
        await apiClient.unfavoriteMediaAsset(input.asset.id);
      } else {
        await apiClient.deleteMediaAsset(input.asset.id);
      }
      return input;
    },
    onSuccess: async (input) => {
      if (input.kind === "delete") {
        setNotice(`已从资产库删除「${input.asset.name}」，历史生成记录不受影响。`);
      } else if (input.kind === "rename") {
        setNotice(`已重命名为「${input.name}」。`);
      } else if (input.kind === "unfavorite") {
        setNotice(`已取消收藏「${input.asset.name}」。`);
      } else {
        setNotice(`已收藏「${input.asset.name}」。`);
      }
      setNameDialogTarget(null);
      setDeleteDialogTarget(null);
      setFolderChoiceTarget(null);
      await refreshLibrary();
    },
    onError: (error, input) => {
      if (input.kind === "unfavorite") setNotice(errorMessage(error, "取消收藏失败"));
    }
  });

  const folderMutation = useMutation({
    mutationFn: async (
      input:
        | { kind: "create"; name: string }
        | { kind: "rename"; folder: AssetFolder; name: string }
        | { kind: "delete"; folder: AssetFolder }
    ) => {
      if (input.kind === "create") return apiClient.createAssetFolder({ name: input.name });
      if (input.kind === "rename") {
        return apiClient.renameAssetFolder(input.folder.id, { name: input.name });
      }
      await apiClient.deleteAssetFolder(input.folder.id);
      return input.folder;
    },
    onSuccess: async (_, input) => {
      if (input.kind === "delete" && folderId === input.folder.id) setFolderId(null);
      setNotice(
        input.kind === "create"
          ? `已新建文件夹「${input.name}」。`
          : input.kind === "rename"
            ? `已重命名为「${input.name}」。`
            : `已删除文件夹「${input.folder.name}」，其中素材已移至默认文件夹。`
      );
      setNameDialogTarget(null);
      setDeleteDialogTarget(null);
      await refreshLibrary();
    },
    onError: () => undefined
  });

  useEffect(() => {
    if (!pagination) return;
    const lastPage = Math.max(1, pagination.totalPages);
    if (page > lastPage) setPage(lastPage);
  }, [page, pagination]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setKeyword(searchInput.trim());
    setPage(1);
  };

  const updateUploadItem = (update: AssetUploadUpdate<MediaAssetResponse>) => {
    setUploadItems((current) =>
      current.map((item) =>
        item.id !== update.id
          ? item
          : update.status === "failed"
            ? { ...item, status: update.status, error: uploadErrorMessage(update.error) }
            : { id: item.id, file: item.file, status: update.status }
      )
    );
  };

  const uploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length === 0 || !activeProjectQuery.data) return;

    const items = files.map<UploadItem>((file) => {
      try {
        validateAssetUploadFile(file);
        return { id: crypto.randomUUID(), file, status: "queued" };
      } catch (error) {
        return {
          id: crypto.randomUUID(),
          file,
          status: "failed",
          error: uploadErrorMessage(error)
        };
      }
    });
    setUploadItems(items);
    setUploadDialogOpen(true);
    await runAssetUploadQueue({
      tasks: items
        .filter((item) => item.status === "queued")
        .map((item) => ({ id: item.id, file: item.file })),
      upload: (file) => apiClient.uploadImage(activeProjectQuery.data.id, file),
      onUpdate: updateUploadItem
    });
    await refreshLibrary();
  };

  const changeScope = (nextScope: AssetScope) => {
    setScope(nextScope);
    setFolderId(null);
    setPage(1);
    setKeyword("");
    setSearchInput("");
    setSource("all");
    setDateRange(null);
  };

  const openNameDialog = (target: NameDialogTarget) => {
    assetMutation.reset();
    folderMutation.reset();
    setNameDialogTarget(target);
  };

  const openDeleteDialog = (target: DeleteDialogTarget) => {
    assetMutation.reset();
    folderMutation.reset();
    setDeleteDialogTarget(target);
  };

  const openFolderChoiceDialog = (asset: MediaAssetListItem, selectedId: string) => {
    assetMutation.reset();
    setFolderChoiceId(selectedId);
    setFolderChoiceTarget(asset);
  };

  const toggleFavorite = (asset: MediaAssetListItem) => {
    if (asset.favorite) {
      assetMutation.reset();
      assetMutation.mutate({ kind: "unfavorite", asset });
      return;
    }
    openFolderChoiceDialog(asset, "default");
  };

  const operationPending = assetMutation.isPending || folderMutation.isPending;

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>资产库</h1>
          <p>统一管理 AI 生成与本地上传素材，支持搜索、筛选与快速复用。</p>
        </div>
        <div className={styles.uploadArea}>
          {scope === "favorites" && folderId === null ? (
            <Button type="button" onClick={() => openNameDialog({ kind: "create-folder" })}>
              <FolderPlus />
              新建文件夹
            </Button>
          ) : scope === "all" ? (
            <>
              <input
                ref={uploadInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={uploadFiles}
                aria-label="选择上传图片"
              />
              <Button
                type="button"
                onClick={() => uploadInputRef.current?.click()}
                disabled={
                  activeProjectQuery.isPending || activeProjectQuery.isError || uploadInProgress
                }
              >
                <Upload />
                上传素材
              </Button>
            </>
          ) : null}
        </div>
      </header>

      <div className={styles.scopeTabs} role="tablist" aria-label="资产范围">
        <button
          type="button"
          role="tab"
          aria-selected={scope === "all"}
          onClick={() => changeScope("all")}
        >
          全部素材
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={scope === "favorites"}
          onClick={() => changeScope("favorites")}
        >
          我的收藏
        </button>
      </div>

      {scope === "favorites" && folderId && (
        <div className={styles.pathBar}>
          <button
            type="button"
            onClick={() => {
              setFolderId(null);
              setPage(1);
            }}
            aria-label="返回收藏文件夹"
          >
            <ArrowLeft />
          </button>
          <span>我的收藏</span>
          <span>/</span>
          <strong>{currentFolder?.name ?? "文件夹"}</strong>
        </div>
      )}

      <div className={styles.toolbar}>
        <div className={styles.filters}>
          <label>
            <span>类型</span>
            <select aria-label="素材类型" defaultValue="all" disabled={atFavoriteRoot}>
              <option value="all">全部类型</option>
              <option value="image">图片</option>
            </select>
          </label>
          <label>
            <span>来源</span>
            <select
              aria-label="素材来源"
              value={source}
              disabled={atFavoriteRoot}
              onChange={(event) => {
                setSource(event.target.value as AssetSourceFilter);
                setPage(1);
              }}
            >
              <option value="all">全部来源</option>
              <option value="generated">AI 生成</option>
              <option value="uploaded">本地上传</option>
            </select>
          </label>
          <label>
            <span>日期</span>
            <AssetDateRangePicker
              value={dateRange}
              disabled={atFavoriteRoot}
              filters={{
                keyword,
                scope,
                ...(folderId ? { folderId } : {}),
                source
              }}
              onApply={(range) => {
                setDateRange(range);
                setPage(1);
              }}
            />
          </label>
        </div>
        <form className={styles.searchForm} onSubmit={submitSearch}>
          <label>
            <Search />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={atFavoriteRoot ? "搜索文件夹名称" : "搜索素材名称、关键词"}
              aria-label={atFavoriteRoot ? "搜索文件夹名称" : "搜索素材名称"}
            />
          </label>
          <Button type="submit" variant="secondary">
            <Search />
            搜索
          </Button>
        </form>
      </div>

      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}

      {atFavoriteRoot ? (
        <>
          <div className={styles.summary} aria-live="polite">
            {foldersQuery.isPending ? "正在读取文件夹…" : `共 ${visibleFolders.length} 个文件夹`}
          </div>
          <FavoriteFolderGrid
            folders={visibleFolders}
            loading={foldersQuery.isPending}
            error={
              foldersQuery.isError ? errorMessage(foldersQuery.error, "收藏文件夹读取失败") : ""
            }
            onOpen={(folder) => {
              setFolderId(folder.id);
              setPage(1);
            }}
            onRename={(folder) => openNameDialog({ kind: "rename-folder", folder })}
            onDelete={(folder) => openDeleteDialog({ kind: "folder", folder })}
          />
        </>
      ) : (
        <>
          <div className={styles.summary} aria-live="polite">
            {pagination ? `共 ${pagination.total} 个素材` : "正在读取素材…"}
          </div>
          <AssetGrid
            query={assetsQuery}
            operationPending={operationPending}
            showMove={scope === "favorites"}
            onPreview={setPreviewAsset}
            onToggleFavorite={toggleFavorite}
            onRename={(asset) => openNameDialog({ kind: "rename-asset", asset })}
            onMove={(asset) => openFolderChoiceDialog(asset, asset.folderId ?? "default")}
            onDelete={(asset) => openDeleteDialog({ kind: "asset", asset })}
          />
          {pagination && pagination.totalPages > 0 && (
            <nav className={styles.pagination} aria-label="资产分页">
              <div>
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  aria-label="上一页"
                >
                  <ChevronLeft />
                </Button>
                <span>
                  第 {pagination.page} / {pagination.totalPages} 页
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  disabled={page >= pagination.totalPages}
                  onClick={() => setPage((value) => value + 1)}
                  aria-label="下一页"
                >
                  <ChevronRight />
                </Button>
              </div>
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
                aria-label="每页显示数量"
              >
                <option value="10">10 条/页</option>
                <option value="20">20 条/页</option>
                <option value="50">50 条/页</option>
              </select>
            </nav>
          )}
        </>
      )}

      <AssetPreviewDialog
        asset={previewAsset}
        onOpenChange={(open) => !open && setPreviewAsset(null)}
      />
      <UploadProgressDialog
        items={uploadItems}
        open={uploadDialogOpen}
        uploadInProgress={uploadInProgress}
        onOpenChange={setUploadDialogOpen}
      />
      <NameDialog
        target={nameDialogTarget}
        pending={operationPending}
        error={
          nameDialogTarget?.kind === "rename-asset"
            ? mutationErrorMessage(assetMutation.error, "素材重命名失败")
            : mutationErrorMessage(folderMutation.error, "文件夹操作失败")
        }
        onOpenChange={(open) => !open && setNameDialogTarget(null)}
        onSubmit={(name) => {
          if (!nameDialogTarget) return;
          if (nameDialogTarget.kind === "create-folder")
            folderMutation.mutate({ kind: "create", name });
          else if (nameDialogTarget.kind === "rename-folder")
            folderMutation.mutate({ kind: "rename", folder: nameDialogTarget.folder, name });
          else assetMutation.mutate({ kind: "rename", asset: nameDialogTarget.asset, name });
        }}
      />
      <DeleteDialog
        target={deleteDialogTarget}
        pending={operationPending}
        error={
          deleteDialogTarget?.kind === "asset"
            ? mutationErrorMessage(assetMutation.error, "素材删除失败")
            : mutationErrorMessage(folderMutation.error, "文件夹删除失败")
        }
        onOpenChange={(open) => !open && setDeleteDialogTarget(null)}
        onConfirm={() => {
          if (deleteDialogTarget?.kind === "folder")
            folderMutation.mutate({ kind: "delete", folder: deleteDialogTarget.folder });
          else if (deleteDialogTarget?.kind === "asset")
            assetMutation.mutate({ kind: "delete", asset: deleteDialogTarget.asset });
        }}
      />
      <FolderChoiceDialog
        asset={folderChoiceTarget}
        folders={foldersQuery.data?.items ?? []}
        selectedId={folderChoiceId}
        pending={assetMutation.isPending}
        error={mutationErrorMessage(assetMutation.error, "收藏素材操作失败")}
        onSelectedIdChange={setFolderChoiceId}
        onOpenChange={(open) => !open && setFolderChoiceTarget(null)}
        onConfirm={() =>
          folderChoiceTarget &&
          assetMutation.mutate({
            kind: "favorite",
            asset: folderChoiceTarget,
            folderId: folderChoiceId === "default" ? null : folderChoiceId
          })
        }
      />
    </section>
  );
}

function AssetGrid({
  query,
  operationPending,
  showMove,
  onPreview,
  onToggleFavorite,
  onRename,
  onMove,
  onDelete
}: Readonly<{
  query: ReturnType<
    typeof useQuery<{
      items: MediaAssetListItem[];
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
    }>
  >;
  operationPending: boolean;
  showMove: boolean;
  onPreview: (asset: MediaAssetListItem) => void;
  onToggleFavorite: (asset: MediaAssetListItem) => void;
  onRename: (asset: MediaAssetListItem) => void;
  onMove: (asset: MediaAssetListItem) => void;
  onDelete: (asset: MediaAssetListItem) => void;
}>) {
  if (query.isError) {
    return (
      <EmptyState title="资产读取失败" description={errorMessage(query.error, "请稍后重试")} />
    );
  }
  if (query.isPending) {
    return (
      <div className={styles.grid} aria-label="正在加载素材">
        {Array.from({ length: 10 }, (_, index) => (
          <div className={styles.skeleton} key={index} />
        ))}
      </div>
    );
  }
  if (query.data.items.length === 0) {
    return <EmptyState title="没有找到符合条件的素材" description="请调整关键词、来源或文件夹。" />;
  }
  return (
    <div className={styles.grid}>
      {query.data.items.map((asset) => (
        <AssetCard
          asset={asset}
          key={asset.id}
          onPreview={onPreview}
          onToggleFavorite={onToggleFavorite}
          onRename={onRename}
          {...(showMove ? { onMove } : {})}
          onDelete={onDelete}
          busy={operationPending}
        />
      ))}
    </div>
  );
}

function FavoriteFolderGrid({
  folders,
  loading,
  error,
  onOpen,
  onRename,
  onDelete
}: Readonly<{
  folders: AssetFolder[];
  loading: boolean;
  error: string;
  onOpen: (folder: AssetFolder) => void;
  onRename: (folder: AssetFolder) => void;
  onDelete: (folder: AssetFolder) => void;
}>) {
  if (loading)
    return (
      <div className={styles.folderGrid}>
        {Array.from({ length: 4 }, (_, index) => (
          <div className={styles.folderSkeleton} key={index} />
        ))}
      </div>
    );
  if (error) return <EmptyState title="收藏文件夹读取失败" description={error} />;
  if (folders.length === 0)
    return <EmptyState title="没有找到收藏文件夹" description="新建文件夹后可分类整理收藏素材。" />;
  return (
    <div className={styles.folderGrid}>
      {folders.map((folder) => (
        <FolderCard
          key={folder.id}
          folder={folder}
          onOpen={onOpen}
          onRename={onRename}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function FolderCard({
  folder,
  onOpen,
  onRename,
  onDelete
}: Readonly<{
  folder: AssetFolder;
  onOpen: (folder: AssetFolder) => void;
  onRename: (folder: AssetFolder) => void;
  onDelete: (folder: AssetFolder) => void;
}>) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <article className={styles.folderCard}>
      <button className={styles.folderMain} type="button" onClick={() => onOpen(folder)}>
        <Folder />
        <span>
          <strong>{folder.name}</strong>
          <small>{folder.assetCount} 个素材</small>
        </span>
      </button>
      {!folder.system && (
        <>
          <button
            className={styles.folderMore}
            type="button"
            aria-label={`${folder.name} 更多操作`}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Ellipsis />
          </button>
          {menuOpen && (
            <div className={styles.folderMenu} role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onRename(folder);
                }}
              >
                <Pencil />
                重命名
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete(folder);
                }}
              >
                <Trash2 />
                删除
              </button>
            </div>
          )}
        </>
      )}
    </article>
  );
}

function EmptyState({ title, description }: Readonly<{ title: string; description: string }>) {
  return (
    <div className={styles.emptyState}>
      <Images />
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function AssetPreviewDialog({
  asset,
  onOpenChange
}: Readonly<{ asset: MediaAssetListItem | null; onOpenChange: (open: boolean) => void }>) {
  return (
    <Dialog.Root open={Boolean(asset)} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={styles.previewDialog}>
          <Dialog.Title className={styles.visuallyHidden}>{asset?.name ?? "图片预览"}</Dialog.Title>
          <Dialog.Close className={styles.dialogClose} aria-label="关闭图片预览">
            <X />
          </Dialog.Close>
          {asset && (
            <Image
              src={apiClient.mediaContentUrl(asset.id)}
              alt={asset.name}
              width={1800}
              height={1800}
              unoptimized
              loading="eager"
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function NameDialog({
  target,
  pending,
  error,
  onOpenChange,
  onSubmit
}: Readonly<{
  target: NameDialogTarget | null;
  pending: boolean;
  error: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => void;
}>) {
  const initialName =
    target?.kind === "rename-folder"
      ? target.folder.name
      : target?.kind === "rename-asset"
        ? target.asset.name
        : "";
  const title =
    target?.kind === "create-folder"
      ? "新建收藏文件夹"
      : target?.kind === "rename-folder"
        ? "重命名文件夹"
        : "重命名素材";
  return (
    <Dialog.Root open={Boolean(target)} onOpenChange={(open) => !pending && onOpenChange(open)}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={styles.formDialog} key={`${target?.kind}-${initialName}`}>
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>
            {target?.kind === "rename-asset"
              ? "仅修改资产库显示名称，不影响原文件和历史记录。"
              : "收藏文件夹为单层结构，名称不能重复。"}
          </Dialog.Description>
          {error && (
            <p className={styles.dialogError} role="alert">
              {error}
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const rawName = data.get("name");
              const name = typeof rawName === "string" ? rawName.trim() : "";
              if (name) onSubmit(name);
            }}
          >
            <label>
              <span>名称</span>
              <input
                name="name"
                defaultValue={initialName}
                maxLength={target?.kind === "rename-asset" ? 200 : 40}
                autoFocus
                required
              />
            </label>
            <div className={styles.dialogFooter}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                取消
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <LoaderCircle className={styles.spinning} /> : null}确认
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DeleteDialog({
  target,
  pending,
  error,
  onOpenChange,
  onConfirm
}: Readonly<{
  target: DeleteDialogTarget | null;
  pending: boolean;
  error: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}>) {
  const isFolder = target?.kind === "folder";
  const name = target?.kind === "folder" ? target.folder.name : target?.asset.name;
  return (
    <Dialog.Root open={Boolean(target)} onOpenChange={(open) => !pending && onOpenChange(open)}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={styles.formDialog}>
          <Dialog.Title>{isFolder ? "删除收藏文件夹" : "删除素材"}</Dialog.Title>
          <Dialog.Description>
            {isFolder
              ? `删除「${name}」后，其中素材仍保持收藏并回到默认文件夹。`
              : `「${name}」将从资产库隐藏，历史生成记录和质检血缘不会删除。`}
          </Dialog.Description>
          {error && (
            <p className={styles.dialogError} role="alert">
              {error}
            </p>
          )}
          <div className={styles.dialogFooter}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              取消
            </Button>
            <Button type="button" variant="danger" onClick={onConfirm} disabled={pending}>
              {pending ? <LoaderCircle className={styles.spinning} /> : <Trash2 />}确认删除
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FolderChoiceDialog({
  asset,
  folders,
  selectedId,
  pending,
  error,
  onSelectedIdChange,
  onOpenChange,
  onConfirm
}: Readonly<{
  asset: MediaAssetListItem | null;
  folders: AssetFolder[];
  selectedId: string;
  pending: boolean;
  error: string;
  onSelectedIdChange: (id: string) => void;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}>) {
  return (
    <Dialog.Root open={Boolean(asset)} onOpenChange={(open) => !pending && onOpenChange(open)}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={styles.formDialog}>
          <Dialog.Title>{asset?.favorite ? "移动收藏素材" : "收藏素材"}</Dialog.Title>
          <Dialog.Description>选择一个收藏文件夹，后续可继续移动。</Dialog.Description>
          {error && (
            <p className={styles.dialogError} role="alert">
              {error}
            </p>
          )}
          <div className={styles.folderChoices}>
            {folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                data-selected={folder.id === selectedId || undefined}
                onClick={() => onSelectedIdChange(folder.id)}
              >
                <Folder />
                <span>
                  <strong>{folder.name}</strong>
                  <small>{folder.assetCount} 个素材</small>
                </span>
              </button>
            ))}
          </div>
          <div className={styles.dialogFooter}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              取消
            </Button>
            <Button type="button" onClick={onConfirm} disabled={pending || folders.length === 0}>
              {pending ? <LoaderCircle className={styles.spinning} /> : null}确认
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function UploadProgressDialog({
  items,
  open,
  uploadInProgress,
  onOpenChange
}: Readonly<{
  items: UploadItem[];
  open: boolean;
  uploadInProgress: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const successCount = items.filter((item) => item.status === "succeeded").length;
  const failedCount = items.filter((item) => item.status === "failed").length;
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => !uploadInProgress && onOpenChange(nextOpen)}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={styles.uploadDialog}>
          <Dialog.Title>上传素材</Dialog.Title>
          <Dialog.Description>
            {uploadInProgress
              ? `正在处理 ${items.length} 个文件，请勿关闭页面。`
              : `上传完成：${successCount} 个成功，${failedCount} 个失败。`}
          </Dialog.Description>
          <div className={styles.uploadList}>
            {items.map((item) => (
              <div className={styles.uploadItem} key={item.id} data-status={item.status}>
                {item.status === "succeeded" ? (
                  <CheckCircle2 />
                ) : item.status === "failed" ? (
                  <CircleAlert />
                ) : (
                  <LoaderCircle
                    className={item.status === "uploading" ? styles.spinning : undefined}
                  />
                )}
                <div>
                  <strong title={item.file.name}>{item.file.name}</strong>
                  <span>{uploadStatusText(item)}</span>
                  {item.error && <small>{item.error}</small>}
                </div>
              </div>
            ))}
          </div>
          <div className={styles.dialogFooter}>
            <Button
              type="button"
              variant="secondary"
              disabled={uploadInProgress}
              onClick={() => onOpenChange(false)}
            >
              完成
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function uploadStatusText(item: UploadItem) {
  if (item.status === "queued") return "等待上传";
  if (item.status === "uploading") return "上传中";
  if (item.status === "succeeded") return "上传成功";
  return "上传失败";
}

function uploadErrorMessage(error: unknown) {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return "上传失败，请稍后重试";
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return fallback;
}

function mutationErrorMessage(error: unknown, fallback: string) {
  return error ? errorMessage(error, fallback) : "";
}
