const axios = require('axios');

// --- 1. Text Normalization ---
const diacriticsRegex = /[\u0300-\u036f]/g;
const lWithStrokeRegex = /ł/g;
const nWithTildeRegex = /ñ/g;

function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(diacriticsRegex, '')
    .replace(lWithStrokeRegex, 'l')
    .replace(nWithTildeRegex, 'n')
    .trim();
}

// --- 2. Word Boundary & Scoring Utils ---
const wordBoundaries = new Set(" \xA0[]()-–—'\"“”".split(''));

function isWordBoundary(char) {
  return wordBoundaries.has(char);
}

function calculateScore(ranges, text) {
  let score = 2;
  ranges.forEach((range) => {
    let start = range[0];
    let end = range[1];
    let len = end - start + 1;

    let startBoundary = start === 0 || text[start] === ' ' || text[start - 1] === ' ';
    let endBoundary = end === text.length - 1 || text[end] === ' ' || text[end + 1] === ' ';

    if (startBoundary && endBoundary) {
      score += 0.2;
    } else if (startBoundary) {
      score += 0.4;
    } else if (len >= 3) {
      score += 0.8;
    } else {
      score += 1.6;
    }
  });
  return [score, ranges];
}

// --- 3. Fuzzy Matchers ---
function aggressiveFuzzyMatch(textNorm, queryNorm) {
  let tLen = textNorm.length;
  let qLen = queryNorm.length;
  let qIdx = 0;
  let qChar = queryNorm[qIdx];
  let ranges = [];
  let start = -1;
  let prev = -2;

  for (let tIdx = 0; tIdx < tLen; tIdx += 1) {
    if (textNorm[tIdx] === qChar) {
      if (tIdx !== prev + 1) {
        if (start >= 0) ranges.push([start, prev]);
        start = tIdx;
      }
      prev = tIdx;
      qIdx += 1;

      if (qIdx === qLen) {
        ranges.push([start, prev]);
        return calculateScore(ranges, textNorm);
      }
      qChar = queryNorm[qIdx];
    }
  }
  return null;
}

function smartFuzzyMatch(textNorm, queryNorm) {
  let tLen = textNorm.length;
  let ranges = [];
  let qIdx = 0;
  let qChar = queryNorm[qIdx];
  let start = -1;
  let prev = -2;

  while (true) {
    let matchIdx = textNorm.indexOf(qChar, prev + 1);
    if (matchIdx === -1) break;

    if (matchIdx === 0 || isWordBoundary(textNorm[matchIdx - 1])) {
      start = matchIdx;
    } else {
      let remQuery = queryNorm.length - qIdx;
      let remText = textNorm.length - matchIdx;
      let chunkLen = Math.min(3, remQuery, remText);
      let queryChunk = queryNorm.slice(qIdx, qIdx + chunkLen);

      if (textNorm.slice(matchIdx, matchIdx + chunkLen) === queryChunk) {
        start = matchIdx;
      } else {
        prev = matchIdx; 
        continue;
      }
    }

    for (prev = start; prev < tLen && textNorm[prev] === qChar; prev += 1) {
      qIdx += 1;
      qChar = queryNorm[qIdx];
    }
    prev -= 1;
    ranges.push([start, prev]);

    if (qIdx === queryNorm.length) {
      return calculateScore(ranges, textNorm);
    }
  }
  return null;
}

function matchCore(itemRaw, itemNorm, itemWordsSet, queryRaw, queryNorm, queryWordsArr, strategy) {
  if (itemRaw === queryRaw) return [0, [[0, queryRaw.length - 1]]];

  let qRawLen = queryRaw.length;
  let iNormLen = itemNorm.length;
  let qNormLen = queryNorm.length;

  if (itemNorm === queryNorm) return [0.1, [[0, iNormLen - 1]]];
  if (itemNorm.startsWith(queryNorm)) return [0.5, [[0, qNormLen - 1]]];

  let exactRawIdx = itemRaw.indexOf(queryRaw);
  if (exactRawIdx > -1 && isWordBoundary(itemRaw[exactRawIdx - 1])) {
    return [0.9, [[exactRawIdx, exactRawIdx + qRawLen - 1]]];
  }

  let exactNormIdx = itemNorm.indexOf(queryNorm);
  if (exactNormIdx > -1 && isWordBoundary(itemNorm[exactNormIdx - 1])) {
    return [1, [[exactNormIdx, exactNormIdx + qRawLen - 1]]];
  }

  let qWordsLen = queryWordsArr.length;
  if (qWordsLen > 1 && queryWordsArr.every((w) => itemWordsSet.has(w))) {
    return [
      1.5 + qWordsLen * 0.2,
      queryWordsArr.map((w) => {
        let idx = itemNorm.indexOf(w);
        return [idx, idx + w.length - 1];
      }).sort((a, b) => a[0] - b[0])
    ];
  }

  if (exactNormIdx > -1) {
    return [2, [[exactNormIdx, exactNormIdx + qRawLen - 1]]];
  }

  // Original minified code delegates here: o === "aggressive" ? l() : u()
  if (strategy === 'aggressive') return aggressiveFuzzyMatch(itemNorm, queryNorm);
  if (strategy === 'smart') return smartFuzzyMatch(itemNorm, queryNorm);

  return null;
}

// --- 4. The Main Creator Function ---
function createFuzzySearch(list, options) {
  // If the strategy is undefined (which it is via the app's hook), default to "aggressive"
  let strategy = options.strategy === undefined ? 'aggressive' : options.strategy;
  let getText = options.getText;
  let key = options.key;

  let mappedList = list.map((item) => {
    let textsToSearch = getText ? getText(item) : [key ? item[key] : item];
    let processedTexts = textsToSearch.map((t) => {
      let str = t || '';
      let norm = normalizeText(str);
      return [str, norm, new Set(norm.split(' '))];
    });
    return [item, processedTexts];
  });

  return function search(queryRaw) {
    let results = [];
    let queryNorm = normalizeText(queryRaw);
    let queryWordsArr = queryNorm.split(' ');

    if (!queryNorm.length) return [];

    mappedList.forEach((mapped) => {
      let item = mapped[0];
      let texts = mapped[1];
      let bestScore = Number.MAX_SAFE_INTEGER;
      let allMatches = [];

      for (let i = 0; i < texts.length; i += 1) {
        let t = texts[i];
        let itemRaw = t[0];
        let itemNorm = t[1];
        let itemWordsSet = t[2];

        let match = matchCore(itemRaw, itemNorm, itemWordsSet, queryRaw, queryNorm, queryWordsArr, strategy);

        if (match) {
          bestScore = Math.min(bestScore, match[0]);
          allMatches.push(match[1]); // App only cares about mapping the first text match
        } else {
          allMatches.push(null);
        }
      }

      if (bestScore < Number.MAX_SAFE_INTEGER) {
        results.push({
          item: item,
          score: bestScore,
          matches: allMatches
        });
      }
    });

    results.sort((a, b) => a.score - b.score);
    return results;
  };
}

// Exact reproduction of the text concatenator without altering strings (so boundary index logic matches)
function Vt(e) { return e.n || ''; }
function Ut(e) { return e.a || ''; }
function Ht(e) { return e.t || ''; }

const getText = (e) => [Vt(e) + Ut(e) + Ht(e)];
const mapResultItem = ({ item, matches: [t] }) => ({ item: item, highlightRanges: t });

// --- 5. Application Execution logic ---
async function searchSchool(queryText) {
  const res = await axios.get('https://static.sparx-learning.com/sl/spx001/data.txt');
  const schools = JSON.parse(Buffer.from(res.data, 'base64').toString('utf-8'));

  const searchImpl = createFuzzySearch(schools, {
    getText: getText
  });

  let results = searchImpl(queryText).map(mapResultItem);

  // console.log(`\nFound ${results.length} matches for "${queryText}". Showing top names:\n`);
  
  // Output solely the name to the console
  /*
  results.slice(0, 10).forEach((res) => {
    console.log(res.item.n);
  });
  */
  return results[0]?.item;
}

module.exports = searchSchool;