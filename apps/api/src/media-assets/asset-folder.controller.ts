import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post
} from "@nestjs/common";

import { MediaAssetService } from "./media-asset.service.js";

@Controller("asset-folders")
export class AssetFolderController {
  public constructor(private readonly mediaAssets: MediaAssetService) {}

  @Get()
  public list() {
    return this.mediaAssets.listFolders();
  }

  @Post()
  @HttpCode(201)
  public create(@Body() body: unknown) {
    return this.mediaAssets.createFolder(body);
  }

  @Patch(":id")
  public rename(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.mediaAssets.renameFolder(id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  public delete(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.mediaAssets.deleteFolder(id);
  }
}
