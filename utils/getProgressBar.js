const { emojis = {} } = require('../config.json');

// Churro/Zenith-style 10-segment bar. External Discord custom emojis only
// render when those emoji IDs are available to the bot. The Unicode fallback
// keeps the bar visible everywhere instead of leaking :emoji: text.
function getProgressBar(value, total) {
    const safeTotal = Math.max(1, Number(total) || 1);
    const ratio = Math.max(0, Math.min(1, (Number(value) || 0) / safeTotal));
    const filled = Math.round(ratio * 10);

    const custom = [
        emojis.left_full || '<:leftfull:1554159485914714133>',
        emojis.mid_full || '<:midfull:1554159505284010097>',
        emojis.right_full || '<:rightfull:1554159510942257162>',
        emojis.left_empty || '<:leftempty:1554159480307064972>',
        emojis.mid_empty || '<:mid:1554159499869421690>',
        emojis.right_empty || '<:rightempty:1554159510942257162>'
    ];

    // Only opt into the external custom emoji IDs when explicitly enabled.
    // By default use a guaranteed-rendering Unicode bar.
    if (process.env.EAM_USE_CHURRO_EMOJIS === 'true' || process.env.EAM_USE_CHURRO_EMOJIS === '1') {
        const [leftFull, midFull, rightFull, leftEmpty, midEmpty, rightEmpty] = custom;
        let bar = '';
        for (let i = 0; i < 10; i++) {
            if (i === 0) bar += filled > 0 ? leftFull : leftEmpty;
            else if (i === 9) bar += filled >= 10 ? rightFull : rightEmpty;
            else bar += i < filled ? midFull : midEmpty;
        }
        return bar;
    }

    return '▰'.repeat(filled) + '▱'.repeat(10 - filled);
}

module.exports = getProgressBar;
