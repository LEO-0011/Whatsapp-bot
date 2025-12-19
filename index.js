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
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, delay } = require('@whiskeysockets/baileys')

/* ================= SINGLE INSTANCE GUARD ================= */
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
    const { version } = await fetchLatestBaileysVersion()
    const { state, saveCreds } = await useMultiFileAuthState('./session')
    const msgRetryCounterCache = new NodeCache()

    sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,     // ❌ NO QR
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
      },
      browser: ['Ubuntu', 'Chrome', '20'],
      msgRetryCounterCache,
      keepAliveIntervalMs: 25_000
    })

    starting = false
    reconnecting = false

    sock.ev.on('creds.update', saveCreds)
    store.bind(sock.ev)

    sock.serializeM = m => smsg(sock, m, store)

    /* ================= PAIRING CODE LOGIN ================= */
    if (!state.creds.registered) {
      const phone = (process.env.PAIRING_NUMBER || '').replace(/[^0-9]/g, '')

      if (!phone) {
        console.error('❌ PAIRING_NUMBER env variable not set')
        process.exit(1)
      }

      console.log(chalk.yellow('📲 Requesting pairing code...'))

      const code = await sock.requestPairingCode(phone)
      const formatted = code?.match(/.{1,4}/g)?.join('-') || code

      console.log('\n==============================')
      console.log('🔑 PAIRING CODE:', chalk.green(formatted))
      console.log('==============================\n')

      console.log(
        chalk.cyan(
          'WhatsApp → Settings → Linked Devices → Link a device → Link with phone number'
        )
      )
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
        console.log(chalk.green('✅ WhatsApp Connected Successfully'))
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode
        console.log('❌ Connection closed:', code)

        try { sock.ws?.close() } catch {}

        if (code === DisconnectReason.loggedOut || code === 401) {
          rmSync('./session', { recursive: true, force: true })
          process.exit(1)
        }

        if (!reconnecting) {
          reconnecting = true
          console.log('🔄 Reconnecting in 8s...')
          await delay(8000)
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
