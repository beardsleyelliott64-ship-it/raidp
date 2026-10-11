function getKnownFile(platform, filename) {
    if (platform.includes('_')) {
        const platSplit = platform.split('_');
        const data = require(`../autocompleters/${platSplit[0]}/children/${platSplit[1]}/${filename}`);
        return data;
    }
    const data = require(`../autocompleters/${platform}/${filename}`);
    return data;
}

module.exports = getKnownFile;