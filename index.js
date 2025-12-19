require('./settings')
const fs = require('fs')
const express = require('express')
const chalk = require('chalk')
const NodeCache = require('node-cache')
const pino = require('pino')
const store = require('./lib/lightweight_store')
const settings = require('./settings')
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main')
const { smsg } = require('./lib/myfunc')
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  delay
} = require('@whiskeysockets/baileys')

/* ================= WEB SERVER (UPTIME) ================= */
const app = express()
app.get('/', (_, res) => res.status(200).send('OK'))
app.get('/health', (_, res) => res.json({ status: 'alive', uptime: process.uptime() }))
app.listen(process.env.PORT || 3000, () => console.log('🌐 Web server running'))

/* ================= GLOBAL FLAGS ================= */
let sock
let starting = false
let reconnecting = false

/* ================= STORE ================= */
store.readFromFile()
setInterval(() => store.writeToFile(), 10_000)

/* ================= START BOT ================= */
async function startBot() {
  if (starting) return
  starting = true

  try {
    // ❗ Ensure session exists
    if (!fs.existsSync('./session/creds.json')) {
      console.error('❌ creds.json not found in session folder')
      process.exit(1)
    }

    const { version } = await fetchLatestBaileysVersion()
    const { state, saveCreds } = await useMultiFileAuthState('./session')
    const msgRetryCounterCache = new NodeCache()

    sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false, // ❌ NO QR
      browser: ['Ubuntu', 'Chrome', '20'],
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
      },
      msgRetryCounterCache,
      keepAliveIntervalMs: 25_000,
      markOnlineOnConnect: false,
      syncFullHistory: false
    })

    starting = false
    reconnecting = false

    sock.ev.on('creds.update', saveCreds)
    store.bind(sock.ev)
    sock.serializeM = m => smsg(sock, m, store)

    /* ================= MESSAGES ================= */
    sock.ev.on('messages.upsert', async ({ messages }) => {
      const m = messages?.[0]
      if (!m?.message) return
      m.message = m.message?.ephemeralMessage?.message || m.message
      try {
        await handleMessages(sock, { messages: [m] }, true)
      } catch (e) {
        console.error('Message error:', e)
      }
    })

    /* ================= CONNECTION ================= */
    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
      if (connection === 'open') {
        console.log(chalk.green('✅ WhatsApp Connected Successfully'))
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode
        console.log('❌ Connection closed:', code)

        try { sock.ws?.close() } catch {}

        // If session is invalid, stop (do NOT loop)
        if (code === DisconnectReason.loggedOut || code === 401) {
          console.error('❌ Session logged out. Re-upload valid session.')
          process.exit(1)
        }

        if (!reconnecting) {
          reconnecting = true
          console.log('🔄 Reconnecting in 15 seconds...')
          await delay(15_000)
          startBot()
        }
      }
    })

    /* ================= GROUP / STATUS ================= */
    sock.ev.on('group-participants.update', u => handleGroupParticipantUpdate(sock, u).catch(() => {}))
    sock.ev.on('status.update', s => handleStatus(sock, s).catch(() => {}))
    sock.ev.on('messages.reaction', r => handleStatus(sock, r).catch(() => {}))

  } catch (e) {
    console.error('Fatal error:', e)
    starting = false
    await delay(10_000)
    startBot()
  }
}

/* ================= RUN ================= */
startBot()
process.on('uncaughtException', e => console.error(e))
process.on('unhandledRejection', e => console.error(e))
