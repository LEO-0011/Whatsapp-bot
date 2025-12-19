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
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    jidDecode, 
    jidNormalizedUser, 
    makeCacheableSignalKeyStore, 
    delay,
    Browsers 
} = require('@whiskeysockets/baileys');
const express = require('express');

// ========== SESSION MANAGEMENT ==========
const SESSION_PATH = './session';

// Only clear session if explicitly requested or first time
if (process.env.CLEAR_SESSION === 'true') {
    try {
        if (fs.existsSync(SESSION_PATH)) {
            fs.rmSync(SESSION_PATH, { recursive: true, force: true });
            console.log(chalk.yellow('🧹 Session cleared as requested'));
        }
    } catch (e) {
        console.error('Error clearing session:', e);
    }
}

// ========== HTTP SERVER FOR RENDER ==========
const app = express();
const PORT = process.env.PORT || 3000;

let botStatus = 'Starting...';
let currentPairingCode = null;
let connectedPhone = null;
let linkingMethod = 'notification'; // 'notification' or 'code'

app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Knight Bot MD</title>
            <meta http-equiv="refresh" content="3">
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
                .container { max-width: 500px; margin: 0 auto; }
                h1 { 
                    color: #00d4ff; 
                    font-size: 28px;
                    margin-bottom: 10px;
                    text-shadow: 0 0 30px rgba(0,212,255,0.5);
                }
                .subtitle { color: #888; margin-bottom: 30px; }
                .code { 
                    font-size: 56px; 
                    color: #00ff88; 
                    margin: 25px 0; 
                    font-family: 'Courier New', monospace;
                    letter-spacing: 8px;
                    text-shadow: 0 0 30px #00ff88;
                    padding: 25px;
                    background: rgba(0,255,136,0.1);
                    border-radius: 15px;
                    border: 2px solid #00ff88;
                    animation: pulse 2s infinite;
                }
                @keyframes pulse {
                    0%, 100% { box-shadow: 0 0 20px rgba(0,255,136,0.3); }
                    50% { box-shadow: 0 0 40px rgba(0,255,136,0.6); }
                }
                .status { 
                    color: #ffa500; 
                    font-size: 18px;
                    margin: 20px 0;
                    padding: 15px;
                    background: rgba(255,165,0,0.1);
                    border-radius: 10px;
                }
                .notification-box {
                    background: rgba(0,212,255,0.1);
                    border: 2px solid #00d4ff;
                    border-radius: 15px;
                    padding: 25px;
                    margin: 20px 0;
                }
                .notification-box h2 {
                    color: #00d4ff;
                    margin-top: 0;
                }
                .notification-box .icon {
                    font-size: 60px;
                    margin-bottom: 15px;
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
                    line-height: 1.6;
                }
                .warning {
                    background: rgba(255,68,68,0.2);
                    padding: 15px;
                    border-radius: 10px;
                    margin: 20px 0;
                    border: 2px solid #ff4444;
                    color: #ff6b6b;
                    font-weight: bold;
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
                    font-size: 32px;
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
                .method-switch {
                    margin: 20px 0;
                    padding: 15px;
                    background: rgba(255,255,255,0.05);
                    border-radius: 10px;
                }
                .method-switch a {
                    color: #00d4ff;
                    text-decoration: none;
                }
                .method-switch a:hover {
                    text-decoration: underline;
                }
                .phone-display {
                    font-size: 24px;
                    color: #00d4ff;
                    background: rgba(0,212,255,0.1);
                    padding: 10px 20px;
                    border-radius: 10px;
                    display: inline-block;
                    margin: 10px 0;
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
                        ${connectedPhone ? `<p>📱 Connected: <strong>+${connectedPhone}</strong></p>` : ''}
                        <p style="color: #888; font-size: 14px;">Bot is running. You can close this page.</p>
                    </div>
                ` : botStatus.includes('notification') || botStatus.includes('Check your phone') ? `
                    <div class="notification-box">
                        <div class="icon">📱🔔</div>
                        <h2>Check Your Phone!</h2>
                        <p>A notification has been sent to your WhatsApp.</p>
                        <div class="phone-display">+${process.env.PAIR_NUMBER || 'Your Number'}</div>
                    </div>
                    
                    <div class="steps">
                        <h3>📲 Easy Steps:</h3>
                        <ol>
                            <li>📱 <strong>Check your WhatsApp</strong> for a notification</li>
                            <li>🔔 You'll see <strong>"A device is trying to link"</strong></li>
                            <li>✅ Tap the <strong>green "Link Device" button</strong></li>
                            <li>🎉 Done! Bot will connect automatically</li>
                        </ol>
                    </div>
                    
                    <div class="method-switch">
                        <p>📝 Didn't get notification? <a href="/use-code">Use pairing code instead</a></p>
                    </div>
                ` : currentPairingCode ? `
                    <div class="code">${currentPairingCode}</div>
                    
                    <div class="warning">
                        ⚠️ ENTER THIS CODE WITHIN 60 SECONDS!
                    </div>
                    
                    <div class="steps">
                        <h3>📲 How to Link:</h3>
                        <ol>
                            <li>Open <strong>WhatsApp</strong> on your phone</li>
                            <li>Go to <strong>Settings → Linked Devices</strong></li>
                            <li>Tap <strong>"Link a Device"</strong></li>
                            <li>Tap <strong>"Link with phone number instead"</strong></li>
                            <li>Enter code: <strong style="color:#00ff88;">${currentPairingCode}</strong></li>
                        </ol>
                    </div>
                    
                    <div class="method-switch">
                        <p>🔔 <a href="/use-notification">Try notification method instead</a></p>
                    </div>
                ` : `
                    <div class="status">
                        <span class="loader"></span>
                        ${botStatus}
                    </div>
                    <p>Please wait while the bot initializes...</p>
                `}
                
                <div class="footer">
                    <p>Page auto-refreshes every 3 seconds</p>
                    <p>Knight Bot MD v${settings.version || '1.0.0'}</p>
                </div>
            </div>
        </body>
        </html>
    `);
});

// Switch to code method
app.get('/use-code', (req, res) => {
    linkingMethod = 'code';
    res.redirect('/');
});

// Switch to notification method
app.get('/use-notification', (req, res) => {
    linkingMethod = 'notification';
    res.redirect('/');
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        bot: botStatus, 
        uptime: process.uptime(),
        memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
        method: linkingMethod
    });
});

// Force clear session endpoint
app.get('/clear-session', (req, res) => {
    try {
        if (fs.existsSync(SESSION_PATH)) {
            fs.rmSync(SESSION_PATH, { recursive: true, force: true });
        }
        res.send('Session cleared! <a href="/">Go back</a> and wait for new pairing.');
    } catch (e) {
        res.send('Error clearing session: ' + e.message);
    }
});

// START HTTP SERVER IMMEDIATELY
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(chalk.green(`✅ HTTP Server running on port ${PORT}`));
    console.log(chalk.cyan(`🌐 Open your Render URL to see status`));
});

// ========== PREVENT MULTIPLE CONNECTIONS ==========
let isConnecting = false;
let connectionAttempts = 0;
const MAX_RETRIES = 5;
let XeonBotIncGlobal = null;

// ========== GET PHONE NUMBER ==========
const phoneNumber = process.env.PAIR_NUMBER || settings.ownerNumber || "";
const cleanPhoneNumber = phoneNumber.replace(/[^0-9]/g, '');

if (!cleanPhoneNumber) {
    console.log(chalk.red('❌ ERROR: PAIR_NUMBER not set!'));
    botStatus = '❌ Set PAIR_NUMBER in Environment';
}

// Basic store init
try {
    store.readFromFile();
} catch (e) {}

setInterval(() => {
    try { store.writeToFile(); } catch (e) {}
}, settings.storeWriteInterval || 10000);

// Memory management
setInterval(() => {
    if (global.gc) global.gc();
}, 60000);

setInterval(() => {
    const usedMB = process.memoryUsage().rss / 1024 / 1024;
    if (usedMB > (settings.maxMemoryMB || 600)) {
        console.log(`⚠️ RAM high (${Math.round(usedMB)}MB) — restarting`);
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

// ========== CLEAR SESSION FUNCTION ==========
function clearSession() {
    try {
        if (fs.existsSync(SESSION_PATH)) {
            rmSync(SESSION_PATH, { recursive: true, force: true });
            console.log(chalk.yellow('🗑️ Session cleared'));
        }
    } catch (error) {
        console.error('Error clearing session:', error);
    }
}

// ========== MAIN BOT FUNCTION ==========
async function startXeonBotInc() {
    if (isConnecting) {
        console.log(chalk.yellow('⏳ Already connecting...'));
        return;
    }

    if (connectionAttempts >= MAX_RETRIES) {
        console.log(chalk.red('❌ Max retries reached. Clearing session...'));
        clearSession();
        connectionAttempts = 0;
        botStatus = 'Restarting fresh...';
        await delay(5000);
    }

    isConnecting = true;
    connectionAttempts++;
    botStatus = `Initializing... (${connectionAttempts}/${MAX_RETRIES})`;

    try {
        let { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(chalk.green(`📦 Baileys v${version.join('.')}`));
        
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
        const msgRetryCounterCache = new NodeCache();

        const XeonBotInc = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            browser: Browsers.ubuntu('Chrome'),
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
            },
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            getMessage: async (key) => {
                try {
                    const jid = jidNormalizedUser(key.remoteJid);
                    const msg = await store.loadMessage(jid, key.id);
                    return msg?.message || "";
                } catch {
                    return "";
                }
            },
            msgRetryCounterCache,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 25000,
            retryRequestDelayMs: 2000,
            emitOwnEvents: true,
        });

        XeonBotIncGlobal = XeonBotInc;
        XeonBotInc.ev.on('creds.update', saveCreds);
        
        try { store.bind(XeonBotInc.ev); } catch (e) {}

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

        // ========== CONNECTION UPDATE HANDLER ==========
        XeonBotInc.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            // When QR is generated - handle pairing
            if (qr && !XeonBotInc.authState.creds.registered) {
                
                if (!cleanPhoneNumber) {
                    console.log(chalk.red('❌ No phone number!'));
                    botStatus = '❌ Set PAIR_NUMBER in Environment';
                    isConnecting = false;
                    return;
                }

                console.log(chalk.cyan(`\n📱 Phone: ${cleanPhoneNumber}`));
                console.log(chalk.cyan(`🔗 Method: ${linkingMethod}\n`));

                try {
                    await delay(2000);

                    if (linkingMethod === 'notification') {
                        // ========== NOTIFICATION METHOD ==========
                        // This sends a push notification to the phone
                        console.log(chalk.green('🔔 Sending link notification to your phone...'));
                        botStatus = '🔔 Check your phone for notification!';
                        
                        // Request pairing - this triggers the notification
                        const code = await XeonBotInc.requestPairingCode(cleanPhoneNumber);
                        
                        console.log(chalk.green('\n' + '═'.repeat(60)));
                        console.log(chalk.green('  📱 NOTIFICATION SENT TO YOUR WHATSAPP!'));
                        console.log(chalk.green('═'.repeat(60)));
                        console.log(chalk.yellow('\n👆 Check your phone for:'));
                        console.log(chalk.white('   "A device is trying to link to your account"'));
                        console.log(chalk.white('   Tap the GREEN "Link Device" button\n'));
                        
                        // Also show code as backup
                        const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
                        currentPairingCode = formattedCode;
                        
                        console.log(chalk.gray(`   Backup code if needed: ${formattedCode}`));
                        console.log(chalk.green('═'.repeat(60) + '\n'));
                        
                        botStatus = '🔔 Check your phone! Tap "Link Device" button';
                        
                    } else {
                        // ========== CODE METHOD ==========
                        console.log(chalk.cyan('📤 Requesting pairing code...'));
                        botStatus = 'Requesting pairing code...';
                        
                        let code = await XeonBotInc.requestPairingCode(cleanPhoneNumber);
                        code = code?.match(/.{1,4}/g)?.join("-") || code;
                        currentPairingCode = code;
                        
                        console.log(chalk.green('\n' + '═'.repeat(60)));
                        console.log(chalk.bgGreen.black(`   PAIRING CODE: ${code}   `));
                        console.log(chalk.green('═'.repeat(60)));
                        console.log(chalk.red('\n⚠️  Enter in WhatsApp within 60 seconds!\n'));
                        
                        botStatus = '⏳ Enter the code in WhatsApp NOW!';
                    }
                    
                } catch (error) {
                    console.error(chalk.red('❌ Pairing error:'), error.message);
                    
                    if (error.message?.includes('rate') || error.message?.includes('limit')) {
                        botStatus = '⏳ Rate limited. Wait 5 minutes.';
                    } else {
                        botStatus = '❌ Error: ' + error.message;
                        
                        // Retry once
                        await delay(5000);
                        try {
                            const code = await XeonBotInc.requestPairingCode(cleanPhoneNumber);
                            const formatted = code?.match(/.{1,4}/g)?.join("-") || code;
                            currentPairingCode = formatted;
                            botStatus = linkingMethod === 'notification' 
                                ? '🔔 Check your phone! Tap "Link Device"'
                                : '⏳ Enter the code NOW!';
                            console.log(chalk.green(`✅ Code: ${formatted}`));
                        } catch (e) {
                            console.error(chalk.red('❌ Retry failed'));
                        }
                    }
                }
            }

            if (connection === 'connecting') {
                console.log(chalk.yellow('🔄 Connecting...'));
                if (!currentPairingCode && !botStatus.includes('notification')) {
                    botStatus = 'Connecting to WhatsApp...';
                }
            }

            if (connection === 'open') {
                isConnecting = false;
                connectionAttempts = 0;
                currentPairingCode = null;

                connectedPhone = XeonBotInc.user?.id?.split(':')[0] || 'Unknown';
                botStatus = '✅ Connected Successfully!';

                console.log(chalk.green('\n' + '🎉'.repeat(25)));
                console.log(chalk.green('  ✅ BOT CONNECTED SUCCESSFULLY!'));
                console.log(chalk.green('🎉'.repeat(25)));
                console.log(chalk.yellow(`\n📱 Connected as: +${connectedPhone}`));
                console.log(chalk.cyan(`🤖 Bot: ${global.botname}\n`));

                // Send welcome message
                try {
                    const botJid = XeonBotInc.user.id.split(':')[0] + '@s.whatsapp.net';
                    await delay(2000);
                    await XeonBotInc.sendMessage(botJid, {
                        text: `🤖 *${global.botname} Connected!*\n\n` +
                              `⏰ ${new Date().toLocaleString()}\n` +
                              `✅ Status: Online\n` +
                              `📦 v${settings.version || '1.0.0'}\n\n` +
                              `💙 Bot is ready!`
                    }).catch(() => {});
                } catch (e) {}
            }

            if (connection === 'close') {
                isConnecting = false;
                currentPairingCode = null;
                
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const errorMsg = lastDisconnect?.error?.message || '';

                console.log(chalk.red(`❌ Disconnected (${statusCode}): ${errorMsg}`));
                botStatus = `Disconnected (${statusCode})`;

                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    console.log(chalk.red('🔴 Logged out. Clearing session...'));
                    clearSession();
                    connectionAttempts = 0;
                    await delay(3000);
                    startXeonBotInc();
                } 
                else if ([
                    DisconnectReason.connectionClosed,
                    DisconnectReason.connectionLost,
                    DisconnectReason.timedOut,
                    DisconnectReason.restartRequired
                ].includes(statusCode)) {
                    console.log(chalk.yellow('🟡 Reconnecting...'));
                    botStatus = 'Reconnecting...';
                    await delay(Math.min(3000 * connectionAttempts, 15000));
                    startXeonBotInc();
                }
                else if (statusCode === DisconnectReason.connectionReplaced) {
                    console.log(chalk.red('🔴 Connection replaced!'));
                    botStatus = 'Another session active. Waiting...';
                    await delay(30000);
                    startXeonBotInc();
                }
                else if (statusCode === DisconnectReason.badSession) {
                    console.log(chalk.red('🔴 Bad session. Clearing...'));
                    clearSession();
                    connectionAttempts = 0;
                    await delay(3000);
                    startXeonBotInc();
                }
                else {
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                    if (shouldReconnect) {
                        await delay(Math.min(5000 * connectionAttempts, 30000));
                        startXeonBotInc();
                    }
                }
            }
        });

        // ========== MESSAGE HANDLER ==========
        XeonBotInc.ev.on('messages.upsert', async (chatUpdate) => {
            try {
                const mek = chatUpdate.messages[0];
                if (!mek || !mek.message) return;
                
                mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') 
                    ? mek.message.ephemeralMessage.message 
                    : mek.message;

                if (mek.key?.remoteJid === 'status@broadcast') {
                    await handleStatus(XeonBotInc, chatUpdate).catch(() => {});
                    return;
                }

                if (!XeonBotInc.public && !mek.key.fromMe && chatUpdate.type === 'notify') {
                    if (!mek.key?.remoteJid?.endsWith('@g.us')) return;
                }

                if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return;

                if (XeonBotInc?.msgRetryCounterCache) {
                    XeonBotInc.msgRetryCounterCache.flushAll();
                }

                await handleMessages(XeonBotInc, chatUpdate, true).catch(err => {
                    console.error("Message error:", err.message);
                });
            } catch (err) {
                console.error("Upsert error:", err.message);
            }
        });

        // ========== ANTI-CALL ==========
        const antiCallNotified = new Set();
        XeonBotInc.ev.on('call', async (calls) => {
            try {
                let state = { enabled: false };
                try {
                    const { readState } = require('./commands/anticall');
                    state = readState();
                } catch {}
                
                if (!state?.enabled) return;
                
                for (const call of calls) {
                    const jid = call.from || call.peerJid;
                    if (!jid) continue;
                    
                    try {
                        if (call.id) await XeonBotInc.rejectCall(call.id, jid);
                    } catch {}
                    
                    if (!antiCallNotified.has(jid)) {
                        antiCallNotified.add(jid);
                        setTimeout(() => antiCallNotified.delete(jid), 60000);
                        await XeonBotInc.sendMessage(jid, { 
                            text: '📵 Anti-call enabled. Call rejected.' 
                        }).catch(() => {});
                    }
                }
            } catch {}
        });

        // ========== GROUP UPDATES ==========
        XeonBotInc.ev.on('group-participants.update', async (update) => { 
            await handleGroupParticipantUpdate(XeonBotInc, update).catch(() => {}); 
        });

        // ========== STATUS HANDLERS ==========
        XeonBotInc.ev.on('status.update', async (status) => { 
            await handleStatus(XeonBotInc, status).catch(() => {}); 
        });

        XeonBotInc.ev.on('messages.reaction', async (status) => { 
            await handleStatus(XeonBotInc, status).catch(() => {}); 
        });

        return XeonBotInc;

    } catch (error) {
        isConnecting = false;
        console.error(chalk.red('❌ Error:'), error.message);
        botStatus = 'Error: ' + error.message;
        
        await delay(Math.min(5000 * connectionAttempts, 30000));
        startXeonBotInc();
    }
}

// ========== START ==========
console.log(chalk.cyan('\n' + '═'.repeat(50)));
console.log(chalk.cyan('  🤖 KNIGHT BOT MD'));
console.log(chalk.cyan('═'.repeat(50)));

if (cleanPhoneNumber) {
    console.log(chalk.green(`📱 Phone: ${cleanPhoneNumber}`));
    console.log(chalk.cyan(`🔗 Default method: ${linkingMethod}`));
} else {
    console.log(chalk.red('❌ Set PAIR_NUMBER in Environment!'));
}

console.log(chalk.cyan('═'.repeat(50) + '\n'));

setTimeout(() => {
    startXeonBotInc().catch(error => {
        console.error(chalk.red('Fatal:'), error);
        botStatus = 'Fatal: ' + error.message;
    });
}, 2000);

// ========== ERROR HANDLERS ==========
process.on('uncaughtException', (err) => {
    console.error(chalk.red('Exception:'), err.message);
});

process.on('unhandledRejection', (err) => {
    console.error(chalk.red('Rejection:'), err.message);
});

process.on('SIGTERM', () => {
    console.log(chalk.yellow('👋 Shutting down...'));
    server.close(() => process.exit(0));
});

// Hot reload (dev only)
if (process.env.NODE_ENV !== 'production') {
    const file = require.resolve(__filename);
    fs.watchFile(file, () => {
        fs.unwatchFile(file);
        delete require.cache[file];
        require(file);
    });
}
