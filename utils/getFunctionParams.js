// Helper function to extract parameters
function getFunctionParams(func) {
    // 1. Convert the function to a string
    let str = func.toString();

    // 2. Remove comments (multi-line and single-line) to prevent false matches
    str = str.replace(/\/\*[\s\S]*?\*\//g, '')
             .replace(/\/\/.*$/gm, '');

    // 3. Find the text inside the first set of parentheses
    const match = str.match(/^[^(]*\(([^)]*)\)/);
    
    if (!match) return [];

    let paramsRaw = match[1];

    // 4. Handle Object Destructuring
    // Remove default empty object assignments (e.g., ` = {}`)
    paramsRaw = paramsRaw.replace(/\s*=\s*\{\s*\}/g, '');
    
    // Remove the curly braces used for destructuring
    paramsRaw = paramsRaw.replace(/[{}]/g, '');

    // 5. Extract the parameter string, split by commas, and clean up
    return paramsRaw
        .split(',')
        .map(param => {
            let cleaned = param.trim();
            
            // Remove default values (e.g., `username = 'guest'` -> `username`)
            cleaned = cleaned.split('=')[0]; 
            
            // Handle aliases to get the actual expected object key (e.g., `username: u` -> `username`)
            cleaned = cleaned.split(':')[0]; 
            
            return cleaned.trim();
        })
        .filter(param => param !== ''); // remove empty strings
}

module.exports = getFunctionParams;