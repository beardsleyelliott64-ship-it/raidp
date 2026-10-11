const fs = require('fs');
const path = require('path');

const autocompletersPath = path.join(__dirname, '../autocompleters');

let AUTOCOMPLETER_NAMES = [];

try {
    const items = fs.readdirSync(autocompletersPath, { withFileTypes: true });

    for (const item of items) {
        if (!item.isDirectory()) continue;

        const dirName = item.name;
        const childrenPath = path.join(autocompletersPath, dirName, 'children');

        try {
            const childItems = fs.readdirSync(childrenPath, { withFileTypes: true });

            let hasChildDirs = false;

            for (const child of childItems) {
                if (child.isDirectory()) {
                    AUTOCOMPLETER_NAMES.push(`${dirName}_${child.name}`);
                    hasChildDirs = true;
                }
            }

            if (!hasChildDirs) {
                AUTOCOMPLETER_NAMES.push(dirName);
            }

        } catch {
            AUTOCOMPLETER_NAMES.push(dirName);
        }
    }
} catch (error) {
    console.error("Error reading autocompleters directory:", error);
}

module.exports = AUTOCOMPLETER_NAMES;