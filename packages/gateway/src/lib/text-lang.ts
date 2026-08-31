/**
 * Which language a piece of text is written in.
 *
 * Deliberately coarse — three buckets, decided by script rather than by any
 * model. What the retriever needs to know is whether a query and a document sit
 * on opposite sides of a language boundary, and script alone answers that for
 * the languages this product ships in. Anything finer would be a dependency and
 * a latency budget for a question that does not need them.
 *
 * Measured against this repository's own docs, which is a fair sample of what
 * people upload: the eight Chinese design documents run 6%-22% Han by
 * character (technical prose is full of code, identifiers and English terms),
 * while the English one is 0.01%. The threshold sits well inside that gap.
 */

export type TextLang = 'zh' | 'ja' | 'en';

/**
 * Share of Han characters above which text counts as Chinese.
 *
 * Low on purpose. The failure that matters is calling a Chinese document
 * English — that document then becomes unreachable from Chinese questions,
 * which is the whole defect being fixed. Calling an English document Chinese
 * because it quotes a sentence of it is the cheaper mistake, and 2% is still
 * three times more Han than the English document in the sample has.
 */
const HAN_THRESHOLD = 0.02;

/**
 * Any kana at all makes text Japanese.
 *
 * Japanese cannot be written without kana, and neither Chinese nor English
 * contains it, so presence is a sharper signal here than any ratio. A stray
 * borrowed word is the only false positive available, hence a small floor
 * rather than zero.
 */
const KANA_THRESHOLD = 0.01;

const HAN = /\p{Script=Han}/gu;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu;

function shareOf(text: string, pattern: RegExp): number {
  if (text.length === 0) return 0;
  // `matchAll` needs the /g flag and a fresh lastIndex; the regexes above are
  // module-level, so counting via match() rather than exec() avoids carrying
  // state between calls.
  return (text.match(pattern)?.length ?? 0) / text.length;
}

/**
 * Detect the dominant language.
 *
 * English is the fallback rather than a detected result: it is the language
 * with no distinguishing script, so "not Chinese and not Japanese" is as
 * precise as script analysis can be, and calling that `en` is honest for a
 * three-language product.
 */
export function detectLang(text: string): TextLang {
  if (shareOf(text, KANA) >= KANA_THRESHOLD) return 'ja';
  if (shareOf(text, HAN) >= HAN_THRESHOLD) return 'zh';
  return 'en';
}
