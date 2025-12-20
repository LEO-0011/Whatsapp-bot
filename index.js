const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeInMemoryStore,
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ========== HTTP SERVER FOR RENDER ==========
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
        <html>
        <head><title>Knight Bot</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px; background: #1a1a2e; color: white;">
            <h1>🤖 Knight Bot is Running!</h1>
            <p>✅ WhatsApp Bot is active and connected.</p>
            <p>Version: 3.0.4</p>
            <hr>
            <p>Status: Online</p>
        </body>
        </html>
    `);
}).listen(PORT, () => {
    console.log(`✅ HTTP Server running on port ${PORT}`);
});

// ========== BOT CONFIGURATION ==========
const config = {
    botName: 'KNIGHT BOT',
    ownerNumber: ['918428964362'], // Your number
    prefix: '.',
    version: '3.0.4'
};

// ========== STORE FOR MESSAGES ==========
const store = makeInMemoryStore({
    logger: pino().child({ level: 'silent', stream: 'store' })
});

// ========== MAIN BOT FUNCTION ==========
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./session');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true,
        auth: state,
        browser: Browsers.macOS('Desktop'),
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
            console.log('📱 Scan QR Code to connect');
        }

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            console.log(`Connection closed. Reason: ${reason}`);

            // Handle different disconnect reasons
            if (reason === DisconnectReason.loggedOut) {
                console.log('❌ Logged out. Please delete session folder and restart.');
                // Delete session if logged out
                if (fs.existsSync('./session')) {
                    fs.rmSync('./session', { recursive: true, force: true });
                }
                process.exit(1);
            } else if (reason === DisconnectReason.connectionClosed) {
                console.log('🔄 Connection closed, reconnecting...');
                setTimeout(startBot, 5000);
            } else if (reason === DisconnectReason.connectionLost) {
                console.log('🔄 Connection lost, reconnecting...');
                setTimeout(startBot, 5000);
            } else if (reason === DisconnectReason.connectionReplaced) {
                console.log('❌ Connection replaced. Another session is active!');
                console.log('⚠️ Please make sure bot runs only in ONE place.');
                process.exit(1);
            } else if (reason === DisconnectReason.restartRequired) {
                console.log('🔄 Restart required, restarting...');
                startBot();
            } else if (reason === DisconnectReason.timedOut) {
                console.log('🔄 Connection timed out, reconnecting...');
                setTimeout(startBot, 5000);
            } else {
                console.log('🔄 Unknown disconnect reason, reconnecting...');
                setTimeout(startBot, 5000);
            }
        }

        if (connection === 'connecting') {
            console.log('🔄 Connecting to WhatsApp...');
        }

        if (connection === 'open') {
            console.log(' ');
            console.log('🌿Connected to =>', JSON.stringify(sock.user, null, 2));
            console.log('\n');
            console.log('                  [ KNIGHT BOT ]');
            console.log('\n');
            console.log('< ================================================== >');
            console.log('');
            console.log('• YT CHANNEL: MR UNIQUE HACKER');
            console.log('• GITHUB: mrunqiuehacker');
            console.log(`• WA NUMBER: ${config.ownerNumber.join(',')}`);
            console.log('• CREDIT: MR UNIQUE HACKER');
            console.log('• 🤖 Bot Connected Successfully! ✅');
            console.log(`Bot Version: ${config.version}`);
        }
    });

    // ========== SAVE CREDENTIALS ==========
    sock.ev.on('creds.update', saveCreds);

    // ========== MESSAGE HANDLING ==========
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        const msg = messages[0];
        if (!msg.message) return;
        if (msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const sender = isGroup ? msg.key.participant : from;
        
        // Get message content
        const messageType = Object.keys(msg.message)[0];
        const body = 
            messageType === 'conversation' ? msg.message.conversation :
            messageType === 'extendedTextMessage' ? msg.message.extendedTextMessage.text :
            messageType === 'imageMessage' ? msg.message.imageMessage.caption :
            messageType === 'videoMessage' ? msg.message.videoMessage.caption :
            '';

        if (!body) return;

        // Check if it's a command
        const isCommand = body.startsWith(config.prefix);
        const command = isCommand ? body.slice(1).trim().split(' ')[0].toLowerCase() : '';
        const args = body.trim().split(' ').slice(1);
        const text = args.join(' ');

        // Log commands
        if (isCommand) {
            const chatType = isGroup ? 'group' : 'private';
            console.log(`📝 Command used in ${chatType}: ${config.prefix}${command}`);
        }

        // ========== COMMANDS ==========
        try {
            switch (command) {
                case 'menu':
                case 'help':
                    const menuText = `
╭━━━━━━━━━━━━━━━━━╮
┃  🤖 *KNIGHT BOT*
┃  Version: ${config.version}
╰━━━━━━━━━━━━━━━━━╯

╭━━━━━━━━━━━━━━━━━╮
┃ 📋 *MENU*
╰━━━━━━━━━━━━━━━━━╯

*General Commands:*
• ${config.prefix}menu - Show this menu
• ${config.prefix}ping - Check bot speed
• ${config.prefix}alive - Check if bot is online
• ${config.prefix}owner - Get owner contact
• ${config.prefix}info - Bot information

*Fun Commands:*
• ${config.prefix}sticker - Create sticker
• ${config.prefix}joke - Random joke

╭━━━━━━━━━━━━━━━━━╮
┃ Powered by Knight Bot
╰━━━━━━━━━━━━━━━━━╯
                    `.trim();
                    
                    await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                    break;

                case 'ping':
                    const start = Date.now();
                    await sock.sendMessage(from, { text: '📍 Pinging...' }, { quoted: msg });
                    const end = Date.now();
                    await sock.sendMessage(from, { text: `🏓 Pong!\nSpeed: ${end - start}ms` });
                    break;

                case 'alive':
                    await sock.sendMessage(from, { 
                        text: `✅ *Knight Bot is Online!*\n\n🤖 Bot is running smoothly.\n⏰ Server Time: ${new Date().toLocaleString()}` 
                    }, { quoted: msg });
                    break;

                case 'owner':
                    const ownerVcard = `BEGIN:VCARD
VERSION:3.0
FN:Knight Bot Owner
TEL;type=CELL;type=VOICE;waid=${config.ownerNumber[0]}:+${config.ownerNumber[0]}
END:VCARD`;
                    
                    await sock.sendMessage(from, {
                        contacts: {
                            displayName: 'Owner',
                            contacts: [{ vcard: ownerVcard }]
                        }
                    }, { quoted: msg });
                    break;

                case 'info':
                    const infoText = `
╭━━━━━━━━━━━━━━━━━╮
┃  🤖 *BOT INFO*
╰━━━━━━━━━━━━━━━━━╯

• Name: ${config.botName}
• Version: ${config.version}
• Platform: Render
• Library: Baileys
• Language: Node.js

╭━━━━━━━━━━━━━━━━━╮
┃ ✅ Status: Online
╰━━━━━━━━━━━━━━━━━╯
                    `.trim();
                    
                    await sock.sendMessage(from, { text: infoText }, { quoted: msg });
                    break;

                default:
                    // Unknown command - do nothing or send help
                    break;
            }
        } catch (error) {
            console.error('Error handling command:', error);
        }
    });

    return sock;
}

// ========== START BOT ==========
console.log('🚀 Starting Knight Bot...');
startBot().catch(err => {
    console.error('Failed to start bot:', err);
    process.exit(1);
});
