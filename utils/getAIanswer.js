async function getAIanswer(
    actionFn,
    queue,
    interaction,
    progressUpdater,
    maxWaitMs = 60000,
    checkIntervalMs = 3000,
    cancelFlag = () => false,
    maxAttempts = 1
) {
    let attempts = 0;
    let result;

    do {
        attempts++;
        result = await actionFn();

        if (typeof result !== 'number') {
            return result;
        }

        if (attempts >= maxAttempts) {
            break;
        }

        await progressUpdater.updateEmbed(
            `The AI model returned an error code (${result}). Waiting before retrying (Attempt ${attempts + 1}/${maxAttempts})...`
        );

        let elapsed = 0;
        while (
            elapsed < maxWaitMs &&
            !cancelFlag() &&
            (await queue.stillUsing(interaction.user.id))
        ) {
            const timeLeft = maxWaitMs - elapsed;
            const wait = Math.min(checkIntervalMs, timeLeft);
            await new Promise(res => setTimeout(res, wait));
            elapsed += wait;
        }

        if (cancelFlag() || !(await queue.stillUsing(interaction.user.id))) {
            return 'break';
        }

    } while (attempts < maxAttempts);

    return { status: "Failed due to Invalid AI Response" };
}

module.exports = getAIanswer;