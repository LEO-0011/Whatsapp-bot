require('./settings')
require('http').createServer((_, r) => r.end('OK')).listen(process.env.PORT || 3000)

const fs = require('fs')
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
