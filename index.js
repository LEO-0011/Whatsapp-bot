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
const express = require('express');

// ========== HTTP SERVER FOR RENDER ==========
const app = express();
const PORT = process.env.PORT || 3000;

let botStatus = 'Starting...';
let currentPairingCode = null;
let connectedPhone = null;

app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Knight Bot MD</title>
            <meta http-equiv="refresh" content="5">
            <style>
                * { box-sizing: border-box; }
                body { 
                    font-family: 'Segoe UI', Arial, sans-serif; 
                    text-align: center; 
                    padding: 30px 20px; 
                    background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%);
                    color: white;
                    min-height: 100vh;
                    margin: 0;
                }
                .container { max-width: 450px; margin: 0 auto; }
                h1 { 
                    color: #00d4ff; 
                    font-size: 28px;
                    margin-bottom: 10px;
                    text-shadow: 0 0 30px rgba(0,212,255,0.5);
                }
                .subtitle { color: #888; margin-bottom: 30px; }
                .code { 
                    font-size: 48px; 
                    color: #00ff88; 
                    margin: 25px 0; 
                    font-family: 'Courier New', monospace;
                    letter-spacing: 6px;
                    text-shadow: 0 0 30px #00ff88;
                    padding: 20px;
                    background: rgba(0,255,136,0.1);
                    border-radius: 15px;
                    border: 2px solid #00ff88;
                }
                .status { 
                    color: #ffa500; 
                    font-size: 18px;
                    margin: 20px 0;
                    padding: 15px;
                    background: rgba(255,165,0,0.1);
                    border-radius: 10px;
                }
                .connected { 
                    color: #00ff88 !important; 
                    background: rgba(0,255,136,0.1) !important;
                }
                .steps {
                    text-align: left;
                    background: rgba(255,255,255,0.05);
                    padding: 20px 25px;
                    border-radius: 15px;
                    margin: 25px 0;
                    border: 1px solid rgba(255,255,255,0.1);
                }
                .steps h3 { 
                    color: #00d4ff; 
                    margin-top: 0;
                    margin-bottom: 15px;
                }
                .steps ol { 
                    padding-left: 20px; 
                    margin: 0;
                }
                .steps li { 
                    margin: 12px 0; 
                    line-height: 1.5;
                }
                .warning {
                    background: rgba(255,68,68,0.15);
                    padding: 15px;
                    border-radius: 10px;
                    margin: 20px 0;
                    border: 1px solid #ff4444;
                    color: #ff6b6b;
                }
                .success-box {
                    background: rgba(0,255,136,0.1);
                    padding: 30px;
                    border-radius: 15px;
                    border: 2px solid #00ff88;
                    margin: 20px 0;
                }
                .success-box h2 {
                    color: #00ff88;
                    margin: 0 0 10px 0;
                }
                .footer {
                    color: #555;
                    font-size: 12px;
                    margin-top: 40px;
                    padding-top: 20px;
                    border-top: 1px solid rgba(255,255,255,0.1);
                }
                .loader {
                    display: inline-block;
                    width: 20px;
                    height: 20px;
                    border: 3px solid rgba(255,255,255,0.3);
                    border-radius: 50%;
                    border-top-color: #00d4ff;
                    animation: spin 1s linear infinite;
                    margin-right: 10px;
                    vertical-align: middle;
                }
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🤖 Knight Bot MD</h1>
                <p class="subtitle">WhatsApp Multi-Device Bot</p>
                
                ${botStatus.includes('Connected') ? `
                    <div class="success-box">
                        <h2>✅ Bot Connected!</h2>
                        <p>Your WhatsApp bot is now online and ready.</p>
                        ${connectedPhone ? `<p>Connected as: ${connectedPhone}</p>` : ''}
                    </div>
                ` : currentPairingCode ? `
                    <div class="code">${currentPairingCode}</div>
                    <div class="warning">
                        ⚠️ <strong>Enter this code within 60 seconds!</strong>
                    </div>
                    <div class="steps">
                        <h3>📲 How to Link Your WhatsApp:</h3>
                        <ol>
                            <li>Open <strong>WhatsApp</strong> on your phone</li>
                            <li>Tap <strong>⋮ Menu</strong> (3 dots) or <strong>Settings</strong></li>
                            <li>Tap <strong>Linked Devices</strong></li>
                            <li>Tap <strong>"Link a Device"</strong></li>
                            <li>Enter the code: <strong style="color:#00ff88">${currentPairingCode}</strong></li>
                        </ol>
                    </div>
                ` : `
                    <div class="status">
                        <span class="loader"></span>
                        ${botStatus}
                    </div>
                    <p>Please wait while the bot initializes...</p>
                `}
                
                <div class="footer">
                    <p>Page auto-refreshes every 5 seconds</p>
                    <p>Knight Bot MD v${settings.version || '1.0.0'}</p>
                </div>
            </div>
        </body>
        </html>
    `);
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        bot: botStatus, 
        uptime: process.uptime(),
        memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB'
    });
});

// START HTTP SERVER IMMEDIATELY - Critical for Render!
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(chalk.green(`✅ HTTP Server running on port ${PORT}`));
    console.log(chalk.cyan(`🌐 Open your Render URL to see the pairing code`));
});

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
    botStatus = '❌ Error: PAIR_NUMBER not set in environment!';
}

// Basic store init & periodic save
store.readFromFile();
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000);

// Memory optimization
setInterval(() => {
    if (global.gc) {
        global.gc();
        console.log('🧹 Garbage collection completed');
    }
}, 60000);

setInterval(() => {
    const usedMB = process.memoryUsage().rss / 1024 / 1024;
    if (usedMB > (settings.maxMemoryMB || 600)) {
        console.log(`⚠️ RAM too high (${Math.round(usedMB)}MB) — restarting`);
        process.exit(1);
    }
}, 30000);

let owner = {};
try { 
    owner = JSON.parse(fs.readFileSync('./data/owner.json')); 
} catch (e) { 
    owner = settings.ownerNumber || phoneNumber; 
}

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
            console.log(chalk.yellow('🗑️ Session folder deleted.'));
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
        console.log(chalk.red('❌ Max connection attempts reached. Clearing session...'));
        clearSession();
        connectionAttempts = 0;
        botStatus = 'Max retries reached. Restarting...';
        await delay(10000);
    }

    isConnecting = true;
    connectionAttempts++;
    botStatus = `Connecting... (Attempt ${connectionAttempts}/${MAX_RETRIES})`;

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
            keepAliveIntervalMs: 25000,
            retryRequestDelayMs: 2000,
        });

        // Persist creds
        XeonBotInc.ev.on('creds.update', saveCreds);
        store.bind(XeonBotInc.ev);

        // Helpers
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

        // ========== PAIRING CODE FLOW ==========
        if (pairingCode && !XeonBotInc.authState.creds.registered) {
            if (useMobile) throw new Error('Cannot use pairing code with mobile api');

            let phoneNumberInput = process.env.PAIR_NUMBER || phoneNumber;

            if (!phoneNumberInput) {
                console.log(chalk.red('❌ ERROR: No phone number provided!'));
                botStatus = '❌ No phone number configured!';
                return;
            }

            phoneNumberInput = phoneNumberInput.replace(/[^0-9]/g, '');
            console.log(chalk.green(`📱 Using phone number: ${phoneNumberInput}`));
            botStatus = 'Requesting pairing code...';

            const pn = require('awesome-phonenumber');
            if (!pn('+' + phoneNumberInput).isValid()) {
                console.log(chalk.red('❌ Invalid phone number format!'));
                botStatus = '❌ Invalid phone number format!';
                return;
            }

            setTimeout(async () => {
                try {
                    let code = await XeonBotInc.requestPairingCode(phoneNumberInput);
                    code = code?.match(/.{1,4}/g)?.join("-") || code;

                    // Update web display
                    currentPairingCode = code;
                    botStatus = 'Waiting for you to enter the code...';

                    console.log(chalk.bgGreen.black(`\n✅ YOUR PAIRING CODE: ${code}\n`));
                    console.log(chalk.yellow(`📲 Open your Render URL to see the code`));
                    console.log(chalk.yellow(`📲 Or enter this code in WhatsApp > Linked Devices`));
                    console.log(chalk.cyan(`\n⏳ Waiting for you to enter the code...\n`));
                } catch (error) {
                    console.error('Error requesting pairing code:', error);
                    botStatus = 'Error getting pairing code: ' + error.message;
                    currentPairingCode = null;
                }
            }, 3000);
        }

        // Message handler
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
                    } catch (e) {}
                }
            } catch (err) {
                console.error("Error in messages.upsert:", err);
            }
        });

        // ========== CONNECTION UPDATES ==========
        XeonBotInc.ev.on('connection.update', async (s) => {
            const { connection, lastDisconnect, qr } = s;

            if (qr) {
                console.log(chalk.yellow('📱 QR Code generated.'));
                botStatus = 'QR Code generated (use pairing code instead)';
            }

            if (connection === 'connecting') {
                console.log(chalk.yellow('🔄 Connecting to WhatsApp...'));
                botStatus = 'Connecting to WhatsApp...';
            }

            if (connection === 'open') {
                isConnecting = false;
                connectionAttempts = 0;
                currentPairingCode = null;

                // Get connected phone info
                connectedPhone = XeonBotInc.user?.id?.split(':')[0] || 'Unknown';
                botStatus = '✅ Connected Successfully!';

                console.log(chalk.green('\n✅ WhatsApp Connected Successfully!\n'));
                console.log(chalk.yellow('🌿 Connected to => ' + JSON.stringify(XeonBotInc.user, null, 2)));

                try {
                    const botNumber = XeonBotInc.user.id.split(':')[0] + '@s.whatsapp.net';
                    await XeonBotInc.sendMessage(botNumber, {
                        text: `🤖 *Knight Bot MD Connected!*\n\n⏰ Time: ${new Date().toLocaleString()}\n✅ Status: Online and Ready!\n\n💙 Bot is now active!`
                    }).catch(() => {});
                } catch (error) {
                    console.error('Error sending connection message:', error?.message);
                }

                await delay(1200);
                console.log(chalk.yellow(`\n                  ${chalk.bold.blue(`[ ${global.botname || 'KNIGHT BOT'} ]`)}\n`));
                console.log(chalk.cyan(`< ================================================== >`));
                console.log(chalk.magenta(`\n${global.themeemoji} GITHUB: yagami-universe-001`));
                console.log(chalk.magenta(`${global.themeemoji} WA NUMBER: ${owner}`));
                console.log(chalk.green(`${global.themeemoji} 🤖 Bot Connected Successfully! ✅`));
                console.log(chalk.blue(`Bot Version: ${settings.version || '1.0.0'}`));
            }

            if (connection === 'close') {
                isConnecting = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const errorMessage = lastDisconnect?.error?.message || '';

                console.log(chalk.red(`Connection closed. Status: ${statusCode}, Error: ${errorMessage}`));
                botStatus = `Disconnected (${statusCode})`;
                currentPairingCode = null;

                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    console.log(chalk.red('🔴 Session logged out. Clearing session...'));
                    clearSession();
                    connectionAttempts = 0;
                    botStatus = 'Logged out. Restarting...';
                    console.log(chalk.yellow('Restarting in 5 seconds...'));
                    await delay(5000);
                    process.exit(1);
                } 
                else if (statusCode === DisconnectReason.connectionClosed || 
                         statusCode === DisconnectReason.connectionLost ||
                         statusCode === DisconnectReason.timedOut) {
                    console.log(chalk.yellow('🟡 Connection lost. Reconnecting...'));
                    botStatus = 'Connection lost. Reconnecting...';
                    const retryDelay = Math.min(5000 * connectionAttempts, 30000);
                    await delay(retryDelay);
                    startXeonBotInc();
                }
                else if (statusCode === DisconnectReason.connectionReplaced || 
                         errorMessage.includes('conflict')) {
                    console.log(chalk.red('🔴 Connection conflict detected!'));
                    botStatus = 'Connection conflict! Check other sessions.';
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
                    console.log(chalk.red('🔴 Bad session. Clearing...'));
                    clearSession();
                    connectionAttempts = 0;
                    botStatus = 'Bad session. Restarting...';
                    await delay(5000);
                    startXeonBotInc();
                }
                else {
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                    if (shouldReconnect) {
                        const retryDelay = Math.min(5000 * connectionAttempts, 30000);
                        console.log(chalk.yellow(`Reconnecting in ${retryDelay/1000}s...`));
                        botStatus = `Reconnecting in ${retryDelay/1000}s...`;
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
                        }
                    } catch {}
                    if (!antiCallNotified.has(callerJid)) {
                        antiCallNotified.add(callerJid);
                        setTimeout(() => antiCallNotified.delete(callerJid), 60000);
                        await XeonBotInc.sendMessage(callerJid, { 
                            text: '📵 Anticall is enabled. Your call was rejected.' 
                        }).catch(() => {});
                    }
                    setTimeout(async () => { 
                        try { await XeonBotInc.updateBlockStatus(callerJid, 'block'); } catch {} 
                    }, 800);
                }
            } catch (e) {}
        });

        // Group participant updates
        XeonBotInc.ev.on('group-participants.update', async (update) => { 
            await handleGroupParticipantUpdate(XeonBotInc, update).catch(() => {}); 
        });

        // Status handlers
        XeonBotInc.ev.on('status.update', async (status) => { 
            await handleStatus(XeonBotInc, status).catch(() => {}); 
        });

        XeonBotInc.ev.on('messages.reaction', async (status) => { 
            await handleStatus(XeonBotInc, status).catch(() => {}); 
        });

        return XeonBotInc;

    } catch (error) {
        isConnecting = false;
        console.error('Error in startXeonBotInc:', error);
        botStatus = 'Error: ' + error.message;
        const retryDelay = Math.min(5000 * connectionAttempts, 30000);
        await delay(retryDelay);
        startXeonBotInc();
    }
}

// Start the bot
startXeonBotInc().catch(error => {
    console.error('Fatal error:', error);
    botStatus = 'Fatal error: ' + error.message;
});

// Error handlers
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
});

// Hot reload
let file = require.resolve(__filename);
fs.watchFile(file, () => {
    fs.unwatchFile(file);
    console.log(chalk.redBright(`Update ${__filename}`));
    delete require.cache[file];
    require(file);
});
