/** Paired comments are opaque while locating randomizer delimiters. */
function commentEnd(text: string, start: number): number | undefined {
  if (!text.startsWith('##', start)) return;
  const close = text.indexOf('##', start + 2);
  return close < 0 ? undefined : close + 2;
}

export interface PromptRandomizer {
  start: number;
  end: number;
  options: string[];
}

/** Read one complete NAI randomizer; standalone pipes remain ordinary text. */
export function readPromptRandomizer(text: string, start: number): PromptRandomizer | undefined {
  if (!text.startsWith('||', start)) return;
  const options: string[] = [];
  let optionStart = start + 2;
  let braces = 0;
  for (let index = optionStart; index < text.length; index++) {
    const end = commentEnd(text, index);
    if (end !== undefined) { index = end - 1; continue; }
    if (text[index] === '{') braces++;
    else if (text[index] === '}') braces = Math.max(0, braces - 1);
    if (braces) continue;
    if (text.startsWith('||', index)) {
      options.push(text.slice(optionStart, index));
      return { start, end: index + 2, options };
    }
    if (text[index] === '|') {
      options.push(text.slice(optionStart, index));
      optionStart = index + 1;
    }
  }
}

export function promptRandomizerRanges(text: string): PromptRandomizer[] {
  const ranges: PromptRandomizer[] = [];
  for (let index = 0; index < text.length; index++) {
    const end = commentEnd(text, index);
    if (end !== undefined) { index = end - 1; continue; }
    const range = readPromptRandomizer(text, index);
    if (range) { ranges.push(range); index = range.end - 1; }
  }
  return ranges;
}

/** A fully commented candidate is disabled; explicit empty/comma candidates remain valid. */
export function activeRandomizerOptions(range: PromptRandomizer): string[] {
  return range.options.filter(option => !/##[\s\S]*?##/.test(option) ||
    option.replace(/##[\s\S]*?##/g, '').trim() !== '');
}

/** Split multi-line pieces only outside paired comments; retain the source for nested choices. */
export function splitPromptPieceLines(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const end = commentEnd(text, index);
    if (end !== undefined) { index = end - 1; continue; }
    if (text[index] !== '\r' && text[index] !== '\n') continue;
    lines.push(text.slice(start, index));
    if (text[index] === '\r' && text[index + 1] === '\n') index++;
    start = index + 1;
  }
  lines.push(text.slice(start));
  return lines;
}

/** Keep whole randomizers, including their comments and commas, until an image is generated. */
export function splitPromptTags(text: string): string[] {
  const parts: string[] = [];
  let part = '';
  const push = () => { if (part.trim()) parts.push(part.trim()); part = ''; };
  for (let index = 0; index < text.length; index++) {
    const end = commentEnd(text, index);
    if (end !== undefined) { index = end - 1; continue; }
    const range = readPromptRandomizer(text, index);
    if (range) { part += text.slice(index, range.end); index = range.end - 1; continue; }
    if (text[index] === ',' || text[index] === '\r' || text[index] === '\n') push();
    else part += text[index];
  }
  push();
  return parts;
}

/** Resolve NAI sections and existing brace alternatives without rewriting the source. */
export function expandPromptAlternatives(text: string, random: () => number = Math.random): string {
  const choose = (options: string[]) => options[Math.min(options.length - 1, Math.floor(random() * options.length))];
  const expand = (value: string, depth = 0): string => {
    if (depth > 64) return value;
    let result = '';
    for (let index = 0; index < value.length; index++) {
      const end = commentEnd(value, index);
      if (end !== undefined) { index = end - 1; continue; }
      const range = readPromptRandomizer(value, index);
      if (range) {
        const options = activeRandomizerOptions(range);
        if (options.length) result += expand(choose(options), depth + 1);
        index = range.end - 1;
        continue;
      }
      if (value[index] !== '{') { result += value[index]; continue; }
      let braces = 1;
      let close = -1;
      const separators: number[] = [];
      for (let cursor = index + 1; cursor < value.length; cursor++) {
        const comment = commentEnd(value, cursor);
        if (comment !== undefined) { cursor = comment - 1; continue; }
        const nested = readPromptRandomizer(value, cursor);
        if (nested) { cursor = nested.end - 1; continue; }
        if (value[cursor] === '{') braces++;
        else if (value[cursor] === '}' && --braces === 0) { close = cursor; break; }
        else if (value[cursor] === '|' && braces === 1) separators.push(cursor);
      }
      if (close < 0) { result += value.slice(index); break; }
      if (!separators.length) result += '{' + expand(value.slice(index + 1, close), depth + 1) + '}';
      else {
        const cuts = [index, ...separators, close];
        const options = cuts.slice(0, -1).map((start, i) => value.slice(start + 1, cuts[i + 1]));
        result += expand(choose(options).trim(), depth + 1);
      }
      index = close;
    }
    return result;
  };
  return expand(text);
}
