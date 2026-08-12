import { Module } from "@nestjs/common";

import { ProductEntityService } from "./product-entity.service.js";

@Module({
  providers: [ProductEntityService],
  exports: [ProductEntityService]
})
export class ProductEntityModule {}
