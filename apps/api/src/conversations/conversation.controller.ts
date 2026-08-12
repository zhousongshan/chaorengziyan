import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query
} from "@nestjs/common";

import { ConversationService } from "./conversation.service.js";

@Controller("conversations")
export class ConversationController {
  public constructor(private readonly conversations: ConversationService) {}

  @Put("current")
  public ensureCurrent(@Body() body: unknown) {
    return this.conversations.create(body);
  }

  @Get("current")
  public current(@Query() query: unknown) {
    return this.conversations.current(query);
  }

  @Get(":id")
  public getHistory(@Param("id", new ParseUUIDPipe()) id: string, @Query() query: unknown) {
    return this.conversations.getHistory(id, query);
  }

  @Get(":id/messages")
  public getMessages(@Param("id", new ParseUUIDPipe()) id: string, @Query() query: unknown) {
    return this.conversations.getMessages(id, query);
  }

  @Post(":id/messages")
  @HttpCode(HttpStatus.ACCEPTED)
  public sendMessage(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query() query: unknown,
    @Body() body: unknown
  ) {
    return this.conversations.sendMessage(id, query, body);
  }

  @Post(":id/messages/:messageId/retry")
  @HttpCode(HttpStatus.ACCEPTED)
  public retryMessage(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("messageId", new ParseUUIDPipe()) messageId: string,
    @Query() query: unknown
  ) {
    return this.conversations.retryMessage(id, messageId, query);
  }
}
