const fs = require('fs').promises; // Use the Promise-based fs API
const path = require('path');

/**
 * Searches for a file within a specific platform folder under 'autocompleters'.
 * 
 * @param {string} platform - The name of the platform folder (e.g., 'maths', 'sparx').
 * @param {string} filename - The name of the file (e.g., 'settings.js').
 * @returns {Promise<string|null>} - A Promise resolving to the absolute path to the file, or null if not found.
 */
async function getFile(platform, filename) {
    // __dirname is the 'utils' folder. 
    // '..' goes up one level to root folder, then into 'autocompleters'
    const baseDir = path.join(__dirname, '..', 'autocompleters');

    // Helper function to recursively search directories
    async function searchDirectory(currentDir) {
        let entries;
        
        try {
            // Read directory contents. 'withFileTypes: true' returns Dirent objects,
            // which saves us from having to do a separate 'fs.stat' call for every file.
            entries = await fs.readdir(currentDir, { withFileTypes: true });
        } catch {
            // This effectively replaces !fs.existsSync(currentDir).
            // If the directory doesn't exist or we lack permissions, it throws an error.
            return null;
        }

        for (const entry of entries) {
            const filePath = path.join(currentDir, entry.name);

            if (entry.isDirectory()) {
                // If it's a folder, await the recursive search
                const result = await searchDirectory(filePath);
                if (result) return result; 
            } else if (entry.name === filename) {
                // If the file matches, check if its directory path includes the platform
                const pathParts = currentDir.split(path.sep);
                if (pathParts.includes(platform)) {
                    return filePath;
                }
            }
        }
        
        return null; // Return null if nothing is found in this directory path
    }

    return searchDirectory(baseDir);
}

module.exports = getFile;