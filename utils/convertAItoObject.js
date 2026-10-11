const LEGACY_MODEL_MAP = {
    '2.5-flash': '3.8-flash',
    '2.5-pro': '3.8-pro',
    '1.5-flash': '3.8-flash',
    '1.5-pro': '3.8-pro',
    'gemini-2.5-flash': '3.8-flash',
    'gemini-2.5-pro': '3.8-pro',
};

function mapModel(name) {
    if (!name) return '';
    const trimmed = String(name).trim();
    if (LEGACY_MODEL_MAP[trimmed]) return LEGACY_MODEL_MAP[trimmed];
    return trimmed.replace(/^gemini-/, '');
}

function convertAItoObject(str) {
    if (str === 'No Models' || !str) {
        return { 0: '', 1: '', 2: '' };
    }

    const parts = String(str).split(' -> ').map(mapModel);

    return {
        0: parts[0] ?? '',
        1: parts[1] ?? '',
        2: parts[2] ?? '',
    };
}

module.exports = convertAItoObject;
