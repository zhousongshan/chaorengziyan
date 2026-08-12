import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile
} from "@nestjs/common";
import type { Multipart } from "@fastify/multipart";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { MediaAssetService } from "./media-asset.service.js";

const projectIdSchema = z.uuid();

type MultipartRequest = FastifyRequest & {
  isMultipart(): boolean;
  parts(): AsyncIterableIterator<Multipart>;
};

@Controller("media-assets")
export class MediaAssetController {
  public constructor(private readonly mediaAssets: MediaAssetService) {}

  @Get()
  public list(@Query() query: Record<string, unknown>) {
    return this.mediaAssets.list(query);
  }

  @Get("calendar")
  public calendar(@Query() query: Record<string, unknown>) {
    return this.mediaAssets.calendar(query);
  }

  @Post("images")
  @HttpCode(201)
  public async uploadImage(@Req() request: MultipartRequest) {
    if (!request.isMultipart()) {
      throw new BadRequestException({
        code: "MULTIPART_FORM_REQUIRED",
        message: "请使用 multipart/form-data 上传图片"
      });
    }

    let projectId: string | undefined;
    let uploadedFile: { originalFileName: string; mimeType: string; content: Buffer } | undefined;

    for await (const part of request.parts()) {
      if (part.type === "field") {
        if (part.fieldname === "projectId") projectId = String(part.value);
        continue;
      }
      if (uploadedFile) {
        part.file.resume();
        throw new BadRequestException({
          code: "TOO_MANY_IMAGE_FILES",
          message: "每次只能上传一张图片"
        });
      }
      uploadedFile = {
        originalFileName: part.filename,
        mimeType: part.mimetype,
        content: await part.toBuffer()
      };
    }

    const parsedProjectId = projectIdSchema.safeParse(projectId);
    if (!parsedProjectId.success || !uploadedFile) {
      throw new BadRequestException({
        code: "INVALID_IMAGE_UPLOAD",
        message: "必须提供有效的 projectId 和一张图片"
      });
    }

    return this.mediaAssets.uploadImage({
      projectId: parsedProjectId.data,
      ...uploadedFile
    });
  }

  @Get(":id/content")
  public async readImage(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: FastifyReply
  ) {
    const asset = await this.mediaAssets.getOwnedImage(id);
    response.header("content-type", asset.mimeType);
    response.header("content-length", String(asset.byteSize));
    response.header("cache-control", "private, max-age=3600");
    return new StreamableFile(await this.mediaAssets.read(asset));
  }

  @Patch(":id")
  @HttpCode(204)
  public rename(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.mediaAssets.rename(id, body);
  }

  @Put(":id/favorite")
  @HttpCode(204)
  public favorite(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.mediaAssets.favorite(id, body);
  }

  @Delete(":id/favorite")
  @HttpCode(204)
  public unfavorite(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.mediaAssets.unfavorite(id);
  }

  @Delete(":id")
  @HttpCode(204)
  public hide(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.mediaAssets.hide(id);
  }
}
