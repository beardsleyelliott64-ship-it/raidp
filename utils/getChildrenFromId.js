function getChildrenFromId(text) {
  return [...text.matchAll(/\(([^)]+)\)/g)].map(m => m[1]);
}

module.exports = getChildrenFromId;