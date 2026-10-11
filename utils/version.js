const { execSync } = require('child_process');

let commitHash = 'unknown';
let commitMessage = 'unknown';

try {
    commitHash = execSync('git rev-parse --short HEAD').toString().trim();
    commitMessage = execSync('git log -1 --pretty=%s').toString().trim();
} catch (err) {
    // Git not available or not a repo, keep defaults
}

module.exports = {
    commitHash,
    commitMessage
};