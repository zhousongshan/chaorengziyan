import { afterEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "./client";

describe("apiClient JSON headers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not declare JSON for bodyless POST requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "00000000-0000-4000-8000-000000000101",
          name: "复制 Agent",
          description: "",
          agentInstruction: "",
          type: "image",
          mode: "intelligent",
          origin: "custom",
          createdAt: "2026-08-10T00:00:00.000Z",
          updatedAt: "2026-08-10T00:00:00.000Z"
        }),
        { status: 201, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiClient.copyAgent("00000000-0000-4000-8000-000000000100");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/agents/00000000-0000-4000-8000-000000000100/copies"),
      expect.objectContaining({ method: "POST", headers: {} })
    );
  });

  it("keeps the JSON header when a request has a body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "00000000-0000-4000-8000-000000000101",
          name: "新 Agent",
          description: "",
          agentInstruction: "",
          type: "image",
          mode: "intelligent",
          origin: "custom",
          createdAt: "2026-08-10T00:00:00.000Z",
          updatedAt: "2026-08-10T00:00:00.000Z"
        }),
        { status: 201, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiClient.createAgent({
      name: "新 Agent",
      description: "",
      agentInstruction: "",
      type: "image"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/agents"),
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" }
      })
    );
  });

  it("ensures the current project with a bodyless idempotent PUT", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "00000000-0000-4000-8000-000000000201",
          name: "默认电商创作项目",
          description: "由电商创作平台首次使用时自动创建",
          createdAt: "2026-08-11T00:00:00.000Z",
          updatedAt: "2026-08-11T00:00:00.000Z"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiClient.ensureCurrentProject();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/projects/current"),
      expect.objectContaining({ method: "PUT", headers: {} })
    );
  });

  it("passes asset scope, folder and project filters without broadening the picker query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [],
          pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiClient.getMediaAssets({
      keyword: "白底",
      scope: "favorites",
      folderId: "default",
      projectId: "00000000-0000-4000-8000-000000000012",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-10",
      source: "generated",
      sort: "newest",
      page: 1,
      pageSize: 10
    });

    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl).toContain("scope=favorites");
    expect(requestUrl).toContain("folderId=default");
    expect(requestUrl).toContain("projectId=00000000-0000-4000-8000-000000000012");
    expect(requestUrl).toContain("dateFrom=2026-08-01");
    expect(requestUrl).toContain("dateTo=2026-08-10");
    expect(requestUrl).toContain("source=generated");
  });

  it("passes calendar month and active asset filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          month: "2026-08",
          days: [{ date: "2026-08-10", count: 2 }],
          minDate: "2026-07-20",
          maxDate: "2026-08-10"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiClient.getMediaAssetCalendar({
      month: "2026-08",
      keyword: "主图",
      scope: "favorites",
      folderId: "default",
      source: "uploaded"
    });

    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl).toContain("/media-assets/calendar?");
    expect(requestUrl).toContain("month=2026-08");
    expect(requestUrl).toContain("keyword=%E4%B8%BB%E5%9B%BE");
    expect(requestUrl).toContain("scope=favorites");
    expect(requestUrl).toContain("folderId=default");
    expect(requestUrl).toContain("source=uploaded");
  });

  it("loads the one current conversation for an Agent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ session: null }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiClient.getCurrentConversation("00000000-0000-4000-8000-000000000100");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/conversations/current?agentId=00000000-0000-4000-8000-000000000100"
      ),
      expect.objectContaining({ method: "GET", headers: {} })
    );
  });

  it("ensures the current conversation with an idempotent PUT", async () => {
    const session = {
      id: "00000000-0000-4000-8000-000000000020",
      projectId: "00000000-0000-4000-8000-000000000030",
      agentId: "00000000-0000-4000-8000-000000000100",
      title: "当前会话",
      mode: "image",
      status: "active",
      version: 1,
      processingMessageId: null,
      createdAt: "2026-08-09T08:00:00.000Z",
      updatedAt: "2026-08-10T08:00:00.000Z"
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(session), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiClient.ensureCurrentConversation({
      projectId: session.projectId,
      agentId: session.agentId,
      title: session.title
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/conversations/current"),
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          projectId: session.projectId,
          agentId: session.agentId,
          title: session.title
        })
      })
    );
  });
});
