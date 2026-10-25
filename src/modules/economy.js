// language: Node.js, file: src/modules/economy.js
const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, PermissionFlagsBits,
} = require('discord.js');
const db = require('../utils/db');

// ── helpers ────────────────────────────────────────────────────────────────────
function bal(userId) { return db.get('economy', `bal_${userId}`, 500); }
function setBal(userId, n) { db.set('economy', `bal_${userId}`, Math.max(0, Math.round(n))); }
function addBal(userId, n) { setBal(userId, bal(userId) + n); }

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

const SLOT_SYMBOLS = ['🍒', '🍋', '🍊', '🍇', '💎', '7️⃣'];
const SLOT_MULT   = { '🍒': 2, '🍋': 2, '🍊': 3, '🍇': 4, '💎': 8, '7️⃣': 15 };

function spin() { return SLOT_SYMBOLS[rand(0, SLOT_SYMBOLS.length - 1)]; }

// ── commands ──────────────────────────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder().setName('balance').setDescription('Check your coin balance')
    .addUserOption(o => o.setName('user').setDescription('Check another user').setRequired(false)).toJSON(),

  new SlashCommandBuilder().setName('daily').setDescription('Claim your daily coins').toJSON(),

  new SlashCommandBuilder().setName('slots')
    .setDescription('Spin the slot machine')
    .addIntegerOption(o => o.setName('bet').setDescription('Coins to bet').setRequired(true).setMinValue(10)).toJSON(),

  new SlashCommandBuilder().setName('blackjack')
    .setDescription('Play blackjack')
    .addIntegerOption(o => o.setName('bet').setDescription('Coins to bet').setRequired(true).setMinValue(10)).toJSON(),

  new SlashCommandBuilder().setName('rob')
    .setDescription('Attempt to rob another user')
    .addUserOption(o => o.setName('user').setDescription('Target').setRequired(true)).toJSON(),

  new SlashCommandBuilder().setName('heist')
    .setDescription('Start a server heist — others can join for 30s').toJSON(),

  new SlashCommandBuilder().setName('leaderboard').setDescription('Top 10 richest users').toJSON(),

  new SlashCommandBuilder().setName('give')
    .setDescription('Give coins to another user')
    .addUserOption(o => o.setName('user').setDescription('Recipient').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)).toJSON(),
];

// active blackjack & heist sessions
const bjSessions    = new Map();
const heistSessions = new Map();

// ── card helpers ───────────────────────────────────────────────────────────────
function cardVal(c) {
  if (['J','Q','K'].includes(c.rank)) return 10;
  if (c.rank === 'A') return 11;
  return parseInt(c.rank);
}
function handVal(hand) {
  let total = 0, aces = 0;
  for (const c of hand) { total += cardVal(c); if (c.rank === 'A') aces++; }
  while (total > 21 && aces--) total -= 10;
  return total;
}
function newDeck() {
  const ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const suits = ['♠','♥','♦','♣'];
  const deck  = [];
  for (const s of suits) for (const r of ranks) deck.push({ rank: r, suit: s });
  for (let i = deck.length - 1; i > 0; i--) { const j = rand(0, i); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck;
}
function showHand(hand) { return hand.map(c => `${c.rank}${c.suit}`).join(' '); }

// ── init ───────────────────────────────────────────────────────────────────────
function init(client) {
  client.on('interactionCreate', async i => {
    // ── slash commands ────────────────────────────────────────────────────────
    if (i.isChatInputCommand()) {
      const { commandName: cmd, user } = i;

      // BALANCE
      if (cmd === 'balance') {
        const target = i.options.getUser('user') ?? user;
        const coins  = bal(target.id);
        const embed  = new EmbedBuilder()
          .setColor(0xf0b132)
          .setTitle(`💰 ${target.username}'s Balance`)
          .setDescription(`**${coins.toLocaleString()} coins**`)
          .setThumbnail(target.displayAvatarURL());
        return i.reply({ embeds: [embed] });
      }

      // DAILY
      if (cmd === 'daily') {
        const key  = `daily_${user.id}`;
        const last = db.get('economy', key, 0);
        const now  = Date.now();
        if (now - last < 86_400_000) {
          const rem = 86_400_000 - (now - last);
          const h   = Math.floor(rem / 3600000);
          const m   = Math.floor((rem % 3600000) / 60000);
          return i.reply({ content: `⏰ Daily already claimed. Come back in **${h}h ${m}m**.`, ephemeral: true });
        }
        const reward = rand(150, 400);
        addBal(user.id, reward);
        db.set('economy', key, now);
        const embed = new EmbedBuilder()
          .setColor(0x23a55a)
          .setTitle('🎁 Daily Reward')
          .setDescription(`You received **${reward} coins**!\nBalance: **${bal(user.id).toLocaleString()}**`);
        return i.reply({ embeds: [embed] });
      }

      // SLOTS
      if (cmd === 'slots') {
        const bet = i.options.getInteger('bet');
        if (bal(user.id) < bet) return i.reply({ content: '❌ Not enough coins.', ephemeral: true });
        const reels = [spin(), spin(), spin()];
        let outcome = '', mult = 0;
        if (reels[0] === reels[1] && reels[1] === reels[2]) {
          mult = SLOT_MULT[reels[0]];
          outcome = `🎉 **JACKPOT! ×${mult}**`;
        } else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
          mult = 1.5;
          outcome = `✅ Two of a kind — ×1.5`;
        } else {
          outcome = `❌ No match — lost`;
        }
        const winnings = mult ? Math.round(bet * mult) : 0;
        addBal(user.id, winnings - bet);
        const net = winnings - bet;
        const embed = new EmbedBuilder()
          .setColor(mult ? 0xf0b132 : 0xed4245)
          .setTitle('🎰 Slots')
          .setDescription(`${reels.join(' | ')}\n\n${outcome}`)
          .addFields(
            { name: 'Bet',     value: `${bet}`,             inline: true },
            { name: 'Net',     value: `${net >= 0 ? '+' : ''}${net}`, inline: true },
            { name: 'Balance', value: `${bal(user.id).toLocaleString()}`, inline: true },
          );
        return i.reply({ embeds: [embed] });
      }

      // BLACKJACK
      if (cmd === 'blackjack') {
        const bet = i.options.getInteger('bet');
        if (bal(user.id) < bet) return i.reply({ content: '❌ Not enough coins.', ephemeral: true });
        if (bjSessions.has(user.id)) return i.reply({ content: '❌ Finish your current game first.', ephemeral: true });

        const deck   = newDeck();
        const player = [deck.pop(), deck.pop()];
        const dealer = [deck.pop(), deck.pop()];
        bjSessions.set(user.id, { deck, player, dealer, bet });

        const pv = handVal(player);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`bj_hit_${user.id}`).setLabel('Hit').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`bj_stand_${user.id}`).setLabel('Stand').setStyle(ButtonStyle.Secondary),
        );
        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('🃏 Blackjack')
          .addFields(
            { name: 'Your hand',    value: `${showHand(player)} = **${pv}**`,        inline: true },
            { name: "Dealer shows", value: `${dealer[0].rank}${dealer[0].suit} + ?`, inline: true },
            { name: 'Bet',          value: String(bet),                               inline: true },
          );

        if (pv === 21) {
          bjSessions.delete(user.id);
          const win = Math.round(bet * 1.5);
          addBal(user.id, win);
          embed.setColor(0xf0b132).setDescription(`**BLACKJACK! +${win} coins**`);
          return i.reply({ embeds: [embed] });
        }

        return i.reply({ embeds: [embed], components: [row] });
      }

      // ROB
      if (cmd === 'rob') {
        const target = i.options.getUser('user');
        if (target.id === user.id) return i.reply({ content: '❌ Can\'t rob yourself.', ephemeral: true });
        const tBal = bal(target.id);
        if (tBal < 50) return i.reply({ content: `❌ ${target.username} is too broke to rob.`, ephemeral: true });
        const coolKey = `rob_cd_${user.id}`;
        const last    = db.get('economy', coolKey, 0);
        if (Date.now() - last < 5 * 60_000)
          return i.reply({ content: '❌ Rob cooldown — wait 5 minutes.', ephemeral: true });

        const success = Math.random() < 0.45;
        db.set('economy', coolKey, Date.now());
        if (success) {
          const amount = rand(Math.floor(tBal * 0.1), Math.floor(tBal * 0.35));
          addBal(user.id, amount);
          addBal(target.id, -amount);
          const embed = new EmbedBuilder()
            .setColor(0x23a55a)
            .setTitle('🦹 Rob Successful')
            .setDescription(`You swiped **${amount} coins** from ${target.username}!`);
          return i.reply({ embeds: [embed] });
        } else {
          const fine = rand(50, 200);
          addBal(user.id, -fine);
          const embed = new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle('🚨 Caught!')
            .setDescription(`You got caught robbing ${target.username} and paid a **${fine} coin** fine.`);
          return i.reply({ embeds: [embed] });
        }
      }

      // HEIST
      if (cmd === 'heist') {
        if (heistSessions.has(i.guildId))
          return i.reply({ content: '❌ A heist is already in progress.', ephemeral: true });

        const session = { leader: user.id, members: new Set([user.id]), guildId: i.guildId };
        heistSessions.set(i.guildId, session);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`heist_join_${i.guildId}`).setLabel('Join Heist').setStyle(ButtonStyle.Danger),
        );
        const embed = new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle('💰 Heist Starting!')
          .setDescription(`${user.username} is planning a heist! **30 seconds** to join.\nMinimum crew: 2 people.`)
          .setFooter({ text: 'Everyone in the crew must have coins to participate.' });

        await i.reply({ embeds: [embed], components: [row] });

        setTimeout(async () => {
          heistSessions.delete(i.guildId);
          const members = [...session.members];
          if (members.length < 2) {
            return i.editReply({ content: '❌ Heist cancelled — not enough crew.', embeds: [], components: [] });
          }
          const success = Math.random() < 0.55;
          let desc = '';
          if (success) {
            const pool = members.reduce((a, id) => a + Math.floor(bal(id) * 0.2), 0);
            const cut  = Math.floor(pool / members.length);
            members.forEach(id => addBal(id, cut));
            desc = `✅ **Heist succeeded!** Each member gets **${cut} coins**.`;
          } else {
            const fine = 100;
            members.forEach(id => addBal(id, -fine));
            desc = `❌ **Heist failed!** Each member lost **${fine} coins**.`;
          }
          const result = new EmbedBuilder()
            .setColor(success ? 0x23a55a : 0xed4245)
            .setTitle('💰 Heist Result')
            .setDescription(desc)
            .addFields({ name: 'Crew', value: members.map(id => `<@${id}>`).join(', ') });
          await i.editReply({ embeds: [result], components: [] });
        }, 30_000);
      }

      // LEADERBOARD
      if (cmd === 'leaderboard') {
        const all   = db.read('economy');
        const bals  = Object.entries(all)
          .filter(([k]) => k.startsWith('bal_'))
          .map(([k, v]) => ({ id: k.replace('bal_', ''), coins: v }))
          .sort((a, b) => b.coins - a.coins)
          .slice(0, 10);

        const medals = ['🥇','🥈','🥉'];
        const rows   = await Promise.all(bals.map(async ({ id, coins }, idx) => {
          try {
            const u = await client.users.fetch(id);
            return `${medals[idx] ?? `**${idx + 1}.**`} ${u.username} — **${coins.toLocaleString()} coins**`;
          } catch {
            return `**${idx + 1}.** Unknown — **${coins.toLocaleString()} coins**`;
          }
        }));

        const embed = new EmbedBuilder()
          .setColor(0xf0b132)
          .setTitle('🏆 Coin Leaderboard')
          .setDescription(rows.join('\n') || 'No data yet.');
        return i.reply({ embeds: [embed] });
      }

      // GIVE
      if (cmd === 'give') {
        const target = i.options.getUser('user');
        const amount = i.options.getInteger('amount');
        if (target.id === user.id) return i.reply({ content: '❌ Can\'t give to yourself.', ephemeral: true });
        if (bal(user.id) < amount) return i.reply({ content: '❌ Not enough coins.', ephemeral: true });
        addBal(user.id, -amount);
        addBal(target.id, amount);
        const embed = new EmbedBuilder()
          .setColor(0x23a55a)
          .setTitle('💸 Coins Sent')
          .setDescription(`You gave **${amount} coins** to ${target.username}.`);
        return i.reply({ embeds: [embed] });
      }
    }

    // ── button handlers ────────────────────────────────────────────────────────
    if (i.isButton()) {
      const id = i.customId;

      // Blackjack hit/stand
      if (id.startsWith('bj_hit_') || id.startsWith('bj_stand_')) {
        const ownerId = id.split('_')[2];
        if (i.user.id !== ownerId) return i.reply({ content: '❌ Not your game.', ephemeral: true });

        const session = bjSessions.get(ownerId);
        if (!session) return i.reply({ content: '❌ Session expired.', ephemeral: true });

        const { deck, player, dealer, bet } = session;

        if (id.startsWith('bj_hit_')) {
          player.push(deck.pop());
          const pv = handVal(player);
          if (pv > 21) {
            bjSessions.delete(ownerId);
            addBal(ownerId, -bet);
            return i.update({
              embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('🃏 Blackjack').setDescription('**BUST!** You went over 21.')
                .addFields({ name: 'Your hand', value: `${showHand(player)} = ${pv}`, inline: true })],
              components: [],
            });
          }
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`bj_hit_${ownerId}`).setLabel('Hit').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`bj_stand_${ownerId}`).setLabel('Stand').setStyle(ButtonStyle.Secondary),
          );
          return i.update({
            embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('🃏 Blackjack')
              .addFields({ name: 'Your hand', value: `${showHand(player)} = **${pv}**`, inline: true })],
            components: [row],
          });
        }

        // STAND — dealer plays
        if (id.startsWith('bj_stand_')) {
          bjSessions.delete(ownerId);
          while (handVal(dealer) < 17) dealer.push(deck.pop());
          const pv = handVal(player), dv = handVal(dealer);
          let outcome, delta;
          if (dv > 21 || pv > dv) { outcome = `✅ You win! **+${bet} coins**`; delta = bet; }
          else if (pv === dv)      { outcome = `🤝 Push — bet returned.`;        delta = 0; }
          else                     { outcome = `❌ Dealer wins. **-${bet} coins**`; delta = -bet; }
          addBal(ownerId, delta);
          return i.update({
            embeds: [new EmbedBuilder().setColor(delta > 0 ? 0x23a55a : delta < 0 ? 0xed4245 : 0x5865f2)
              .setTitle('🃏 Blackjack').setDescription(outcome)
              .addFields(
                { name: 'Your hand',    value: `${showHand(player)} = ${pv}`, inline: true },
                { name: "Dealer's hand", value: `${showHand(dealer)} = ${dv}`, inline: true },
              )],
            components: [],
          });
        }
      }

      // Heist join
      if (id.startsWith('heist_join_')) {
        const guildId = id.replace('heist_join_', '');
        const session = heistSessions.get(guildId);
        if (!session) return i.reply({ content: '❌ Heist already over.', ephemeral: true });
        if (session.members.has(i.user.id)) return i.reply({ content: '✅ Already in.', ephemeral: true });
        session.members.add(i.user.id);
        return i.reply({ content: `✅ ${i.user.username} joined the heist! (${session.members.size} crew)`, ephemeral: false });
      }
    }
  });
}

module.exports = { commands, init };
