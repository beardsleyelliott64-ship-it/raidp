function seperateParentChild(str) {
  const open = str.indexOf("(");
  const close = str.indexOf(")");

  // No parentheses at all
  if (open === -1 || close === -1 || close < open) {
    return {
      parent: str,
      child: null,
    };
  }

  return {
    parent: str.slice(0, open),
    child: str.slice(open + 1, close) || null,
  };
}

module.exports = seperateParentChild;