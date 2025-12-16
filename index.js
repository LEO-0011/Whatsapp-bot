require('./settings')
const fs = require('fs')
const chalk = require('chalk')
const NodeCache = require('node-cache')
const pino = require('pino')
const readline = require('readline')
const { rmSync } = require('fs')
const store = require('./lib/lightweight_store')
const settings = require('./settings')
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main')
const PhoneNumber = require('awesome-phonenumber')
const { smsg } = require('./lib/myfunc')
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, jidDecode, jidNormalizedUser, makeCacheableSignalKeyStore, delay } = require('@whiskeysockets/baileys')

/* ===================== GLOBAL SINGLETONS ===================== */
let xeonSocket = null
let isStarting = false
let reconnecting = false

/* ===================== STORE ===================== */
store.readFromFile()
setInterval(() => store.writeToFile(), 10_000)

/* ===================== MEMORY SAFETY ===================== */
setInterval(() => {
  const used = process.memoryUsage().rss / 1024 / 1024
  if (used > 650) {
    console.log('⚠️ High RAM, restarting safely')
    process.exit(1)
  }
}, 30_000)

/* ===================== CLI INPUT ===================== */
const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null
const question = (q) => rl ? new Promise(r => rl.question(q, r)) : Promise.resolve(settings.ownerNumber)

/* ===================== MAIN BOT ===================== */
async function startXeonBotInc() {
  if (isStarting) return
  isStarting = true

  try {
    const { version } = await fetchLatestBaileysVersion()
    const { state, saveCreds } = await useMultiFileAuthState('./session')
    const msgRetryCounterCache = new NodeCache()

    const sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: true,
      browser: ['Ubuntu', 'Chrome', '20'],
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
      },
      markOnlineOnConnect: false,
      syncFullHistory: false,
      msgRetryCounterCache,
      keepAliveIntervalMs: 25_000
    })

    xeonSocket = sock
    isStarting = false
    reconnecting = false

    sock.ev.on('creds.update', saveCreds)
    store.bind(sock.ev)

    sock.decodeJid = (jid) => {
      if (!jid) return jid
      if (/:\\d+@/gi.test(jid)) {
        const d = jidDecode(jid) || {}
        return (d.user && d.server) ? `${d.user}@${d.server}` : jid
      }
      return jid
    }

    sock.serializeM = (m) => smsg(sock, m, store)

    /* ===================== MESSAGES ===================== */
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

    /* ===================== CONNECTION ===================== */
    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
      if (connection === 'open') {
        console.log(chalk.green('✅ WhatsApp Connected'))
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode
        console.log('❌ Connection closed:', code)

        try { sock.ws?.close() } catch {}

        if (code === DisconnectReason.loggedOut || code === 401) {
          console.log('🧹 Logged out, deleting session')
          rmSync('./session', { recursive: true, force: true })
          process.exit(1)
        }

        if (!reconnecting) {
          reconnecting = true
          console.log('🔄 Reconnecting in 8s...')
          await delay(8000)
          startXeonBotInc()
        }
      }
    })

    /* ===================== GROUP / STATUS ===================== */
    sock.ev.on('group-participants.update', async (u) => handleGroupParticipantUpdate(sock, u).catch(() => {}))
    sock.ev.on('status.update', async (s) => handleStatus(sock, s).catch(() => {}))
    sock.ev.on('messages.reaction', async (r) => handleStatus(sock, r).catch(() => {}))

  } catch (e) {
    console.error('Fatal start error:', e)
    isStarting = false
    await delay(10_000)
    startXeonBotInc()
  }
}

/* ===================== START ===================== */
startXeonBotInc()

/* ===================== SAFETY ===================== */
process.on('uncaughtException', err => console.error(err))
process.on('unhandledRejection', err => console.error(err))
