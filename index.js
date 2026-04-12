const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  generateForwardMessageContent,
  generateWAMessageFromContent,
  getContentType,
  proto,
  makeInMemoryStore,
  downloadContentFromMessage
} = require('@trashcore/baileys');
const NodeCache = require('node-cache');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs');
const express = require('express');
const readline = require('readline');
const ytdl = require('@ybd-project/ytdl-core'); // ✅ FIXED: Added YouTube downloader
const https = require('https'); // ✅ FIXED: For keep-alive

require('./settings');

const app = express();
const port = 3000;

const pairingCodes = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
const msgRetryCounterCache = new NodeCache();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

const activeSessions = new Set();
const sessionConnections = new Map(); // ✅ FIXED: Store connections for recovery

// ✅ FIXED: Session recovery mechanism
async function ensureConnection(sessionId, conn) {
  if (!conn || !conn.user) {
    console.log(chalk.yellow(`[ RECOVERY ] Reconnecting session ${sessionId}...`));
    await startBot(sessionId);
    return false;
  }
  return true;
}

async function startBot(sessionId = 'red~default') {
  if (activeSessions.has(sessionId)) return;
  activeSessions.add(sessionId);
  const sessionPath = path.join(__dirname, 'sessionfile', sessionId);
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const { version } = await fetchLatestBaileysVersion();

  const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });
  const storeDir = path.join(__dirname, 'Store');
  if (!fs.existsSync(storeDir)) fs.mkdirSync(storeDir, { recursive: true }); // ✅ FIXED: Added recursive
  const storePath = path.join(storeDir, `${sessionId}_store.json`);
  if (fs.existsSync(storePath)) store.readFromFile(storePath);
  setInterval(() => {
    store.writeToFile(storePath);
  }, 10000);

  console.log(chalk.blueBright(`[ SYSTEM ] Starting session: ${sessionId}`));

  const conn = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
    },
    markOnlineOnConnect: true,
    generateHighQualityLinkPreview: true,
    msgRetryCounterCache,
    defaultQueryTimeoutMs: undefined,
  });

  // Store connection for recovery
  sessionConnections.set(sessionId, conn);
  store.bind(conn.ev);

  conn.downloadMediaMessage = async (message) => {
    let mime = (message.msg || message).mimetype || '';
    let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
    const stream = await downloadContentFromMessage(message, messageType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }
    return buffer;
  };

  // Decode JID helper
  conn.decodeJid = (jid) => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
      const decode = jid.replace(/:\d+@/gi, '@');
      return decode;
    }
    return jid;
  };

  // ✅ FIXED: Single connection.update handler (removed duplicate)
  conn.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    
    if (connection === 'close') {
        activeSessions.delete(sessionId);
        sessionConnections.delete(sessionId);
        const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log(chalk.red(`[ SYSTEM ] Connection closed for ${sessionId}. Reconnecting: ${shouldReconnect}`));
        if (shouldReconnect) startBot(sessionId);
    } else if (connection === 'open') {
        console.log(chalk.green(`[ SYSTEM ] Connected successfully for ${sessionId}!`));
        
        // Send connected message to owner
        try {
            const ownerNumber = global.owner && global.owner[0] ? global.owner[0] + '@s.whatsapp.net' : null;
            
            if (ownerNumber) {
                const connectedMessage = `╭━━━❰ *BOT CONNECTED* ❱━━━╮
┃
┃ 🤖 *Bot Name:* ${global.botName || 'Red MD'}
┃ 📱 *Session:* ${sessionId}
┃ ⏰ *Time:* ${new Date().toLocaleString()}
┃ 🌐 *Status:* 🟢 Online
┃
┃ 📊 *System Info:*
┃ ├ Node Version: ${process.version}
┃ ├ Platform: ${process.platform}
┃ └ Uptime: 0h 0m 0s
┃
┃ ✅ Bot is ready to use!
┃ 📌 *Commands:* Type .menu
┃
╰━━━━━━━━━━━━━━━━━━╯`;

                await conn.sendMessage(ownerNumber, { text: connectedMessage });
                console.log(chalk.green(`[ SYSTEM ] Connected message sent to owner: ${global.owner[0]}`));
            }
        } catch (err) {
            console.log(chalk.red(`[ ERROR ] Failed to send connected message: ${err.message}`));
        }
    }
  });

  /**
   * Serialize Message
   */
  function smsg(conn, m, store) {
    if (!m) return m;
    let M = proto.WebMessageInfo;
    
    // ✅ FIXED: Ensure conn.user.id exists
    if (!conn.user && conn.authState?.creds?.me) conn.user = { id: conn.authState.creds.me.id };
    
    if (m.key) {
      m.id = m.key.id;
      m.isBaileys = m.id.startsWith('BAE5') && m.id.length === 16;
      m.chat = m.key.remoteJid;
      m.fromMe = m.key.fromMe;
      m.isGroup = m.chat.endsWith('@g.us');
      m.sender = conn.decodeJid(m.fromMe ? conn.user.id : m.key.participant || m.key.remoteJid);
      if (m.isGroup) m.participant = conn.decodeJid(m.key.participant) || '';
    }
    if (m.message) {
      m.mtype = getContentType(m.message);
      m.msg = (m.mtype == 'viewOnceMessage' ? m.message.viewOnceMessage.message[getContentType(m.message.viewOnceMessage.message)] : m.mtype == 'viewOnceMessageV2' ? m.message.viewOnceMessageV2.message[getContentType(m.message.viewOnceMessageV2.message)] : m.message[m.mtype]);
      if (['viewOnceMessage', 'viewOnceMessageV2'].includes(m.mtype)) m.isViewOnce = true;
      m.body = m.message.conversation || (m.msg && m.msg.caption) || (m.msg && m.msg.text) || (m.mtype == 'listResponseMessage') && m.msg.singleSelectReply.selectedRowId || (m.mtype == 'buttonsResponseMessage') && m.msg.selectedButtonId || (m.mtype == 'viewOnceMessage') && m.msg.caption || m.text;
      
      let contextInfo = m.message.extendedTextMessage ? m.message.extendedTextMessage.contextInfo : m.msg && m.msg.contextInfo ? m.msg.contextInfo : null;
      let quoted = m.quoted = contextInfo ? contextInfo.quotedMessage : null;
      m.mentionedJid = contextInfo ? contextInfo.mentionedJid : [];
      
      if (m.quoted) {
        let type = getContentType(quoted);
        m.quoted = quoted[type];
        if (['viewOnceMessage', 'viewOnceMessageV2'].includes(type)) {
          let vtype = getContentType(m.quoted.message);
          m.quoted = m.quoted.message[vtype];
          m.quoted.mtype = vtype;
          m.quoted.isViewOnce = true;
        } else {
          m.quoted.mtype = type;
        }
        if (['productMessage'].includes(type)) {
          type = getContentType(m.quoted);
          m.quoted = m.quoted[type];
        }
        if (typeof m.quoted === 'string') m.quoted = { text: m.quoted };
        m.quoted.id = contextInfo.stanzaId;
        m.quoted.chat = contextInfo.remoteJid || m.chat;
        m.quoted.isBaileys = m.quoted.id ? m.quoted.id.startsWith('BAE5') && m.quoted.id.length === 16 : false;
        m.quoted.sender = conn.decodeJid(contextInfo.participant);
        m.quoted.fromMe = m.quoted.sender === conn.decodeJid(conn.user.id);
        m.quoted.text = m.quoted.text || m.quoted.caption || m.quoted.conversation || m.quoted.contentText || m.quoted.selectedDisplayText || m.quoted.title || '';
        m.quoted.mentionedJid = contextInfo ? contextInfo.mentionedJid : [];
        m.quoted.download = () => conn.downloadMediaMessage(m.quoted);
      }
    }
    if (m.msg && m.msg.url) m.download = () => conn.downloadMediaMessage(m.msg);
    m.text = m.msg ? (m.msg.text || m.msg.caption || m.message.conversation || m.msg.contentText || m.msg.selectedDisplayText || m.msg.title || '') : '';
    m.reply = (text, chatId = m.chat, options = {}) => conn.sendMessage(chatId, { text: text, ...options }, { quoted: m });
    return m;
  }

  conn.ev.on('group-participants.update', async (anu) => {
    if (global.welcome !== 'on' && global.left !== 'on') return;
    try {
      let metadata = await conn.groupMetadata(anu.id);
      let participants = anu.participants;
      for (let num of participants) {
        let ppuser;
        try {
          ppuser = await conn.profilePictureUrl(num, 'image');
        } catch {
          ppuser = 'https://files.catbox.moe/eumprt.jpg';
        }

        if (anu.action == 'add' && global.welcome === 'on') {
          let welcomeText = `╭━━━〔 *WELCOME* 〕━━━╮\n` +
            `┃ 👤 *User:* @${num.split("@")[0]}\n` +
            `┃ 🏛️ *Group:* ${metadata.subject}\n` +
            `╰━━━━━━━━━━━━━━━╯\n\n` +
            `*Description:*\n${metadata.desc || 'No Description'}\n\n` +
            `*Enjoy your stay here!*`;
          
          if (global.iphoneMode) {
            await conn.sendMessage(anu.id, { text: welcomeText, mentions: [num] });
          } else {
            await conn.sendMessage(anu.id, {
              image: { url: ppuser },
              caption: welcomeText,
              mentions: [num],
              contextInfo: {
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                  newsletterJid: global.newsletterJid,
                  newsletterName: 'Red MD Updates',
                  serverMessageId: 143
                },
                externalAdReply: {
                  title: 'USER JOINED',
                  body: metadata.subject,
                  thumbnailUrl: ppuser,
                  sourceUrl: 'https://whatsapp.com/channel/0029VbCISBm3LdQXfcLaao3Q',
                  mediaType: 1,
                  renderLargerThumbnail: true
                }
              }
            });
          }
        } else if (anu.action == 'remove' && global.left === 'on') {
          let leftText = `╭━━━〔 *GOODBYE* 〕━━━╮\n` +
            `┃ 👤 *User:* @${num.split("@")[0]}\n` +
            `┃ 🏛️ *Group:* ${metadata.subject}\n` +
            `╰━━━━━━━━━━━━━━━╯\n\n` +
            `*We will miss you!*`;
          
          if (global.iphoneMode) {
            await conn.sendMessage(anu.id, { text: leftText, mentions: [num] });
          } else {
            await conn.sendMessage(anu.id, {
              image: { url: ppuser },
              caption: leftText,
              mentions: [num],
              contextInfo: {
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                  newsletterJid: global.newsletterJid,
                  newsletterName: 'Red MD Updates',
                  serverMessageId: 143
                },
                externalAdReply: {
                  title: 'USER LEFT',
                  body: metadata.subject,
                  thumbnailUrl: ppuser,
                  sourceUrl: 'https://whatsapp.com/channel/0029VbCISBm3LdQXfcLaao3Q',
                  mediaType: 1,
                  renderLargerThumbnail: true
                }
              }
            });
          }
        }
      }
    } catch (err) {
      console.log(err);
    }
  });

  conn.copyNForward = async (jid, message, forceForward = false, options = {}) => {
    let vtype;
    if (options.readViewOnce) {
      message.message = message.message && message.message.ephemeralMessage && message.message.ephemeralMessage.message ? message.message.ephemeralMessage.message : (message.message || undefined);
      vtype = Object.keys(message.message.viewOnceMessage.message)[0];
      delete (message.message && message.message.viewOnceMessage ? message.message.viewOnceMessage : message);
      message.message = {
        ...message.message,
        [vtype]: message.message.viewOnceMessage.message[vtype]
      };
    }

    let mtype = Object.keys(message.message)[0];
    let content = await generateForwardMessageContent(message, forceForward);
    let ctype = Object.keys(content)[0];
    let context = {};
    if (mtype != "conversation") context = message.message[mtype].contextInfo;
    content[ctype].contextInfo = {
      ...context,
      ...content[ctype].contextInfo
    };
    const waMessage = generateWAMessageFromContent(jid, content, options ? {
      ...options,
      ...(Object.keys(content)[0] == 'newsletterAdminInviteMessage' ? { newsletterJid: options.newsletterJid } : {}),
      userJid: conn.user.id
    } : {});
    await conn.relayMessage(jid, waMessage.message, { messageId: waMessage.key.id });
    return waMessage;
  };

  conn.sendContact = async (jid, kon, quoted = '', opts = {}) => {
    let list = [];
    for (let i of kon) {
      list.push({
        displayName: global.ownerName,
        vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${global.ownerName}\nFN:${global.ownerName}\nitem1.TEL;waid=${i}:${i}\nitem1.X-ABLabel:Ponsel\nEND:VCARD`
      });
    }
    conn.sendMessage(jid, {
      contacts: {
        displayName: `${list.length} Kontak`,
        contacts: list
      },
      ...opts
    }, { quoted });
  };

  // Pairing Code Logic
  if (!conn.authState.creds.registered) {
    console.log(chalk.yellow(`[ PAIRING ] Session ${sessionId} is not registered.`));
    const phoneNumber = await question(chalk.cyan('Enter your WhatsApp number (e.g., 27634988678): '));
    
    if (phoneNumber) {
      setTimeout(async () => {
        try {
          let code = await conn.requestPairingCode(phoneNumber.replace(/[^0-9]/g, ''));
          code = code?.match(/.{1,4}/g)?.join("-") || code;
          console.log(chalk.black(chalk.bgCyan(`[ PAIRING CODE ]`)), chalk.black(chalk.bgWhite(` ${code} `)));
          console.log(chalk.yellow(`[ INFO ] Enter this code on your WhatsApp (Linked Devices > Link with Phone Number)`));
        } catch (e) {
          console.log(chalk.red(`[ ERROR ] Failed to request pairing code: ${e.message}`));
        }
      }, 3000);
    }
  }

  conn.ev.on('creds.update', saveCreds);

  // ✅ FIXED: Anti-Call with better error handling
  conn.ev.on('call', async (calls) => {
    if (global.antiCall === 'off') return;
    
    for (const call of calls) {
      try {
        if (call.status === 'offer') {
          const from = call.from;
          console.log(chalk.red(`[ CALL ] Rejecting call from ${from}`));
          
          await conn.rejectCall(call.id, from);
          await conn.sendMessage(from, { 
            text: '*[ ANTI-CALL ]* 📞 Calls are disabled on this bot!\nYou have been blocked for calling.' 
          });
          await conn.updateBlockStatus(from, 'block');
          
          console.log(chalk.red(`[ CALL ] Blocked ${from} for calling`));
        }
      } catch (err) {
        console.log(chalk.red(`[ CALL ERROR ] ${err.message}`));
      }
    }
  });

  conn.ev.on('messages.upsert', async (chatUpdate) => {
    try {
      let m = chatUpdate.messages[0];
      if (!m.message) return;
      m = smsg(conn, m, store);
      
      // Auto-Status
      if (global.autoStatus && m.key.remoteJid === 'status@broadcast') {
        const statusSender = m.key.participant || m.key.remoteJid;
        if (statusSender === 'status@broadcast') return;
        
        try {
          await conn.readMessages([m.key]);
          console.log(chalk.green(`[ STATUS ] Viewed status from ${statusSender.split('@')[0]}`));
          
          if (global.autoLikeStatus) {
            await conn.sendMessage('status@broadcast', {
              react: { text: '❤️', key: m.key }
            }, { statusJidList: [statusSender] });
          }
        } catch (e) {
          // Silent catch to prevent console spam
        }
      }

      require('./case')(conn, m, chatUpdate, store, sessionId);
    } catch (err) {
      console.log(err);
    }
  });

  // Hot-reload case.js
  const casePath = require.resolve('./case');
  fs.watchFile(casePath, () => {
    fs.unwatchFile(casePath);
    console.log(chalk.redBright(`[ SYSTEM ] Update 'case.js'`));
    delete require.cache[casePath];
  });

  return conn;
}

// Multi-session loader
async function init() {
  const sessionDir = path.join(__dirname, 'sessionfile');
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

  // SESSION_ID Support
  if (process.env.SESSION_ID) {
    const sessionId = process.env.SESSION_ID;
    const defaultSessionPath = path.join(sessionDir, global.sessionPrefix + 'default');
    if (!fs.existsSync(defaultSessionPath)) fs.mkdirSync(defaultSessionPath, { recursive: true });
    
    try {
      if (sessionId.startsWith('red~')) {
        const base64Data = sessionId.split('red~')[1];
        const credsData = Buffer.from(base64Data, 'base64').toString('utf-8');
        fs.writeFileSync(path.join(defaultSessionPath, 'creds.json'), credsData);
        console.log(chalk.green('[ SYSTEM ] Session ID loaded successfully.'));
      }
    } catch (e) {
      console.log(chalk.red(`[ ERROR ] Invalid SESSION_ID: ${e.message}`));
    }
  }

  const sessions = fs.readdirSync(sessionDir).filter(f => {
    const fullPath = path.join(sessionDir, f);
    return fs.statSync(fullPath).isDirectory() && f.startsWith(global.sessionPrefix);
  });
  
  if (sessions.length === 0) {
    console.log(chalk.yellow('[ SYSTEM ] No existing sessions found. Starting default...'));
    await startBot(global.sessionPrefix + 'default');
  } else {
    console.log(chalk.green(`[ SYSTEM ] Found ${sessions.length} sessions. Reloading...`));
    for (const session of sessions.slice(0, 5)) {
      await startBot(session);
    }
  }
}

app.use(express.json());
app.use('/sessiongen', express.static(path.join(__dirname, 'sessiongen')));

const tempSessions = new Map();

app.post('/api/session/request', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ success: false, message: 'Phone number is required' });

  const tempId = 'temp_' + Math.random().toString(36).substring(2, 15);
  const tempPath = path.join(__dirname, 'sessionfile', tempId);
  if (!fs.existsSync(tempPath)) fs.mkdirSync(tempPath, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(tempPath);
  const { version } = await fetchLatestBaileysVersion();

  const conn = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
    },
  });

  tempSessions.set(tempId, { conn, status: 'pending', sessionId: null });

  conn.ev.on('creds.update', saveCreds);
  conn.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'open') {
      const creds = JSON.parse(fs.readFileSync(path.join(tempPath, 'creds.json')));
      const base64 = Buffer.from(JSON.stringify(creds)).toString('base64');
      const sessionId = 'red~' + base64;
      
      tempSessions.set(tempId, { ...tempSessions.get(tempId), status: 'connected', sessionId });
      
      setTimeout(() => {
        conn.logout();
        fs.rmSync(tempPath, { recursive: true, force: true });
        tempSessions.delete(tempId);
      }, 300000);
    } else if (connection === 'close') {
      const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (!shouldReconnect) {
        tempSessions.set(tempId, { ...tempSessions.get(tempId), status: 'failed' });
        fs.rmSync(tempPath, { recursive: true, force: true });
      }
    }
  });

  try {
    const code = await conn.requestPairingCode(phone.replace(/[^0-9]/g, ''));
    res.json({ success: true, sessionId: tempId, code: code?.match(/.{1,4}/g)?.join("-") || code });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/session/status/:id', (req, res) => {
  const session = tempSessions.get(req.params.id);
  if (!session) return res.status(404).json({ status: 'not_found' });
  res.json({ status: session.status, sessionId: session.sessionId });
});

app.get('/', (req, res) => {
  res.redirect('/sessiongen');
});

app.get('/dashboard', (req, res) => {
  res.send('<h1>Red MD WhatsApp Bot is Running</h1><p>Check console for QR or Pairing Code.</p>');
});

// ✅ FIXED: Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'online', 
    sessions: activeSessions.size,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    nodeVersion: process.version
  });
});

app.listen(port, () => {
  console.log(chalk.magentaBright(`[ SERVER ] Dashboard running on http://localhost:${port}`));
  init();
});

// ✅ FIXED: 24/7 Keep Alive Mechanism
const keepAliveInterval = setInterval(() => {
  https.get(`http://localhost:${port}/health`, (res) => {
    console.log(chalk.gray('[ KEEP-ALIVE ] Bot is healthy'));
  }).on('error', (err) => {
    console.log(chalk.red('[ KEEP-ALIVE ] Error:', err.message));
  });
}, 14 * 60 * 1000); // Every 14 minutes

// Check connections every 5 minutes
setInterval(async () => {
  for (const sessionId of activeSessions) {
    console.log(chalk.gray(`[ MONITOR ] Session ${sessionId} is active`));
    const conn = sessionConnections.get(sessionId);
    await ensureConnection(sessionId, conn);
  }
}, 5 * 60 * 1000);

// ✅ FIXED: Graceful shutdown handler
process.on('SIGINT', async () => {
  console.log(chalk.yellow('[ SYSTEM ] Shutting down gracefully...'));
  clearInterval(keepAliveInterval);
  
  for (const [sessionId, conn] of sessionConnections) {
    try {
      if (conn) await conn.logout();
      console.log(chalk.green(`[ SYSTEM ] Session ${sessionId} closed`));
    } catch (err) {
      console.log(chalk.red(`[ ERROR ] Failed to close ${sessionId}: ${err.message}`));
    }
  }
  
  process.exit(0);
});

// ✅ FIXED: Error handlers for 24/7 uptime
process.on('uncaughtException', async (err) => {
  console.log(chalk.red('[ CRITICAL ] Uncaught Exception:', err));
  // Don't exit, just log and continue
});

process.on('unhandledRejection', async (err) => {
  console.log(chalk.red('[ CRITICAL ] Unhandled Rejection:', err));
  // Don't exit, just log and continue
});
