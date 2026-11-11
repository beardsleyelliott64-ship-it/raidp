const { emojis = {} } = require('../config.json');

const NAMED = {
    leftFull: ['login_bar_left_full', 'bar_left_full'],
    leftHalf: ['login_bar_left_half', 'bar_left_half'],
    leftEmpty: ['login_bar_left_empty', 'bar_left_empty'],
    fill: ['login_bar_fill', 'bar_fill'],
    half: ['login_bar_half', 'bar_half'],
    empty: ['login_bar_empty', 'bar_empty'],
    rightFull: ['login_bar_right_full', 'bar_right_full'],
    rightHalf: ['login_bar_right_half', 'bar_right_half'],
    rightEmpty: ['login_bar_right_empty', 'bar_right_empty']
};

function customEmoji(keys) {
    for (const key of keys) {
        const id = String(emojis[key] || '').match(/^\d{10,}$/)?.[0];
        if (id) {
            const names = {
                login_bar_left_full: 'bar_left_full',
                login_bar_left_half: 'bar_left_half',
                login_bar_left_empty: 'bar_left_empty',
                login_bar_fill: 'bar_fill',
                login_bar_half: 'bar_half',
                login_bar_empty: 'bar_empty',
                login_bar_right_full: 'bar_right_full',
                login_bar_right_half: 'bar_right_half',
                login_bar_right_empty: 'bar_right_empty'
            };
            return `<:${names[key] || key}:${id}>`;
        }
    }
    return null;
}

function getProgressBar(value, total) {
    const denominator = Number(total);
    const numerator = Number(value);
    const ratio = Number.isFinite(denominator) && denominator > 0 && Number.isFinite(numerator)
        ? Math.max(0, Math.min(1, numerator / denominator))
        : 0;
    const units = ratio * 10;
    const full = Math.floor(units + 1e-9);
    const half = units - full >= 0.5 - 1e-9;

    const custom = {
        leftFull: customEmoji(NAMED.leftFull),
        leftHalf: customEmoji(NAMED.leftHalf),
        leftEmpty: customEmoji(NAMED.leftEmpty),
        fill: customEmoji(NAMED.fill),
        half: customEmoji(NAMED.half),
        empty: customEmoji(NAMED.empty),
        rightFull: customEmoji(NAMED.rightFull),
        rightHalf: customEmoji(NAMED.rightHalf),
        rightEmpty: customEmoji(NAMED.rightEmpty)
    };

    // Only use the named custom set when all nine emojis have been resolved.
    if (Object.values(custom).every(Boolean)) {
        const parts = [];
        parts.push(units >= 1 ? custom.leftFull : (half ? custom.leftHalf : custom.leftEmpty));
        for (let segment = 1; segment <= 8; segment++) {
            if (units >= segment + 1) parts.push(custom.fill);
            else if (units >= segment + 0.5) parts.push(custom.half);
            else parts.push(custom.empty);
        }
        parts.push(units >= 10 ? custom.rightFull : (units >= 9.5 ? custom.rightHalf : custom.rightEmpty));
        return parts.join('');
    }

    // Guaranteed visible fallback while Discord emoji permissions/cache load.
    const filled = Math.round(ratio * 10);
    return '▰'.repeat(filled) + '▱'.repeat(10 - filled);
}

module.exports = getProgressBar;
