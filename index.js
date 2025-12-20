const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeInMemoryStore,
    Browsers,
    delay
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');
const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const axios = require('axios');
const moment = require('moment-timezone');
const NodeCache = require('node-cache');

// ========== HTTP SERVER FOR RENDER ==========
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Knight Bot - WhatsApp</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body {
                    font-family: 'Segoe UI', Arial, sans-serif;
                    text-align: center;
                    padding: 50px;
                    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                    color: white;
                    min-height: 100vh;
                    margin: 0;
                }
                .container {
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 20px;
                }
                h1 { color: #00ff88; font-size: 2.5em; }
                .status { 
                    background: rgba(0,255,136,0.2); 
                    padding: 15px; 
                    border-radius: 10px; 
                    margin: 20px 0;
                    border: 1px solid #00ff88;
                }
                .info { 
                    background: rgba(255,255,255,0.1); 
                    padding: 15px; 
                    border-radius: 10px; 
                    margin: 10px 0;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🤖 Knight Bot</h1>
                <div class="status">
                    <h2>✅ Bot is Running!</h2>
                    <p>WhatsApp Bot is active and connected.</p>
                </div>
                <div class="info">
                    <p><strong>Version:</strong> 3.0.4</p>
                    <p><strong>Platform:</strong> Render</p>
                    <p><strong>Status:</strong> Online</p>
                    <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
                </div>
            </div>
        </body>
        </html>
    `);
});

server.listen(PORT, () => {
    console.log(chalk.green(`✅ HTTP Server running on port ${PORT}`));
});

// ========== BOT CONFIGURATION ==========
const config = {
    botName: 'KNIGHT BOT',
    ownerNumber: ['918428964362', '919751755841'],
    prefix: '.',
    version: '3.0.4'
};

// ========== MESSAGE RETRY CACHE ==========
const msgRetryCounterCache = new NodeCache();

// ========== STORE ==========
const store = makeInMemoryStore({
    logger: pino().child({ level: 'silent', stream: 'store' })
});

// Store file (optional - for persistence)
const storeFile = './store.json';
if (fs.existsSync(storeFile)) {
    store.readFromFile(storeFile);
}

// Save store periodically
setInterval(() => {
    try {
        store.writeToFile(storeFile);
    } catch (e) {}
}, 30000);

// ========== SESSION PATH ==========
const sessionPath = './session';

// Ensure session directory exists
if (!fs.existsSync(sessionPath)) {
    fs.mkdirSync(sessionPath, { recursive: true });
}

// ========== CONNECTION STATE ==========
let isConnected = false;
let connectionRetries = 0;
const MAX_RETRIES = 5;

// ========== MAIN BOT FUNCTION ==========
async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version, isLatest } = await fetchLatestBaileysVersion();
        
        console.log(chalk.cyan(`Using Baileys v${version}, isLatest: ${isLatest}`));

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: true,
            auth: state,
            browser: Browsers.macOS('Desktop'),
            msgRetryCounterCache,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            emitOwnEvents: false,
            retryRequestDelayMs: 2000,
            getMessage: async (key) => {
                if (store) {
                    const msg = await store.loadMessage(key.remoteJid, key.id);
                    return msg?.message || undefined;
                }
                return { conversation: 'hello' };
            }
        });

        store.bind(sock.ev);

        // ========== CONNECTION HANDLING ==========
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log(chalk.yellow('📱 Scan QR Code above to connect WhatsApp'));
            }

            if (connection === 'close') {
                isConnected = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const reason = lastDisconnect?.error?.output?.payload?.error;
                
                console.log(chalk.red(`❌ Connection closed. Status: ${statusCode}, Reason: ${reason}`));

                // Handle disconnect reasons
                switch (statusCode) {
                    case DisconnectReason.loggedOut:
                        console.log(chalk.red('🚫 Logged out from WhatsApp. Clearing session...'));
                        await fs.remove(sessionPath);
                        console.log(chalk.yellow('Session cleared. Please restart and scan QR again.'));
                        process.exit(1);
                        break;

                    case DisconnectReason.connectionReplaced:
                        console.log(chalk.red('⚠️ Connection replaced! Another device connected.'));
                        console.log(chalk.yellow('Make sure bot runs only in ONE place.'));
                        process.exit(1);
                        break;

                    case DisconnectReason.badSession:
                        console.log(chalk.red('🔄 Bad session, clearing and restarting...'));
                        await fs.remove(sessionPath);
                        connectionRetries = 0;
                        setTimeout(startBot, 3000);
                        break;

                    case DisconnectReason.connectionClosed:
                    case DisconnectReason.connectionLost:
                    case DisconnectReason.timedOut:
                    case DisconnectReason.restartRequired:
                    default:
                        connectionRetries++;
                        if (connectionRetries <= MAX_RETRIES) {
                            const waitTime = Math.min(connectionRetries * 5000, 30000);
                            console.log(chalk.yellow(`🔄 Reconnecting in ${waitTime/1000}s... (Attempt ${connectionRetries}/${MAX_RETRIES})`));
                            setTimeout(startBot, waitTime);
                        } else {
                            console.log(chalk.red('❌ Max retries reached. Please check your connection.'));
                            process.exit(1);
                        }
                        break;
                }
            }

            if (connection === 'connecting') {
                console.log(chalk.yellow('🔄 Connecting to WhatsApp...'));
            }

            if (connection === 'open') {
                isConnected = true;
                connectionRetries = 0;
                
                console.log(chalk.green(' '));
                console.log(chalk.green('🌿Connected to =>', JSON.stringify(sock.user, null, 2)));
                console.log('\n');
                console.log(chalk.cyan('                  [ KNIGHT BOT ]'));
                console.log('\n');
                console.log(chalk.cyan('< ================================================== >'));
                console.log('');
                console.log(chalk.white('• YT CHANNEL: MR UNIQUE HACKER'));
                console.log(chalk.white('• GITHUB: mrunqiuehacker'));
                console.log(chalk.white(`• WA NUMBER: ${config.ownerNumber.join(',')}`));
                console.log(chalk.white('• CREDIT: MR UNIQUE HACKER'));
                console.log(chalk.green('• 🤖 Bot Connected Successfully! ✅'));
                console.log(chalk.cyan(`Bot Version: ${config.version}`));
            }
        });

        // ========== SAVE CREDENTIALS ==========
        sock.ev.on('creds.update', saveCreds);

        // ========== MESSAGE HANDLING ==========
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;

            try {
                const msg = messages[0];
                if (!msg.message) return;
                if (msg.key.fromMe) return;

                const from = msg.key.remoteJid;
                const isGroup = from.endsWith('@g.us');
                const sender = isGroup ? msg.key.participant : from;
                const pushName = msg.pushName || 'User';

                // Get message content
                const messageType = Object.keys(msg.message)[0];
                const body =
                    messageType === 'conversation' ? msg.message.conversation :
                    messageType === 'extendedTextMessage' ? msg.message.extendedTextMessage.text :
                    messageType === 'imageMessage' ? msg.message.imageMessage?.caption :
                    messageType === 'videoMessage' ? msg.message.videoMessage?.caption :
                    '';

                if (!body) return;

                // Check if command
                const isCommand = body.startsWith(config.prefix);
                const command = isCommand ? body.slice(1).trim().split(' ')[0].toLowerCase() : '';
                const args = body.trim().split(' ').slice(1);
                const text = args.join(' ');

                // Check if owner
                const isOwner = config.ownerNumber.includes(sender.split('@')[0]);

                // Log commands
                if (isCommand) {
                    const chatType = isGroup ? 'group' : 'private';
                    console.log(chalk.blue(`📝 Command used in ${chatType}: ${config.prefix}${command}`));
                }

                // ========== COMMAND HANDLER ==========
                switch (command) {
                    case 'menu':
                    case 'help':
                        const menuText = `
╭━━━━━━━━━━━━━━━━━━━━╮
┃  🤖 *${config.botName}*
┃  Version: ${config.version}
┃  User: ${pushName}
╰━━━━━━━━━━━━━━━━━━━━╯

╭━━━━━━━━━━━━━━━━━━━━╮
┃ 📋 *MAIN MENU*
╰━━━━━━━━━━━━━━━━━━━━╯

*🔧 General:*
• ${config.prefix}menu - Show menu
• ${config.prefix}ping - Bot speed
• ${config.prefix}alive - Bot status
• ${config.prefix}owner - Owner contact
• ${config.prefix}info - Bot info
• ${config.prefix}runtime - Uptime

*🎵 Media:*
• ${config.prefix}sticker - Make sticker
• ${config.prefix}play - Play music
• ${config.prefix}ytmp3 - YouTube MP3
• ${config.prefix}ytmp4 - YouTube MP4

*🎮 Fun:*
• ${config.prefix}joke - Random joke
• ${config.prefix}quote - Random quote

*🔍 Search:*
• ${config.prefix}google - Google search
• ${config.prefix}ytsearch - YouTube search

╭━━━━━━━━━━━━━━━━━━━━╮
┃ ⏰ ${moment().tz('Asia/Kolkata').format('DD/MM/YYYY HH:mm:ss')}
┃ 💚 Powered by Knight Bot
╰━━━━━━━━━━━━━━━━━━━━╯
                        `.trim();

                        await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                        break;

                    case 'ping':
                        const start = Date.now();
                        const sent = await sock.sendMessage(from, { text: '📍 Testing speed...' }, { quoted: msg });
                        const end = Date.now();
                        await sock.sendMessage(from, { 
                            text: `🏓 *Pong!*\n\n⚡ Response: ${end - start}ms\n🟢 Status: Active`,
                            edit: sent.key
                        });
                        break;

                    case 'alive':
                        await sock.sendMessage(from, {
                            text: `✅ *${config.botName} is Online!*\n\n🤖 Bot is running smoothly.\n⏰ Time: ${moment().tz('Asia/Kolkata').format('DD/MM/YYYY HH:mm:ss')}\n📊 Version: ${config.version}`
                        }, { quoted: msg });
                        break;

                    case 'owner':
                        const vcard = `BEGIN:VCARD
VERSION:3.0
FN:Knight Bot Owner
ORG:Knight Bot;
TEL;type=CELL;type=VOICE;waid=${config.ownerNumber[0]}:+${config.ownerNumber[0]}
END:VCARD`;

                        await sock.sendMessage(from, {
                            contacts: {
                                displayName: 'Knight Bot Owner',
                                contacts: [{ vcard }]
                            }
                        }, { quoted: msg });
                        break;

                    case 'info':
                    case 'botinfo':
                        const infoText = `
╭━━━━━━━━━━━━━━━━━━━━╮
┃  🤖 *BOT INFORMATION*
╰━━━━━━━━━━━━━━━━━━━━╯

• *Name:* ${config.botName}
• *Version:* ${config.version}
• *Platform:* Render
• *Library:* Baileys
• *Language:* Node.js
• *Creator:* MR UNIQUE HACKER

╭━━━━━━━━━━━━━━━━━━━━╮
┃ ✅ Status: Online
┃ 🟢 All Systems Operational
╰━━━━━━━━━━━━━━━━━━━━╯
                        `.trim();

                        await sock.sendMessage(from, { text: infoText }, { quoted: msg });
                        break;

                    case 'runtime':
                    case 'uptime':
                        const uptime = process.uptime();
                        const hours = Math.floor(uptime / 3600);
                        const minutes = Math.floor((uptime % 3600) / 60);
                        const seconds = Math.floor(uptime % 60);

                        await sock.sendMessage(from, {
                            text: `⏱️ *Bot Uptime*\n\n🕐 ${hours}h ${minutes}m ${seconds}s`
                        }, { quoted: msg });
                        break;

                    default:
                        // Add more commands here or load from plugins folder
                        break;
                }

            } catch (error) {
                console.error(chalk.red('Error handling message:'), error);
            }
        });

        // ========== GROUP EVENTS ==========
        sock.ev.on('groups.update', async (updates) => {
            // Handle group updates
        });

        sock.ev.on('group-participants.update', async (update) => {
            // Handle participant changes (welcome/goodbye)
        });

        return sock;

    } catch (error) {
        console.error(chalk.red('Error starting bot:'), error);
        connectionRetries++;
        if (connectionRetries <= MAX_RETRIES) {
            console.log(chalk.yellow(`🔄 Retrying in 10 seconds...`));
            setTimeout(startBot, 10000);
        } else {
            process.exit(1);
        }
    }
}

// ========== HANDLE PROCESS ERRORS ==========
process.on('uncaughtException', (err) => {
    console.error(chalk.red('Uncaught Exception:'), err);
});

process.on('unhandledRejection', (err) => {
    console.error(chalk.red('Unhandled Rejection:'), err);
});

// ========== START BOT ==========
console.log(chalk.cyan('🚀 Starting Knight Bot...'));
console.log(chalk.cyan('================================'));
startBot();
