function formatSubject(str) {
  return str
    .split('_') // split into words
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' '); // join with spaces
}

module.exports = formatSubject;