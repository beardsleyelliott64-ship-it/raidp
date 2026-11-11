const { emojis = {} } = require('../config.json');

// Ten-segment bar using the nine exact named Discord emojis loaded by
// readerBookmarkletFlow.loadLoginBarEmojis(). A Unicode fallback keeps every
// renderer usable when the bot cannot access the emoji server.
function getProgressBar(value, total) {
    const safeTotal = Math.max(1, Number(total) || 1);
    const ratio = Math.max(0, Math.min(1, (Number(value) || 0) / safeTotal));
    const percent = ratio * 100;
    const units = percent / 10;
    const full = Math.floor(units);
    const half = units - full >= 0.5;

    const names = {
        leftFull: ['bar_left_full', emojis.login_bar_left_full],
        leftHalf: ['bar_left_half', emojis.login_bar_left_half],
        leftEmpty: ['bar_left_empty', emojis.login_bar_left_empty],
        fill: ['bar_fill', emojis.login_bar_fill],
        middleHalf: ['bar_half', emojis.login_bar_half],
        empty: ['bar_empty', emojis.login_bar_empty],
        rightFull: ['bar_right_full', emojis.login_bar_right_full],
        rightHalf: ['bar_right_half', emojis.login_bar_right_half],
        rightEmpty: ['bar_right_empty', emojis.login_bar_right_empty]
    };
    const emoji = ([name, id]) => /^\d{10,}$/.test(String(id || '')) ? `<:${name}:${id}>` : null;
    const pieces = [];

    pieces.push(emoji(full > 0 ? names.leftFull : half ? names.leftHalf : names.leftEmpty));
    for (let i = 1; i <= 8; i++) {
        if (i < full) pieces.push(emoji(names.fill));
        else if (i === full && half) pieces.push(emoji(names.middleHalf));
        else pieces.push(emoji(names.empty));
    }
    if (full >= 10) pieces.push(emoji(names.rightFull));
    else if (full === 9 && half) pieces.push(emoji(names.rightHalf));
    else pieces.push(emoji(names.rightEmpty));

    if (pieces.every(Boolean)) return pieces.join('');
    const filled = Math.round(ratio * 10);
    return '▰'.repeat(filled) + '▱'.repeat(10 - filled);
}

module.exports = getProgressBar;
