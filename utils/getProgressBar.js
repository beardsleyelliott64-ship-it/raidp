const { emojis = {} } = require('../config.json');

// One shared 10-cell renderer. Configure the nine exact Discord emoji IDs in
// config.json under the bar_* keys; Unicode is used safely until IDs are set.
function getProgressBar(value, total) {
    const safeTotal = Math.max(1, Number(total) || 1);
    const ratio = Math.max(0, Math.min(1, (Number(value) || 0) / safeTotal));
    let halfUnits = Math.round(ratio * 20); // 0..20 half-cell units
    if (ratio > 0 && halfUnits === 0) halfUnits = 1;
    if (ratio < 1 && halfUnits === 20) halfUnits = 19;

    const fallback = {
        bar_left_empty: '▱', bar_left_half: '◧', bar_left_full: '▰',
        bar_empty: '▱', bar_half: '◧', bar_fill: '▰',
        bar_right_empty: '▱', bar_right_half: '◧', bar_right_full: '▰'
    };
    const configKeys = {
        bar_left_empty: 'login_bar_left_empty', bar_left_half: 'login_bar_left_half', bar_left_full: 'login_bar_left_full',
        bar_empty: 'login_bar_empty', bar_half: 'login_bar_half', bar_fill: 'login_bar_fill',
        bar_right_empty: 'login_bar_right_empty', bar_right_half: 'login_bar_right_half', bar_right_full: 'login_bar_right_full'
    };
    const token = (name) => {
        const id = String(emojis[configKeys[name]] || emojis[name] || '').trim();
        return id ? `<:${name}:${id}>` : fallback[name];
    };

    const cells = [];
    for (let index = 0; index < 10; index++) {
        const units = Math.max(0, Math.min(2, halfUnits - index * 2));
        const state = units === 2 ? 'full' : units === 1 ? 'half' : 'empty';
        const name = index === 0
            ? `bar_left_${state}`
            : index === 9
                ? `bar_right_${state}`
                : state === 'full' ? 'bar_fill' : state === 'half' ? 'bar_half' : 'bar_empty';
        cells.push(token(name));
    }
    return cells.join('');
}

module.exports = getProgressBar;
