async function makeGroupArray(items, entryFn=(async () => {}), groupSize=5) {
    const sectionsProgress = [];
    let currentGroup = [];
    for (const task of items) {
        const progressEntry = await entryFn(task);
        // Push into current group
        currentGroup.push(progressEntry);

        // If group reaches groupSize, push it to the main array and start new group
        if (currentGroup.length === groupSize) {
            sectionsProgress.push(currentGroup);
            currentGroup = [];
        }
    }

    if (currentGroup.length > 0) {
        sectionsProgress.push(currentGroup);
    }

    return sectionsProgress;
}

module.exports = makeGroupArray;