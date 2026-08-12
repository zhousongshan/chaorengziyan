import { describe, expect, it } from "vitest";

import { parseExplicitOutputQuantity } from "../src/requirements/output-quantity.parser.js";

describe("parseExplicitOutputQuantity", () => {
  it.each([
    ["生成1张图", 1],
    ["给我4张图片", 4],
    ["需要5张", 5],
    ["输出10个版本", 10],
    ["制作100个结果", 100],
    ["总共6张图片", 6],
    ["生成４张图片", 4],
    ["需要１２个方案", 12],
    ["生成一张图", 1],
    ["给我两张图片", 2],
    ["输出十个版本", 10],
    ["制作十二个方案", 12],
    ["需要一百个结果", 100]
  ])("recognizes an explicit output count in %s", (text, expected) => {
    expect(parseExplicitOutputQuantity(text, 0)).toMatchObject({
      status: "exact",
      value: expected
    });
  });

  it("returns the exact source quote and character range", () => {
    const text = "请生成１２张图片，保持主体一致";
    const result = parseExplicitOutputQuantity(text, 0);

    expect(result).toMatchObject({ status: "exact", value: 12 });
    if (result.status !== "exact") return;
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.quote).toBe("生成１２张图片");
    expect(text.slice(result.matches[0]?.start, result.matches[0]?.end)).toBe(
      result.matches[0]?.quote
    );
  });

  it.each([
    ["每个商品各生成2张图片", 2, 4],
    ["每张商品图分别出两张图", 2, 4],
    ["每一张原图优化成3个版本", 1, 3],
    ["每个商品生成1张主图和1张详情图", 2, 4]
  ])("multiplies per-product count in %s", (text, sourceImageCount, expected) => {
    expect(parseExplicitOutputQuantity(text, sourceImageCount)).toMatchObject({
      status: "exact",
      value: expected
    });
  });

  it.each([
    ["生成2张主图和2张详情图", 4],
    ["需要1张白底图、2张场景图和1张海报", 4],
    ["输出2张主图、2张详情图、1张卖点图", 5]
  ])("sums explicit itemized deliverables in %s", (text, expected) => {
    expect(parseExplicitOutputQuantity(text, 0)).toMatchObject({
      status: "exact",
      value: expected
    });
  });

  it("does not conflict when itemized and total quantities agree", () => {
    expect(parseExplicitOutputQuantity("生成2张主图和2张详情图，一共4张", 0)).toMatchObject({
      status: "exact",
      value: 4
    });
  });

  it.each([
    ["不要4张了，改成2张", 2],
    ["不是4张，是2张", 2],
    ["原来要3张，现在只要1张", 1],
    ["之前生成2张主图和2张详情图，最终要1张主图和1张详情图", 2]
  ])("uses the final affirmed quantity in %s", (text, expected) => {
    expect(parseExplicitOutputQuantity(text, 0)).toMatchObject({
      status: "exact",
      value: expected
    });
  });

  it("returns a conflict for different affirmed totals", () => {
    expect(parseExplicitOutputQuantity("生成2张图片，再输出4张图片", 0)).toMatchObject({
      status: "conflict",
      values: [2, 4]
    });
  });

  it.each([
    "大概生成3张图",
    "生成2到4张图",
    "生成2张或3张图",
    "生成至少3张图",
    "生成3张以上",
    "生成两三张图",
    "生成3张左右",
    "比例使用9:16",
    "使用2026年的设计趋势",
    "商品型号是4X-Pro",
    "生成几张图都可以"
  ])("does not treat fuzzy or unrelated numbers as explicit output count: %s", (text) => {
    expect(parseExplicitOutputQuantity(text, 0)).toEqual({ status: "none", matches: [] });
  });
});
