/**
 * 画数データ解析スクリプト
 * 使い方: node parse-strokes.js strokes-raw.txt > stroke-data-new.js
 * または: node parse-strokes.js < strokes-raw.txt > stroke-data-new.js
 *
 * 入力形式: "一画" の次行から次の "X画" までがその画数の文字一覧（スペース・改行は無視）
 */
const fs = require("fs");
const path = require("path");

const kanjiNum = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10 };

function parseStrokeHeader(line) {
  const t = line.trim();
  const m = t.match(/^(.+?)画$/);
  if (!m) return null;
  const s = m[1].trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (s === "十") return 10;
  if (s.length === 1) return kanjiNum[s] ?? null;
  if (s === "十一") return 11;
  if (s === "十二") return 12;
  if (s === "十三") return 13;
  if (s === "十四") return 14;
  if (s === "十五") return 15;
  if (s === "十六") return 16;
  if (s === "十七") return 17;
  if (s === "十八") return 18;
  if (s === "十九") return 19;
  if (s === "二十") return 20;
  if (s === "二十一") return 21;
  if (s === "二十二") return 22;
  if (s === "二十三") return 23;
  if (s === "二十四") return 24;
  if (s === "二十五") return 25;
  if (s === "二十六") return 26;
  if (s === "二十七") return 27;
  if (s === "二十八") return 28;
  if (s === "二十九") return 29;
  if (s === "三十") return 30;
  if (s === "三十一") return 31;
  if (s === "三十二") return 32;
  if (s === "三十三") return 33;
  if (s === "三十四") return 34;
  if (s === "三十五") return 35;
  if (s === "三十六") return 36;
  if (s === "三十八") return 38;
  if (s === "三十九") return 39;
  if (s === "四十") return 40;
  if (s === "四十二") return 42;
  if (s === "四十四") return 44;
  if (s === "四十七") return 47;
  if (s === "四十八") return 48;
  if (s === "四十九") return 49;
  if (s === "五十二") return 52;
  if (s === "五十三") return 53;
  if (s === "六十四") return 64;
  return null;
}

function main() {
  let input;
  const arg = process.argv[2];
  if (arg) {
    try {
      input = fs.readFileSync(path.resolve(arg), "utf8");
    } catch (e) {
      console.error("Cannot read file:", arg, e.message);
      process.exit(1);
    }
  } else {
    input = fs.readFileSync(0, "utf8");
  }

  const lines = input.split(/\r?\n/);
  const map = {};
  let currentStroke = 0;

  for (const line of lines) {
    const stroke = parseStrokeHeader(line);
    if (stroke != null) {
      currentStroke = stroke;
      continue;
    }
    for (const ch of line) {
      if (ch === " " || ch === "\t" || ch === "\r") continue;
      map[ch] = currentStroke;
    }
  }

  const header = `/**
 * 漢字の画数データ（parse-strokes.js で生成）
 * 一画〜多画まで、入力フォームの画数表示に使用します。
 */
export const STROKE_COUNT = {
`;
  const footer = `
};
`;

  const entries = Object.entries(map)
    .sort((a, b) => {
      const c = a[0].codePointAt(0) - b[0].codePointAt(0);
      return c !== 0 ? c : 0;
    })
    .map(([char, count]) => `  "${char}": ${count}`)
    .join(",\n");

  const out = header + entries + footer;
  const outPath = process.argv[3] || null;
  if (outPath) {
    fs.writeFileSync(path.resolve(outPath), out, "utf8");
  } else {
    process.stdout.write(out);
  }
}

main();
