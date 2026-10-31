const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());
const config = require('./config.json');
const { emojis, colours } = require('./config.json');
const { MessageFlags, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const IMAGE_SOLVER_CHANNEL_ID = config.image_solver;
const puppetQueue = require('./queues/puppeteerQueue.js');

async function getAnswer(image) {
  let browser;
  let context;
  let page;

  let forceKillTimer;
  const answerData = {};

  try {
    // Force kill the browser after 30s. This immediately triggers the catch block below.
    forceKillTimer = setTimeout(async () => {
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    }, 30000);

    browser = await chromium.launch({
      headless: true,
      args: [
        '--start-maximized',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--ignore-certificate-errors',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--ignore-certificate-errors-spki-list'
      ]
    });

    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.3537.71',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
    ];

    const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

    context = await browser.newContext({
      userAgent: randomUserAgent,
      ignoreHTTPSErrors: true
    });
    page = await context.newPage();

    // Set a default timeout for the page so NO action hangs for more than 20 seconds
    page.setDefaultTimeout(20000); 

    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      window.chrome = { runtime: {} };

      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters)
      );

      Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    });

    await page.goto('https://www.gauthmath.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });

    const [response] = await Promise.all([
        page.waitForResponse(async (res) => {
            if (!res.url().includes('/solution_detail/get')) {
                return false;
            }

            try {
                const data = await res.json();

                return Boolean(
                    data?.WebSolution?.ContentInfo?.Answer
                );
            } catch {
                return false;
            }
        }),

        page.locator('input[type="file"]').setInputFiles({
            name: 'image.png',
            mimeType: 'image/png',
            buffer: image,
        }),
    ]);

    const data = await response.json();

    answerData.answer = data.WebSolution.ContentInfo.Answer;
    answerData.explanation = data.WebSolution.ContentInfo.Explanation;
    answerData.url = data.WebSolution.Meta.CanonicalUrl;
  } catch (err) {
    console.error('Error for Gauth Maths', err);
  } finally {
    clearTimeout(forceKillTimer); // Clear it so it doesn't trigger if finished early
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  return answerData;
}

async function imageSolver(image, message) {
    const seperator = new SeparatorBuilder({
        spacing: SeparatorSpacingSize.Small
    });
    const title = `Gauth Maths`;
    let message_sent;
    try {

    const waitingSection = new TextDisplayBuilder().setContent(`## ${title}\nWaiting for <t:${Math.floor(Date.now() / 1000)}:R>`);

    const waitingContainer = new ContainerBuilder()
        .setAccentColor(0x3574cf)
        .addTextDisplayComponents(
            waitingSection
        );

    message_sent = await message.reply({ components: [waitingContainer], flags: MessageFlags.IsComponentsV2 });

    const answerObj = await puppetQueue.add(() =>
        getAnswer(image)
    );
    const answer = answerObj.answer || 'No Answer';
    const explanation = answerObj.explanation || 'No Explanation';
    const url = answerObj.url || 'https://www.gauthmath.com/';
    const correctBtn = new ButtonBuilder()
        .setCustomId(`correct`)
        .setLabel('Correct')
        .setEmoji(emojis.tick)
        .setStyle(ButtonStyle.Success);

    const retryBtn = new ButtonBuilder()
        .setCustomId(`retry`)
        .setLabel('Retry')
        .setEmoji(emojis.retry)
        .setStyle(ButtonStyle.Danger);

    const explanationBtn = new ButtonBuilder()
        .setCustomId(`explanation`)
        .setLabel('Explanation')
        .setEmoji(emojis.explanation)
        .setStyle(ButtonStyle.Primary);

    const buttonRow = new ActionRowBuilder().addComponents(correctBtn, retryBtn, explanationBtn);

    const answerContainer = new ContainerBuilder()
        .setAccentColor(0x3574cf)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## [${title}](${answerObj.url})\n${answer}`)
        )
        .addSeparatorComponents(
            seperator
        )
        .addActionRowComponents(
            buttonRow
        );

    const collector = message_sent.createMessageComponentCollector({
        componentType: ComponentType.Button
    });

    await message_sent.edit({ components: [answerContainer] });
    const originalPoster = message.author.id;

    let onAnswer = true;

    collector.on('collect', async(interaction) => {
        await interaction.deferUpdate();
        if (interaction.user.id !== originalPoster) {
            return;
        }

        if (interaction.customId === `correct`) {
            answerContainer.setAccentColor(colours.light_green);

            for (const component of buttonRow.components) {
                component.setDisabled(true);
            }

            await message_sent.edit({ components: [answerContainer] });
        } else if (interaction.customId === `retry`) {
            answerContainer.setAccentColor(colours.light_red);

            for (const component of buttonRow.components) {
                component.setDisabled(true);
            }

            await message_sent.edit({ components: [answerContainer] });

        } else if (interaction.customId === `explanation`) {
            if (!onAnswer) {
                await message_sent.edit({ components: [answerContainer] });
                onAnswer = true;
                return;
            }
            onAnswer = false;
            const explanationContainer = new ContainerBuilder()
            .setAccentColor(colours.yellow)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## [${title}](${answerObj.url})\n${explanation}\n-# click on the explanation button again to go back to the answer`)
            )
            .addSeparatorComponents(
                seperator
            )
            .addActionRowComponents(
                buttonRow
            );

            await message_sent.edit({ components: [explanationContainer] });
        }

    });

    } catch(e) {
        console.log(e);
        const errorSection = new TextDisplayBuilder().setContent(`## Error occured with ${title}\nAn error has occured with the request. Please try again later.`);

        const errorContainer = new ContainerBuilder()
            .setAccentColor(0xFF474D)
            .addTextDisplayComponents(
                errorSection
            );

        await message_sent.edit({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
    }

}

async function imageSolverHandler(message) {
    // Ignore messages from other channels
    if (
        (Array.isArray(IMAGE_SOLVER_CHANNEL_ID) && !IMAGE_SOLVER_CHANNEL_ID.includes(message.channel.id)) ||
        (!Array.isArray(IMAGE_SOLVER_CHANNEL_ID) && message.channel.id !== IMAGE_SOLVER_CHANNEL_ID)
    ) return;

    if (message.author.bot) return;
    // Get all image attachments
    const imageAttachments = message.attachments.filter(attachment =>
    attachment.contentType?.startsWith('image/')
    );

    if (imageAttachments.size > 0) {
    for (const attachment of imageAttachments.values()) {
        const responseImage = await fetch(attachment.url);
        const arrayBuffer = await responseImage.arrayBuffer();

        const buffer = Buffer.from(arrayBuffer);

        await imageSolver(buffer, message);
    }

    return;
    }
}

module.exports = imageSolverHandler;