require('./settings')
const fs = require('fs')
const chalk = require('chalk')
const NodeCache = require('node-cache')
const pino = require('pino')
const { rmSync } = require('fs')
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

/* ================= GLOBAL FLAGS ================= */
let sock = null
let starting = false
let reconnecting = false
let pairingInProgress = false

/* ================= STORE ================= */
store.readFromFile()
setInterval(() => store.writeToFile(), 10_000)

/* ================= START BOT ================= */
async function startBot() {
  if (starting) return
  starting = true

  try {
    const { version } = await fetchLatestBaileysVersion()
    const { state, saveCreds } = await useMultiFileAuthState('./session')
    const msgRetryCounterCache = new NodeCache()

    sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false, // ❌ QR disabled
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

    /* ================= PAIRING CODE LOGIN ================= */
    if (!state.creds.registered) {
      pairingInProgress = true

      const phone = (process.env.PAIRING_NUMBER || '').replace(/[^0-9]/g, '')
      if (!phone) {
        console.error('❌ PAIRING_NUMBER env variable not set')
        process.exit(1)
      }

      console.log('📲 Requesting pairing code...')
      const code = await sock.requestPairingCode(phone)
      const formatted = code?.match(/.{1,4}/g)?.join('-') || code

      console.log('\n==============================')
      console.log('🔑 PAIRING CODE:', chalk.green(formatted))
      console.log('==============================\n')
      console.log('⏳ Waiting up to 3 minutes for WhatsApp confirmation')
      console.log('⚠️ DO NOT redeploy or restart during this time')

      // ⏱️ Give WhatsApp enough time (3 minutes)
      setTimeout(() => {
        pairingInProgress = false
        console.log('⌛ Pairing window expired (if not confirmed)')
      }, 180_000)
    }

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
        pairingInProgress = false
        console.log(chalk.green('✅ WhatsApp Connected Successfully'))
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode
        console.log('❌ Connection closed:', code)

        try { sock.ws?.close() } catch {}

        // 🚫 DO NOT reconnect while pairing
        if (pairingInProgress) {
          console.log('⏳ Pairing in progress — waiting, not reconnecting')
          return
        }

        if (code === DisconnectReason.loggedOut || code === 401) {
          console.log('🧹 Logged out, deleting session')
          rmSync('./session', { recursive: true, force: true })
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
