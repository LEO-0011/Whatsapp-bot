require('./settings');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const chalk = require('chalk');
const path = require('path');
const NodeCache = require('node-cache');
const pino = require('pino');
const readline = require('readline');
const { rmSync } = require('fs');
const store = require('./lib/lightweight_store');
const settings = require('./settings');
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main');
const PhoneNumber = require('awesome-phonenumber');
const { smsg } = require('./lib/myfunc');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, jidDecode, jidNormalizedUser, makeCacheableSignalKeyStore, delay } = require('@whiskeysockets/baileys');

// ========== PREVENT MULTIPLE CONNECTIONS ==========
let isConnecting = false;
let connectionAttempts = 0;
const MAX_RETRIES = 5;

// ========== GET PHONE NUMBER FROM ENVIRONMENT VARIABLE ==========
const phoneNumber = process.env.PAIR_NUMBER || settings.ownerNumber || "";

if (!phoneNumber) {
  console.log(chalk.red('❌ ERROR: PAIR_NUMBER environment variable is not set!'));
  console.log(chalk.yellow('Please set PAIR_NUMBER in Render Dashboard -> Environment tab'));
  console.log(chalk.yellow('Example: PAIR_NUMBER=911234567890 (without + or spaces)'));
}

// Basic store init & periodic save
store.readFromFile();
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000);

// Memory optimization / safety
setInterval(() => {
  if (global.gc) {
    global.gc();
    console.log('🧹 Garbage collection completed');
  }
}, 60_000);

setInterval(() => {
  const usedMB = process.memoryUsage().rss / 1024 / 1024;
  if (usedMB > (settings.maxMemoryMB || 600)) {
    console.log(`⚠️ RAM too high (${Math.round(usedMB)}MB) — restarting to avoid crashes`);
    process.exit(1);
  }
}, 30_000);

let owner = {};
try { owner = JSON.parse(fs.readFileSync('./data/owner.json')); } catch (e) { owner = settings.ownerNumber || phoneNumber; }

global.botname = settings.botName || "KNIGHT BOT";
global.themeemoji = settings.themeEmoji || "•";
const pairingCode = !!phoneNumber || process.argv.includes("--pairing-code");
const useMobile = process.argv.includes("--mobile");

// ========== CLEAR SESSION FUNCTION ==========
function clearSession() {
  try {
    const sessionPath = './session';
    if (fs.existsSync(sessionPath)) {
      rmSync(sessionPath, { recursive: true, force: true });
      console.log(chalk.yellow('🗑️ Session folder deleted. Will create new session.'));
    }
  } catch (error) {
    console.error('Error clearing session:', error);
  }
}

async function startXeonBotInc() {
  // Prevent multiple simultaneous connection attempts
  if (isConnecting) {
    console.log(chalk.yellow('⏳ Already connecting... Please wait.'));
    return;
  }

  if (connectionAttempts >= MAX_RETRIES) {
    console.log(chalk.red('❌ Max connection attempts reached. Clearing session and restarting...'));
    clearSession();
    connectionAttempts = 0;
    await delay(10000);
  }

  isConnecting = true;
  connectionAttempts++;

  try {
    let { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(`./session`);
    const msgRetryCounterCache = new NodeCache();

    const XeonBotInc = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: !pairingCode,
      browser: ["Ubuntu", "Chrome", "20.0.04"],
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
      },
      markOnlineOnConnect: true,
      generateHighQualityLinkPreview: true,
      syncFullHistory: false,
      getMessage: async (key) => {
        const jid = jidNormalizedUser(key.remoteJid);
        const msg = await store.loadMessage(jid, key.id);
        return msg?.message || "";
      },
      msgRetryCounterCache,
      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,  // Increased to reduce conflicts
      retryRequestDelayMs: 2000,
    });

    // persist creds
    XeonBotInc.ev.on('creds.update', saveCreds);
    store.bind(XeonBotInc.ev);

    // helpers
    XeonBotInc.decodeJid = (jid) => {
      if (!jid) return jid;
      if (/:\d+@/gi.test(jid)) {
        const decode = jidDecode(jid) || {};
        return (decode.user && decode.server && decode.user + '@' + decode.server) || jid;
      }
      return jid;
    };

    XeonBotInc.getName = (jid, withoutContact = false) => {
      const id = XeonBotInc.decodeJid(jid);
      withoutContact = XeonBotInc.withoutContact || withoutContact;
      let v;
      if (id.endsWith("@g.us")) {
        return new Promise(async (resolve) => {
          v = store.contacts[id] || {};
          if (!(v.name || v.subject)) v = await XeonBotInc.groupMetadata(id).catch(() => ({}));
          resolve(v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international'));
        });
      } else {
        v = id === '0@s.whatsapp.net' ? { id, name: 'WhatsApp' } : id === XeonBotInc.decodeJid(XeonBotInc.user.id) ? XeonBotInc.user : (store.contacts[id] || {});
        return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international');
      }
    };

    XeonBotInc.public = true;
    XeonBotInc.serializeM = (m) => smsg(XeonBotInc, m, store);

    // ========== PAIRING CODE FLOW (AUTOMATIC) ==========
    if (pairingCode && !XeonBotInc.authState.creds.registered) {
      if (useMobile) throw new Error('Cannot use pairing code with mobile api');

      let phoneNumberInput = process.env.PAIR_NUMBER || phoneNumber;
      
      if (!phoneNumberInput) {
        console.log(chalk.red('❌ ERROR: No phone number provided!'));
        console.log(chalk.yellow('Set PAIR_NUMBER environment variable in Render Dashboard'));
        console.log(chalk.yellow('Example: PAIR_NUMBER=911234567890'));
        process.exit(1);
      }

      phoneNumberInput = phoneNumberInput.replace(/[^0-9]/g, '');
      console.log(chalk.green(`📱 Using phone number from ENV: ${phoneNumberInput}`));
      
      const pn = require('awesome-phonenumber');
      if (!pn('+' + phoneNumberInput).isValid()) {
        console.log(chalk.red('❌ Invalid phone number format!'));
        console.log(chalk.yellow('Please use international format without + or spaces'));
        console.log(chalk.yellow('Example: 911234567890 for India, 12025551234 for USA'));
        process.exit(1);
      }

      setTimeout(async () => {
        try {
          let code = await XeonBotInc.requestPairingCode(phoneNumberInput);
          code = code?.match(/.{1,4}/g)?.join("-") || code;
          console.log(chalk.bgGreen.black(`\n✅ YOUR PAIRING CODE: ${code}\n`));
          console.log(chalk.yellow(`📲 Steps to link your WhatsApp:`));
          console.log(chalk.cyan(`   1. Open WhatsApp on your phone`));
          console.log(chalk.cyan(`   2. Go to Settings > Linked Devices`));
          console.log(chalk.cyan(`   3. Tap "Link a Device"`));
          console.log(chalk.cyan(`   4. Enter code: ${code}`));
          console.log(chalk.yellow(`\n⏳ Waiting for you to enter the code...`));
        } catch (error) {
          console.error('Error requesting pairing code:', error);
          console.log(chalk.red('Failed to get pairing code. Please check your phone number and try again.'));
        }
      }, 3000);
    }

    // Message handler (robust)
    XeonBotInc.ev.on('messages.upsert', async (chatUpdate) => {
      try {
        const mek = chatUpdate.messages[0];
        if (!mek) return;
        if (!mek.message) return;
        mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') ? mek.message.ephemeralMessage.message : mek.message;

        if (mek.key && mek.key.remoteJid === 'status@broadcast') {
          await handleStatus(XeonBotInc, chatUpdate);
          return;
        }

        if (!XeonBotInc.public && !mek.key.fromMe && chatUpdate.type === 'notify') {
          const isGroup = mek.key?.remoteJid?.endsWith('@g.us');
          if (!isGroup) return;
        }

        if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return;

        if (XeonBotInc?.msgRetryCounterCache) XeonBotInc.msgRetryCounterCache.clear();

        try {
          await handleMessages(XeonBotInc, chatUpdate, true);
        } catch (err) {
          console.error("Error in handleMessages:", err);
          try {
            const target = mek.key && mek.key.remoteJid ? mek.key.remoteJid : undefined;
            if (target) {
              await XeonBotInc.sendMessage(mek.key.remoteJid, {
                text: '❌ An error occurred while processing your message.'
              }).catch(() => {});
            }
          } catch (e) { console.error('Failed to notify user about error:', e); }
        }
      } catch (err) {
        console.error("Error in messages.upsert wrapper:", err);
      }
    });

    // ========== CONNECTION UPDATES WITH CONFLICT HANDLING ==========
    XeonBotInc.ev.on('connection.update', async (s) => {
      const { connection, lastDisconnect, qr } = s;

      if (qr) console.log(chalk.yellow('📱 QR Code generated. Please scan with WhatsApp.'));
      if (connection === 'connecting') console.log(chalk.yellow('🔄 Connecting to WhatsApp...'));

      if (connection === 'open') {
        isConnecting = false;
        connectionAttempts = 0;  // Reset on successful connection
        console.log(chalk.magenta(' '));
        console.log(chalk.yellow('🌿Connected to => ' + JSON.stringify(XeonBotInc.user, null, 2)));

        try {
          const botNumber = XeonBotInc.user.id.split(':')[0] + '@s.whatsapp.net';
          await XeonBotInc.sendMessage(botNumber, {
            text: `🤖 Bot Connected Successfully!\n\n⏰ Time: ${new Date().toLocaleString()}\n✅ Status: Online and Ready!\n\n💙 KnightBot MD is Active!`
          }).catch(() => {});
        } catch (error) {
          console.error('Error sending connection message:', error?.message || error);
        }

        await delay(1200);
        console.log(chalk.yellow(`\n\n                  ${chalk.bold.blue(`[ ${global.botname || 'KNIGHT BOT'} ]`)}\n\n`));
        console.log(chalk.cyan(`< ================================================== >`));
        console.log(chalk.magenta(`\n${global.themeemoji || '•'} INSTA ID: Leo.yagami_`));
        console.log(chalk.magenta(`${global.themeemoji || '•'} GITHUB:yagami-universe-001`));
        console.log(chalk.magenta(`${global.themeemoji || '•'} WA NUMBER: ${owner}`));
        console.log(chalk.magenta(`${global.themeemoji || '•'} CREDIT: ⚘ᴩᴀᴛʜɪʀᴀᴊ.Py™♨ヅ`));
        console.log(chalk.green(`${global.themeemoji || '•'} 🤖 Bot Connected Successfully! ✅`));
        console.log(chalk.blue(`Bot Version: ${settings.version}`));
      }

      if (connection === 'close') {
        isConnecting = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errorMessage = lastDisconnect?.error?.message || '';
        
        console.log(chalk.red(`Connection closed. Status: ${statusCode}, Error: ${errorMessage}`));

        // Handle different disconnect reasons
        if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
          console.log(chalk.red('🔴 Session logged out. Clearing session...'));
          clearSession();
          connectionAttempts = 0;
          console.log(chalk.yellow('Please redeploy to get a new pairing code.'));
          process.exit(1);  // Exit so Render can restart fresh
        } 
        else if (statusCode === DisconnectReason.connectionClosed || 
                 statusCode === DisconnectReason.connectionLost ||
                 statusCode === DisconnectReason.timedOut) {
          console.log(chalk.yellow('🟡 Connection lost. Reconnecting...'));
          const retryDelay = Math.min(5000 * connectionAttempts, 30000);  // Max 30 seconds
          await delay(retryDelay);
          startXeonBotInc();
        }
        else if (statusCode === DisconnectReason.connectionReplaced || 
                 errorMessage.includes('conflict')) {
          console.log(chalk.red('🔴 Connection conflict detected!'));
          console.log(chalk.yellow('Another device/instance is using this WhatsApp session.'));
          console.log(chalk.yellow('Make sure no other WhatsApp Web sessions are active.'));
          
          // Wait longer before retry to avoid rapid conflicts
          console.log(chalk.yellow('Waiting 30 seconds before retry...'));
          await delay(30000);
          
          if (connectionAttempts >= 3) {
            console.log(chalk.red('Too many conflicts. Clearing session...'));
            clearSession();
            connectionAttempts = 0;
            process.exit(1);
          }
          startXeonBotInc();
        }
        else if (statusCode === DisconnectReason.badSession || 
                 errorMessage.includes('Bad MAC')) {
          console.log(chalk.red('🔴 Bad session detected. Clearing session...'));
          clearSession();
          connectionAttempts = 0;
          await delay(5000);
          startXeonBotInc();
        }
        else {
          // Generic reconnection for other errors
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          if (shouldReconnect) {
            const retryDelay = Math.min(5000 * connectionAttempts, 30000);
            console.log(chalk.yellow(`Reconnecting in ${retryDelay/1000} seconds...`));
            await delay(retryDelay);
            startXeonBotInc();
          }
        }
      }
    });

    // Anticall handler
    const antiCallNotified = new Set();
    XeonBotInc.ev.on('call', async (calls) => {
      try {
        const { readState: readAnticallState } = require('./commands/anticall');
        const state = readAnticallState();
        if (!state || !state.enabled) return;
        for (const call of calls) {
          const callerJid = call.from || call.peerJid || call.chatId;
          if (!callerJid) continue;
          try {
            if (typeof XeonBotInc.rejectCall === 'function' && call.id) {
              await XeonBotInc.rejectCall(call.id, callerJid);
            } else if (typeof XeonBotInc.sendCallOfferAck === 'function' && call.id) {
              await XeonBotInc.sendCallOfferAck(call.id, callerJid, 'reject');
            }
          } catch {}
          if (!antiCallNotified.has(callerJid)) {
            antiCallNotified.add(callerJid);
            setTimeout(() => antiCallNotified.delete(callerJid), 60000);
            await XeonBotInc.sendMessage(callerJid, { text: '📵 Anticall is enabled. Your call was rejected and you may be blocked.' }).catch(() => {});
          }
          setTimeout(async () => { try { await XeonBotInc.updateBlockStatus(callerJid, 'block'); } catch {} }, 800);
        }
      } catch (e) {}
    });

    // Group participant updates and status handlers
    XeonBotInc.ev.on('group-participants.update', async (update) => { await handleGroupParticipantUpdate(XeonBotInc, update).catch(() => {}); });
    XeonBotInc.ev.on('status.update', async (status) => { await handleStatus(XeonBotInc, status).catch(() => {}); });
    XeonBotInc.ev.on('messages.reaction', async (status) => { await handleStatus(XeonBotInc, status).catch(() => {}); });

    return XeonBotInc;

  } catch (error) {
    isConnecting = false;
    console.error('Error in startXeonBotInc:', error);
    const retryDelay = Math.min(5000 * connectionAttempts, 30000);
    await delay(retryDelay);
    startXeonBotInc();
  }
}

startXeonBotInc().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});

let file = require.resolve(__filename);
fs.watchFile(file, () => {
  fs.unwatchFile(file);
  console.log(chalk.redBright(`Update ${__filename}`));
  delete require.cache[file];
  require(file);
});
