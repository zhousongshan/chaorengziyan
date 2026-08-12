const chineseDigits = new Map([
  ["零", 0],
  ["〇", 0],
  ["一", 1],
  ["二", 2],
  ["两", 2],
  ["三", 3],
  ["四", 4],
  ["五", 5],
  ["六", 6],
  ["七", 7],
  ["八", 8],
  ["九", 9]
]);

const chineseUnits = new Map([
  ["十", 10],
  ["百", 100],
  ["千", 1_000],
  ["万", 10_000]
]);

const quantityToken = "[0-9０-９]+|[零〇一二两三四五六七八九十百千万]+";
const outputUnit =
  "(?:张(?:图(?:片)?)?|个(?:不同(?:风格)?的?|独立的?)?(?:方案|版本|结果|候选(?:图|方案)?))";
const itemizedOutputCategory =
  "(?:(?:商品)?主图|详情图|场景图|白底图|海报(?:图)?|宣传图|素材图|展示图|氛围图|尺寸图|卖点图|封面图)";

export interface ExplicitOutputQuantityMatch {
  value: number;
  quote: string;
  start: number;
  end: number;
}

export type ExplicitOutputQuantity =
  | { status: "none"; matches: [] }
  | { status: "exact"; value: number; matches: ExplicitOutputQuantityMatch[] }
  | { status: "conflict"; values: number[]; matches: ExplicitOutputQuantityMatch[] };

export function parseExplicitOutputQuantity(
  text: string,
  sourceImageCount: number
): ExplicitOutputQuantity {
  const itemizedMatches = collectItemizedMatches(text, sourceImageCount).filter(
    (match) => !isFuzzyQuantity(text, match) && !isNegatedQuantity(text, match)
  );
  const itemizedRanges = itemizedMatches.map((match) => [match.start, match.end] as const);
  const perSourceMatches = collectMatches(
    text,
    new RegExp(
      `每(?:一)?(?:张(?:原图|商品图|图片|图)|个商品)(?:分别|各)?(?:生成|输出|产出|优化成|得到|制作|做|出)?\\s*(${quantityToken})\\s*${outputUnit}`,
      "g"
    ),
    (count) => (sourceImageCount > 0 ? safeMultiply(count, sourceImageCount) : undefined)
  ).filter(
    (match) =>
      !isFuzzyQuantity(text, match) &&
      !isNegatedQuantity(text, match) &&
      !overlapsAnyRange(match, itemizedRanges)
  );
  const perSourceRanges = perSourceMatches.map((match) => [match.start, match.end] as const);
  const totalMatches = collectMatches(
    text,
    new RegExp(
      `(?:现在(?:只)?要|这次(?:只)?要|最终(?:只)?要|最后(?:只)?要|实际(?:只)?要|改成|改为|调整为|调整成|换成|换为|只要|而是|生成(?:的)?|输出|产出|制作|做|给我|需要|一共|总共|共计|合计|要|是|商品主图(?:是|为)?|结果(?:是|为)?)[^，。；\\n]{0,12}?(${quantityToken})\\s*${outputUnit}`,
      "g"
    ),
    (count) => count
  ).filter((match) => {
    if (isFuzzyQuantity(text, match) || isNegatedQuantity(text, match)) return false;
    return !overlapsAnyRange(match, [...itemizedRanges, ...perSourceRanges]);
  });
  let matches = [...itemizedMatches, ...perSourceMatches, ...totalMatches].sort(
    (left, right) => left.start - right.start
  );
  const correctionStart = findLastCorrectionStart(text);
  if (correctionStart !== undefined) {
    const correctedMatches = matches.filter((match) => match.start >= correctionStart);
    if (correctedMatches.length > 0) matches = correctedMatches;
  }
  if (matches.length === 0) return { status: "none", matches: [] };

  const values = [...new Set(matches.map((match) => match.value))];
  return values.length === 1
    ? { status: "exact", value: values[0]!, matches }
    : { status: "conflict", values, matches };
}

function collectItemizedMatches(
  text: string,
  sourceImageCount: number
): ExplicitOutputQuantityMatch[] {
  const parts = collectMatches(
    text,
    new RegExp(`(${quantityToken})\\s*张\\s*${itemizedOutputCategory}`, "g"),
    (count) => count
  );
  const groups: ExplicitOutputQuantityMatch[][] = [];
  let current: ExplicitOutputQuantityMatch[] = [];
  for (const part of parts) {
    const previous = current.at(-1);
    const connector = previous ? text.slice(previous.end, part.start) : "";
    if (previous && /^\s*(?:和|及|与|以及|、|，|,|\+|加上?)\s*$/.test(connector)) {
      current.push(part);
      continue;
    }
    if (current.length >= 2) groups.push(current);
    current = [part];
  }
  if (current.length >= 2) groups.push(current);

  return groups.flatMap((group) => {
    const first = group[0]!;
    const last = group.at(-1)!;
    const perSource = isPerSourceItemizedGroup(text, first.start);
    if (perSource && sourceImageCount < 1) return [];
    const sum = group.reduce((total, part) => safeAdd(total, part.value), 0);
    const value = perSource ? safeMultiply(sum, sourceImageCount) : sum;
    return [
      {
        value,
        quote: text.slice(first.start, last.end),
        start: first.start,
        end: last.end
      }
    ];
  });
}

function isPerSourceItemizedGroup(text: string, start: number): boolean {
  const clauseStart = Math.max(
    text.lastIndexOf("，", start - 1),
    text.lastIndexOf(",", start - 1),
    text.lastIndexOf("。", start - 1),
    text.lastIndexOf("；", start - 1),
    text.lastIndexOf("\n", start - 1)
  );
  return /每(?:一)?(?:张(?:原图|商品图|图片|图)|个商品)(?:分别|各)?(?:生成|输出|产出|优化成|得到|制作|做|出)?\s*$/.test(
    text.slice(clauseStart + 1, start)
  );
}

function overlapsAnyRange(
  match: ExplicitOutputQuantityMatch,
  ranges: ReadonlyArray<readonly [number, number]>
): boolean {
  return ranges.some(([start, end]) => match.start < end && match.end > start);
}

function findLastCorrectionStart(text: string): number | undefined {
  const pattern =
    /现在(?:只)?要|这次(?:只)?要|最终(?:只)?要|最后(?:只)?要|实际(?:只)?要|改成|改为|调整为|调整成|换成|换为|只要|而是/g;
  let lastIndex: number | undefined;
  for (const match of text.matchAll(pattern)) {
    if (match.index !== undefined) lastIndex = match.index;
  }
  return lastIndex;
}

function isNegatedQuantity(text: string, match: ExplicitOutputQuantityMatch): boolean {
  const token = new RegExp(quantityToken).exec(match.quote);
  if (!token || token.index === undefined) return false;
  const quantityStart = match.start + token.index;
  const prefix = text.slice(Math.max(0, quantityStart - 8), quantityStart);
  return /(?:不要|别要|不是|并非|无需|取消(?:生成|输出)?|不(?:生成|输出))\s*$/.test(prefix);
}

function isFuzzyQuantity(text: string, match: ExplicitOutputQuantityMatch): boolean {
  const context = text.slice(Math.max(0, match.start - 4), Math.min(text.length, match.end + 4));
  return (
    /大概|大约|约莫|差不多|左右|至少|最多|不超过|不少于|以上|以内|(?:或|或者)/.test(context) ||
    /(?:[0-9０-９]+|[零〇一二两三四五六七八九十百千万]+)\s*(?:到|至|[-~～—])\s*(?:[0-9０-９]+|[零〇一二两三四五六七八九十百千万]+)/.test(
      context
    ) ||
    /[一二两三四五六七八九]{2,}\s*(?:张|个)/.test(context)
  );
}

function collectMatches(
  text: string,
  pattern: RegExp,
  resolveValue: (count: number) => number | undefined
): ExplicitOutputQuantityMatch[] {
  const matches: ExplicitOutputQuantityMatch[] = [];
  for (const match of text.matchAll(pattern)) {
    const count = parseCount(match[1]);
    const value = count === undefined ? undefined : resolveValue(count);
    if (value === undefined || match.index === undefined || !Number.isSafeInteger(value)) continue;
    matches.push({
      value,
      quote: match[0],
      start: match.index,
      end: match.index + match[0].length
    });
  }
  return matches;
}

function parseCount(value: string | undefined): number | undefined {
  if (!value) return undefined;
  if (/^[0-9０-９]+$/.test(value)) {
    const normalized = value.replace(/[０-９]/g, (character) =>
      String(character.charCodeAt(0) - "０".charCodeAt(0))
    );
    const parsed = Number(normalized);
    return Number.isSafeInteger(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
  }
  return parseChineseInteger(value);
}

function safeAdd(left: number, right: number): number {
  const value = left + right;
  return Number.isSafeInteger(value) ? value : Number.MAX_SAFE_INTEGER;
}

function safeMultiply(left: number, right: number): number {
  const value = left * right;
  return Number.isSafeInteger(value) ? value : Number.MAX_SAFE_INTEGER;
}

function parseChineseInteger(value: string): number | undefined {
  const hasUnit = [...value].some((character) => chineseUnits.has(character));
  if (!hasUnit) {
    const digits = [...value].map((character) => chineseDigits.get(character));
    if (digits.some((digit) => digit === undefined)) return undefined;
    const parsed = Number(digits.join(""));
    return Number.isSafeInteger(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
  }

  let total = 0;
  let section = 0;
  let digit = 0;
  for (const character of value) {
    const numeric = chineseDigits.get(character);
    if (numeric !== undefined) {
      digit = numeric;
      continue;
    }
    const unit = chineseUnits.get(character);
    if (!unit) return undefined;
    if (unit === 10_000) {
      total += (section + digit) * unit;
      section = 0;
      digit = 0;
      continue;
    }
    section += (digit || 1) * unit;
    digit = 0;
  }
  const parsed = total + section + digit;
  return Number.isSafeInteger(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}
