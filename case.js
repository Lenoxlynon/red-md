const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { getContentType, generateWAMessageFromContent, proto } = require('@trashcore/baileys');

// Message Cache for Anti-Delete
const messageCache = new Map();

// Cache for AFK and Premium
let afkCache = null;
let lastAfkRead = 0;
let premiumCache = null;
let lastPremiumRead = 0;

function getAfkData() {
  const now = Date.now();
  if (!afkCache || now - lastAfkRead > 5000) {
    const afkPath = './Data/afk.json';
    if (!fs.existsSync(afkPath)) fs.writeFileSync(afkPath, '{}');
    afkCache = JSON.parse(fs.readFileSync(afkPath));
    lastAfkRead = now;
  }
  return afkCache;
}

function saveAfkData(data) {
  afkCache = data;
  fs.writeFileSync('./Data/afk.json', JSON.stringify(data));
}

function getPremiumData() {
  const now = Date.now();
  if (!premiumCache || now - lastPremiumRead > 10000) {
    const premPath = './Data/premium.json';
    if (!fs.existsSync(premPath)) fs.writeFileSync(premPath, '[]');
    premiumCache = JSON.parse(fs.readFileSync(premPath));
    lastPremiumRead = now;
  }
  return premiumCache;
}

module.exports = async (jamesdev, m, chatUpdate, store, sessionId) => {
  try {
    if (!m) return;
    if (m.key && m.key.remoteJid === 'status@broadcast') return;
    if (!m.message) return;

    // Cache message for anti-delete (Store full message object)
    const msgId = m.key.id;
    if (!m.message.protocolMessage) {
      messageCache.set(msgId, m);
      if (messageCache.size > 2000) messageCache.delete(messageCache.keys().next().value);
    }

    const type = getContentType(m.message);
    const body = (type === 'conversation') ? m.message.conversation : (type === 'imageMessage') ? m.message.imageMessage.caption : (type === 'videoMessage') ? m.message.videoMessage.caption : (type === 'extendedTextMessage') ? m.message.extendedTextMessage.text : (type === 'buttonsResponseMessage') ? m.message.buttonsResponseMessage.selectedButtonId : (type === 'listResponseMessage') ? m.message.listResponseMessage.singleSelectReply.selectedRowId : (type === 'templateButtonReplyMessage') ? m.message.templateButtonReplyMessage.selectedId : (type === 'messageContextInfo') ? (m.message.buttonsResponseMessage?.selectedButtonId || m.message.listResponseMessage?.singleSelectReply.selectedRowId || m.text) : '';
    
    const prefix = global.prefix.find(p => body.startsWith(p)) || '';
    const isCmd = global.prefix.some(p => body.startsWith(p));
    const command = isCmd ? body.slice(prefix.length).trim().split(/ +/).shift().toLowerCase() : '';
    const args = body.trim().split(/ +/).slice(1);
    const text = args.join(' ');
    const q = text;
    
    // Non-prefix commands whitelist
    const nonPrefixCommands = ['menu', 'help', 'ping', 'runtime', 'owner', 'me', 'vv', 'viewonce', 'sticker', 's', 'take', 'steal'];
    const finalCommand = isCmd ? command : (nonPrefixCommands.includes(body.trim().toLowerCase().split(' ')[0]) ? body.trim().toLowerCase().split(' ')[0] : '');
    const from = m.key.remoteJid;
    const sender = m.key.fromMe ? jamesdev.decodeJid(jamesdev.user.id) : jamesdev.decodeJid(m.key.participant || m.key.remoteJid);
    const senderNumber = sender.split('@')[0];
    const jid = from;
    const isGroup = from.endsWith('@g.us');
    const groupMetadata = isGroup ? (store.groupMetadata[from] || await jamesdev.groupMetadata(from).catch(e => {})) : null;
    const groupName = isGroup ? groupMetadata?.subject || '' : '';
    const participants = isGroup ? groupMetadata?.participants || [] : [];
    const groupAdmins = isGroup ? participants.filter(v => v.admin).map(v => jamesdev.decodeJid(v.id)) : [];
    const botNumber = jamesdev.decodeJid(jamesdev.user.id);
    
    // Owner logic: paired number + global.owner
    const isOwner = global.owner.includes(senderNumber) || senderNumber === botNumber.split('@')[0] || m.key.fromMe;

    // Robust Admin Detection
    const isBotAdmin = isGroup ? participants.some(p => 
        p.admin && (
            jamesdev.decodeJid(p.id) === botNumber || 
            p.id.split('@')[0] === botNumber.split('@')[0]
        )
    ) : false;

    const isAdmin = isGroup ? (participants.some(p => 
        p.admin && (
            jamesdev.decodeJid(p.id) === sender || 
            p.id.split('@')[0] === senderNumber
        )
    ) || isOwner) : false;
    
    // Mode Logic
    if (global.mode === 'self' && !isOwner) return;

    // Ensure Data directory exists
    if (!fs.existsSync('./Data')) fs.mkdirSync('./Data');

    const isPrem = getPremiumData().includes(senderNumber) || isOwner;

    // Helper to reply with Newsletter Forwarding and Thumbnail
    m.reply = (text, options = {}) => {
      const isIphone = global.iphoneMode === true || global.iphoneMode === 'true';
      const mentions = options.mentions || m.mentionedJid || [];
      if (isIphone) {
        return jamesdev.sendMessage(from, { text: text, mentions: mentions, ...options }, { quoted: m });
      }
      return jamesdev.sendMessage(from, { 
        text: text,
        mentions: mentions,
        ...options,
        contextInfo: {
          forwardingScore: 999,
          isForwarded: true,
          forwardedNewsletterMessageInfo: {
            newsletterJid: global.newsletterJid,
            newsletterName: 'Red MD Updates',
            serverMessageId: 143
          },
          externalAdReply: {
            title: global.botName,
            body: 'Verified Business Bot',
            thumbnailUrl: global.thumb,
            sourceUrl: 'https://whatsapp.com/channel/0029VbCISBm3LdQXfcLaao3Q',
            mediaType: 1,
            renderLargerThumbnail: true
          }
        }
      }, { quoted: m });
    };

    // Coloured Console
    if (finalCommand) {
      console.log(chalk.black(chalk.bgWhite('[ COMMAND ]')), chalk.black(chalk.bgGreen(new Date().toLocaleString())), chalk.black(chalk.bgBlue(finalCommand)), 'from', chalk.black(chalk.bgYellow(sender)), 'in', chalk.black(chalk.bgCyan(isGroup ? groupName : 'Private Chat')), chalk.magenta(`(Session: ${sessionId})`));
    }

    // Auto Features (Non-blocking)
    if (global.autoOnline) jamesdev.sendPresenceUpdate('available', from).catch(() => {});
    if (global.autoType) jamesdev.sendPresenceUpdate('composing', from).catch(() => {});
    if (global.autoRecord) jamesdev.sendPresenceUpdate('recording', from).catch(() => {});
    if (global.autoRead) jamesdev.readMessages([m.key]).catch(() => {});

    // Auto Join
    if (global.autoJoin && body.match(/chat.whatsapp.com\/([0-9A-Za-z]{20,24})/i)) {
      const [_, code] = body.match(/chat.whatsapp.com\/([0-9A-Za-z]{20,24})/i);
      await jamesdev.groupAcceptInvite(code).then(() => {
        console.log(chalk.green(`[ SYSTEM ] Auto Joined Group via Link`));
      }).catch(() => {});
    }

    // Parse Mentions from Text
    const mentions = [...text.matchAll(/@([0-9]{5,16}|0)/g)].map(v => v[1] + '@s.whatsapp.net');
    if (mentions.length > 0) {
      m.mentionedJid = [...new Set([...(m.mentionedJid || []), ...mentions])];
    }

    // Anti-Delete Logic (Improved)
    if (type === 'protocolMessage' && m.message.protocolMessage.type === 0) {
      const deletedId = m.message.protocolMessage.key.id;
      const deletedMsg = messageCache.get(deletedId);
      if (deletedMsg && global.antiDelete === 'on') {
        const deletedSender = deletedMsg.key.participant || deletedMsg.key.remoteJid;
        let deleteText = `*[ ANTI-DELETE ]*\nUser: @${deletedSender.split('@')[0]}\nTime: ${new Date().toLocaleString()}\n\nMessage Captured:`;
        await jamesdev.sendMessage(from, { text: deleteText, mentions: [deletedSender] }, { quoted: deletedMsg });
        await jamesdev.copyNForward(from, deletedMsg, true);
      }
    }

    // Anti-Features Logic (Enhanced for Group & DM)
    let antiTriggered = false;
    if (!isOwner) {
      const handleAntiAction = async (action, reason) => {
        if (action === 'off' || antiTriggered) return;
        antiTriggered = true;
        await jamesdev.sendMessage(from, { delete: m.key });
        if (isGroup) {
          if (action === 'warn' || action === 'del') {
            m.reply(`*[ ${reason} ]* @${sender.split('@')[0]} Warning! Links/Tags are not allowed.`, { mentions: [sender] });
          } else if (action === 'kick' && isBotAdmin) {
            await m.reply(`*[ ${reason} ]* Kicking @${sender.split('@')[0]} for violating group rules.`, { mentions: [sender] });
            await jamesdev.groupParticipantsUpdate(from, [sender], 'remove');
          }
        } else {
          if (action === 'warn' || action === 'del') {
            m.reply(`*[ ${reason} ]* Warning! Links are not allowed in DM.`);
          } else if (action === 'block') {
            await m.reply(`*[ ${reason} ]* You have been blocked for sending links.`);
            await jamesdev.updateBlockStatus(sender, 'block');
          }
        }
      };

      // Anti-Link
      if (!antiTriggered && isGroup && global.antiLink !== 'off' && body.match(/chat.whatsapp.com|wa.me|whatsapp.com/gi)) {
        await handleAntiAction(global.antiLink, 'ANTI-LINK');
      }
      // Anti-Tag
      if (!antiTriggered && isGroup && global.antiTag !== 'off' && m.mentionedJid?.length > 10) {
        await handleAntiAction(global.antiTag, 'ANTI-TAG');
      }
      // Anti-Bot
      if (!antiTriggered && isGroup && global.antiBot !== 'off' && m.id.startsWith('BAE5') && m.id.length === 16) {
        await handleAntiAction('kick', 'ANTI-BOT');
      }
      // Anti-Media
      if (!antiTriggered && isGroup && global.antiMedia !== 'off' && (m.mtype === 'imageMessage' || m.mtype === 'videoMessage' || m.mtype === 'audioMessage' || m.mtype === 'stickerMessage')) {
        await handleAntiAction(global.antiMedia, 'ANTI-MEDIA');
      }
      // Anti-Badword
      if (!antiTriggered && isGroup && global.antiBadword !== 'off') {
        const badwords = ['fuck', 'bitch', 'asshole', 'pussy', 'dick'];
        if (badwords.some(word => body.toLowerCase().includes(word))) {
          await handleAntiAction(global.antiBadword, 'ANTI-BADWORD');
        }
      }
      // Anti-Scam
      if (!antiTriggered && isGroup && global.antiScam !== 'off' && body.match(/free|gift|win|prize|money|crypto|investment/gi)) {
        await handleAntiAction(global.antiScam, 'ANTI-SCAM');
      }
      // Anti-Virus/Bug
      if (!antiTriggered && isGroup && (global.antiVirus !== 'off' || global.antiBug !== 'off') && body.length > 10000) {
        await handleAntiAction(global.antiVirus !== 'off' ? global.antiVirus : global.antiBug, 'ANTI-VIRUS/BUG');
      }
    }
    if (antiTriggered) return;

    // AFK Logic
    let afk = getAfkData();

    if (afk[sender]) {
      const afkTime = Date.now() - afk[sender].time;
      const afkReason = afk[sender].reason;
      delete afk[sender];
      saveAfkData(afk);
      m.reply(`*[ AFK ]* Welcome back @${sender.split('@')[0]}! You were AFK for ${Math.floor(afkTime / 1000)} seconds.\nReason: ${afkReason}`, { mentions: [sender] });
    }

    if (m.mentionedJid) {
      for (let jid of m.mentionedJid) {
        if (afk[jid]) {
          const afkTime = Date.now() - afk[jid].time;
          const afkReason = afk[jid].reason;
          m.reply(`*[ AFK ]* @${jid.split('@')[0]} is currently AFK.\nReason: ${afkReason}\nSince: ${Math.floor(afkTime / 1000)} seconds ago.`, { mentions: [jid] });
        }
      }
    }

    // Case Handler
    switch (finalCommand) {
      case 'menu':
      case 'help': {
        const menuText = `┏━━━〔 *${global.botName}* 〕━━━┓
┃ 👤 *Owner:* ${global.ownerName}
┃ 🏷️ *Prefix:* ${prefix || 'None'}
┃ 👤 *User:* @${sender.split('@')[0]}
┃ 💎 *Status:* ${isPrem ? 'Premium' : 'Free'}
┗━━━━━━━━━━━━━━━━━━┛

┏━━━〔 *MAIN COMMANDS* 〕━━━┓
┃ ⚡ ping
┃ 🌍 public
┃ 🔒 self
┃ 📱 iphonemode
┃ 📊 status
┃ 🔄 refresh
┃ 🛠️ debugadmin
┃ ⌨️ setprefix
┃ 👤 owner
┃ 👤 me
┃ ⏳ runtime
┃ 📋 menu2
┗━━━━━━━━━━━━━━━━━━┛

┏━━━〔 *GROUP COMMANDS* 〕━━━┓
┃ ⬆️ promote
┃ ⬇️ demote
┃ 👋 welcome [on/off]
┃ 🚪 left [on/off]
┃ 👞 kick
┃ ➕ add
┃ 🏷️ hidetag
┃ 🔓 group [open/close]
┃ ✏️ setname
┃ ✏️ setdesc
┃ 🔗 linkgc
┃ 🔄 revoke
┃ 📢 tagall
┃ 🗑️ delete
┃ 👮 listadmin
┃ 🟢 listonline
┗━━━━━━━━━━━━━━━━━━┛

┏━━━〔 *TOOLS* 〕━━━┓
┃ 🖼️ sticker
┃ ✂️ take/steal
┃ 👁️ vv
┃ 👤 getpp
┃ 🖼️ toimg
┃ 🗣️ ttop
┃ 🔊 ttoaudio
┃ 🖼️ ttoimage
┃ 🧮 calc
┗━━━━━━━━━━━━━━━━━━┛

┏━━━〔 *OWNER COMMANDS* 〕━━━┓
┃ 💎 addprem
┃ 🗑️ delprem
┃ 💻 eval
┃ 🐚 shell
┃ 🔄 restart
┃ 📢 broadcast
┃ ✏️ setbotname
┃ 🖼️ setbotimage
┃ 🚫 block
┃ 🔓 unblock
┃ 📋 listsession
┗━━━━━━━━━━━━━━━━━━┛

┏━━━〔 *ANTI FEATURES* 〕━━━┓
┃ 🔗 antilink [warn/kick/del/off]
┃ 🤖 antibot [warn/kick/off]
┃ 🖼️ antimedia [warn/kick/off]
┃ 🏷️ antitag [warn/kick/off]
┃ 🤬 antibadword [warn/kick/off]
┃ 🛡️ antiscam [warn/kick/off]
┃ 🛡️ antivirus [warn/kick/off]
┃ 🛡️ antibug [warn/kick/off]
┃ 📞 anticall [on/off]
┃ 🗑️ antidelete [on/off]
┗━━━━━━━━━━━━━━━━━━┛
`;
        if (global.iphoneMode) {
          return m.reply(menuText, { mentions: [sender] });
        }
        await jamesdev.sendMessage(from, {
          image: { url: global.menuImage },
          caption: menuText,
          mentions: [sender],
          contextInfo: {
            forwardingScore: 999,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
              newsletterJid: global.newsletterJid,
              newsletterName: 'Red MD Updates',
              serverMessageId: 143
            },
            externalAdReply: {
              title: global.botName,
              body: 'Verified Business Bot',
              thumbnailUrl: global.thumb,
              sourceUrl: 'https://whatsapp.com/channel/0029VbCISBm3LdQXfcLaao3Q',
              mediaType: 1,
              renderLargerThumbnail: true
            }
          }
        }, { quoted: m });
        break;
      }

      case 'menu2': {
        const menuText = `┏━━━〔 *SELECTIVE MENU* 〕━━━┓
┃ Choose a category below:
┗━━━━━━━━━━━━━━━━━━┛`;

        if (global.iphoneMode) {
          return m.reply(menuText + '\n\n- .menu (Main Menu)');
        }

        const sections = [
          {
            title: 'BOT CATEGORIES',
            rows: [
              { title: 'Main Menu', rowId: `${prefix}menu`, description: 'Show all commands' },
              { title: 'Group Menu', rowId: `${prefix}help group`, description: 'Group management' },
              { title: 'Tools Menu', rowId: `${prefix}help tools`, description: 'Useful tools' },
              { title: 'Owner Menu', rowId: `${prefix}help owner`, description: 'Owner only commands' }
            ]
          }
        ];

        const listMessage = {
          text: menuText,
          footer: 'Red MD • Multi Device Bot',
          title: 'Red MD MENU',
          buttonText: 'SELECT CATEGORY',
          sections
        };

        await jamesdev.sendMessage(from, listMessage, { quoted: m });
        break;
      }

      case 'afk': {
        let afk = getAfkData();
        afk[sender] = {
          time: Date.now(),
          reason: text || 'No Reason'
        };
        saveAfkData(afk);
        m.reply(`*[ AFK ]* @${sender.split('@')[0]} is now AFK.\nReason: ${afk[sender].reason}`, { mentions: [sender] });
        break;
      }

      case 'ping': {
        const start = Date.now();
        await m.reply('🔥Testing speed...');
        const end = Date.now();
        m.reply(`> ⚡Red Speed: ${end - start}ms`);
        break;
      }

      case 'public': {
        if (!isOwner) return;
        global.mode = 'public';
        m.reply('*[ SYSTEM ]* Bot is now in Public Mode.');
        break;
      }

      case 'self': {
        if (!isOwner) return;
        global.mode = 'self';
        m.reply('*[ SYSTEM ]* Bot is now in Self Mode.');
        break;
      }

      case 'iphonemode': {
        if (!isOwner) return;
        if (args[0] === 'on') {
          global.iphoneMode = true;
          m.reply('*[ SYSTEM ]* iPhone Mode enabled (Plain text only).');
        } else if (args[0] === 'off') {
          global.iphoneMode = false;
          m.reply('*[ SYSTEM ]* iPhone Mode disabled (Rich media enabled).');
        } else {
          m.reply('Use on or off!');
        }
        break;
      }

      case 'status': {
        const statusText = `*[ BOT STATUS ]*
Mode: ${global.mode}
iPhone Mode: ${global.iphoneMode ? 'ON' : 'OFF'}
Auto Status: ${global.autoStatus ? 'ON' : 'OFF'}
Auto Read: ${global.autoRead ? 'ON' : 'OFF'}
Anti Delete: ${global.antiDelete}
Anti Link: ${global.antiLink}
`;
        m.reply(statusText);
        break;
      }

      case 'setowner': {
        if (!isOwner) return;
        if (!args[0]) return m.reply('Enter number!');
        const newOwner = args[0].replace(/[^0-9]/g, '');
        if (global.owner.includes(newOwner)) return m.reply('Already owner!');
        global.owner.push(newOwner);
        m.reply(`*[ SYSTEM ]* Added @${newOwner} as owner.`, { mentions: [newOwner + '@s.whatsapp.net'] });
        break;
      }

      case 'delowner': {
        if (!isOwner) return;
        if (!args[0]) return m.reply('Enter number!');
        const target = args[0].replace(/[^0-9]/g, '');
        if (!global.owner.includes(target)) return m.reply('Not an owner!');
        global.owner = global.owner.filter(o => o !== target);
        m.reply(`*[ SYSTEM ]* Removed @${target} from owners.`, { mentions: [target + '@s.whatsapp.net'] });
        break;
      }

      case 'refresh': {
        if (!isGroup) return m.reply('Group only!');
        await jamesdev.groupMetadata(from);
        m.reply('*[ SYSTEM ]* Group metadata refreshed.');
        break;
      }

      case 'debugadmin': {
        if (!isGroup) return m.reply('Group only!');
        const debugText = `*[ ADMIN DEBUG ]*
Bot JID: ${botNumber}
Bot LID: ${botLid || 'None'}
Sender JID: ${sender}
Is Bot Admin: ${isBotAdmin}
Is Sender Admin: ${isAdmin}
Admin Count: ${groupAdmins.length}
Participants Count: ${participants.length}
Group Metadata: ${groupMetadata ? 'Fetched' : 'Failed'}

*Admins Sample:*
${groupAdmins.slice(0, 5).join('\n')}
`;
        m.reply(debugText);
        break;
      }

      case 'owner': {
        await jamesdev.sendContact(from, global.owner, m);
        break;
      }

      case 'me': {
        m.reply(`*USER INFO*
Name: ${m.pushName || 'User'}
Number: ${senderNumber}
Status: ${isPrem ? 'Premium' : 'Free'}`);
        break;
      }

      case 'runtime': {
        const uptime = process.uptime();
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);
        m.reply(`*RUNTIME*\n${hours}h ${minutes}m ${seconds}s`);
        break;
      }

      case 'kick': {
        if (!isGroup) return m.reply('Group only!');
        if (!isAdmin) return m.reply('Admin only!');
        if (!isBotAdmin) return m.reply('Bot not admin!');
        let users = m.mentionedJid[0] ? m.mentionedJid[0] : m.quoted ? m.quoted.sender : text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        await jamesdev.groupParticipantsUpdate(from, [users], 'remove');
        m.reply('Kicked!');
        break;
      }

      case 'add': {
        if (!isGroup) return m.reply('Group only!');
        if (!isAdmin) return m.reply('Admin only!');
        if (!isBotAdmin) return m.reply('Bot not admin!');
        let users = text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        await jamesdev.groupParticipantsUpdate(from, [users], 'add');
        m.reply('Added!');
        break;
      }

      case 'promote': {
        if (!isGroup) return m.reply('Group only!');
        if (!isAdmin) return m.reply('Admin only!');
        if (!isBotAdmin) return m.reply('Bot not admin!');
        let users = m.mentionedJid[0] ? m.mentionedJid[0] : m.quoted ? m.quoted.sender : text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        await jamesdev.groupParticipantsUpdate(from, [users], 'promote');
        m.reply('Promoted!');
        break;
      }

      case 'demote': {
        if (!isGroup) return m.reply('Group only!');
        if (!isAdmin) return m.reply('Admin only!');
        if (!isBotAdmin) return m.reply('Bot not admin!');
        let users = m.mentionedJid[0] ? m.mentionedJid[0] : m.quoted ? m.quoted.sender : text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        await jamesdev.groupParticipantsUpdate(from, [users], 'demote');
        m.reply('Demoted!');
        break;
      }

      case 'hidetag': {
        if (!isGroup) return m.reply('Group only!');
        if (!isAdmin) return m.reply('Admin only!');
        jamesdev.sendMessage(from, { text: text ? text : '', mentions: participants.map(a => a.id) }, { quoted: m });
        break;
      }

      case 'tagall': {
        if (!isGroup) return m.reply('Group only!');
        if (!isAdmin) return m.reply('Admin only!');
        let tagText = `*TAG ALL*\n\n${text ? text : ''}\n\n`;
        for (let mem of participants) {
          tagText += `@${mem.id.split('@')[0]}\n`;
        }
        jamesdev.sendMessage(from, { text: tagText, mentions: participants.map(a => a.id) }, { quoted: m });
        break;
      }

      case 'group': {
        if (!isGroup) return m.reply('Group only!');
        if (!isAdmin) return m.reply('Admin only!');
        if (!isBotAdmin) return m.reply('Bot not admin!');
        if (args[0] === 'open') {
          await jamesdev.groupSettingUpdate(from, 'not_announcement');
          await m.reply('*[ SYSTEM ]* Group has been opened. Everyone can send messages.');
        } else if (args[0] === 'close') {
          await jamesdev.groupSettingUpdate(from, 'announcement');
          await m.reply('*[ SYSTEM ]* Group has been closed. Only admins can send messages.');
        } else {
          m.reply('Use open or close!');
        }
        break;
      }

      case 'setname': {
        if (!isGroup) return m.reply('Group only!');
        if (!isAdmin) return m.reply('Admin only!');
        if (!isBotAdmin) return m.reply('Bot not admin!');
        await jamesdev.groupUpdateSubject(from, text);
        m.reply('Name changed!');
        break;
      }

      case 'setdesc': {
        if (!isGroup) return m.reply('Group only!');
        if (!isAdmin) return m.reply('Admin only!');
        if (!isBotAdmin) return m.reply('Bot not admin!');
        await jamesdev.groupUpdateDescription(from, text);
        m.reply('Description changed!');
        break;
      }

      case 'delete':
      case 'del': {
        if (!m.quoted) return m.reply('Reply to a message!');
        if (m.quoted.fromMe) {
          await jamesdev.sendMessage(from, { delete: m.quoted.key });
        } else {
          if (!isAdmin) return m.reply('Admin only!');
          if (!isBotAdmin) return m.reply('Bot not admin!');
          await jamesdev.sendMessage(from, { delete: m.quoted.key });
        }
        break;
      }

      case 'addprem': {
        if (!isOwner) return m.reply('Owner only!');
        if (!text) return m.reply('Provide number!');
        let num = text.replace(/[^0-9]/g, '');
        let premium = getPremiumData();
        if (premium.includes(num)) return m.reply('Already premium!');
        premium.push(num);
        fs.writeFileSync('./Data/premium.json', JSON.stringify(premium));
        premiumCache = premium;
        m.reply(`Added ${num} to premium!`);
        break;
      }

      case 'delprem': {
        if (!isOwner) return m.reply('Owner only!');
        if (!text) return m.reply('Provide number!');
        let num = text.replace(/[^0-9]/g, '');
        let premium = getPremiumData();
        const index = premium.indexOf(num);
        if (index > -1) {
          premium.splice(index, 1);
          fs.writeFileSync('./Data/premium.json', JSON.stringify(premium));
          premiumCache = premium;
          m.reply(`Removed ${num} from premium!`);
        } else {
          m.reply('User not in premium list!');
        }
        break;
      }

      case 'eval': {
        if (!isOwner) return;
        try {
          let evaled = await eval(text);
          if (typeof evaled !== 'string') evaled = require('util').inspect(evaled);
          m.reply(evaled);
        } catch (err) {
          console.error(err);
        }
        break;
      }

      case 'shell': {
        if (!isOwner) return;
        require('child_process').exec(text, (err, stdout) => {
          if (err) return console.error(err);
          if (stdout) m.reply(stdout);
        });
        break;
      }

      case 'restart': {
        if (!isOwner) return m.reply('Owner only!');
        await m.reply('Restarting...');
        process.exit();
        break;
      }

      case 'setprefix': {
        if (!isOwner) return m.reply('Only owner can use this!');
        if (!text) return m.reply('Provide a prefix!');
        global.prefix = [text];
        m.reply(`Prefix changed to: ${text}`);
        break;
      }

      case 'sticker':
      case 's': {
        const quoted = m.quoted ? m.quoted : m;
        const mime = (quoted.msg || quoted).mimetype || '';
        if (/image|video/.test(mime)) {
          m.reply('Converting to sticker...');
          const media = await quoted.download();
          const { Sticker, StickerTypes } = require('wa-sticker-formatter');
          const sticker = new Sticker(media, {
            pack: global.botName,
            author: global.ownerName,
            type: StickerTypes.FULL,
            categories: ['🤩', '🎉'],
            id: '12345',
            quality: 70,
            background: '#00000000'
          });
          const buffer = await sticker.toBuffer();
          await jamesdev.sendMessage(from, { sticker: buffer }, { quoted: m });
        } else {
          m.reply('Reply to image/video!');
        }
        break;
      }

      case 'take':
      case 'steal': {
        if (!m.quoted) return m.reply('Reply to a sticker!');
        if (m.quoted.mtype !== 'stickerMessage') return m.reply('Not a sticker!');
        m.reply('Stealing sticker...');
        const media = await m.quoted.download();
        const { Sticker, StickerTypes } = require('wa-sticker-formatter');
        const sticker = new Sticker(media, {
          pack: text.split('|')[0] || global.botName,
          author: text.split('|')[1] || global.ownerName,
          type: StickerTypes.FULL,
          categories: ['🤩', '🎉'],
          id: '12345',
          quality: 70,
          background: '#00000000'
        });
        const buffer = await sticker.toBuffer();
        await jamesdev.sendMessage(from, { sticker: buffer }, { quoted: m });
        break;
      }

      case 'vv':
      case 'viewonce': {
        const quoted = m.quoted ? m.quoted : m;
        const isViewOnce = quoted.isViewOnce || quoted.mtype === 'viewOnceMessage' || quoted.mtype === 'viewOnceMessageV2' || (quoted.msg && (quoted.msg.viewOnce || quoted.msg.isViewOnce));
        if (!isViewOnce) return m.reply('Reply to a view once message!');
        
        m.reply('Downloading view once...');
        try {
          const buffer = await quoted.download();
          const mime = (quoted.msg || quoted).mimetype || '';
          if (/image/.test(mime)) {
            await jamesdev.sendMessage(from, { image: buffer, caption: (quoted.msg || quoted).caption || 'Downloaded by Red MD' }, { quoted: m });
          } else if (/video/.test(mime)) {
            await jamesdev.sendMessage(from, { video: buffer, caption: (quoted.msg || quoted).caption || 'Downloaded by Red MD' }, { quoted: m });
          }
        } catch (e) {
          m.reply(`Failed to download: ${e.message}`);
        }
        break;
      }

      case 'getpp': {
        const user = m.quoted ? m.quoted.sender : m.mentionedJid[0] ? m.mentionedJid[0] : sender;
        try {
          const ppUrl = await jamesdev.profilePictureUrl(user, 'image');
          await jamesdev.sendMessage(from, { image: { url: ppUrl }, caption: `Profile Picture of @${user.split('@')[0]}`, mentions: [user] }, { quoted: m });
        } catch (e) {
          m.reply('Failed to get profile picture. Maybe it is private.');
        }
        break;
      }

      case 'welcome': {
        if (!isGroup) return m.reply('Group only!');
        if (!isAdmin) return m.reply('Admin only!');
        if (args[0] === 'on') {
          global.welcome = 'on';
          m.reply('Welcome messages enabled!');
        } else if (args[0] === 'off') {
          global.welcome = 'off';
          m.reply('Welcome messages disabled!');
        } else {
          m.reply('Use on or off!');
        }
        break;
      }

      case 'left': {
        if (!isGroup) return m.reply('Group only!');
        if (!isAdmin) return m.reply('Admin only!');
        if (args[0] === 'on') {
          global.left = 'on';
          m.reply('Left messages enabled!');
        } else if (args[0] === 'off') {
          global.left = 'off';
          m.reply('Left messages disabled!');
        } else {
          m.reply('Use on or off!');
        }
        break;
      }

      case 'antilink': {
        if (!isGroup) return m.reply('Group only!');
        if (!isAdmin) return m.reply('Admin only!');
        if (args[0] === 'on' || args[0] === 'del') {
          global.antiLink = 'del';
          m.reply('Anti-Link enabled (Delete mode)!');
        } else if (args[0] === 'warn') {
          global.antiLink = 'warn';
          m.reply('Anti-Link enabled (Warn mode)!');
        } else if (args[0] === 'kick') {
          global.antiLink = 'kick';
          m.reply('Anti-Link enabled (Kick mode)!');
        } else if (args[0] === 'off') {
          global.antiLink = 'off';
          m.reply('Anti-Link disabled!');
        } else {
          m.reply('Use on/del, warn, kick, or off!');
        }
        break;
      }

      case 'antidelete': {
        if (!isOwner) return m.reply('Owner only!');
        if (args[0] === 'on') {
          global.antiDelete = 'on';
          m.reply('Anti-Delete enabled!');
        } else if (args[0] === 'off') {
          global.antiDelete = 'off';
          m.reply('Anti-Delete disabled!');
        } else {
          m.reply('Use on or off!');
        }
        break;
      }

      case 'ssweb': {
        if (!text) return m.reply('Provide URL!');
        await jamesdev.sendMessage(from, { image: { url: `https://image.thum.io/get/width/1900/crop/800/fullPage/${text}` }, caption: 'Screenshot' }, { quoted: m });
        break;
      }

      case 'calc': {
        if (!text) return m.reply('Provide expression!');
        try {
          m.reply(`Result: ${eval(text.replace(/[^0-9+\-*/().]/g, ''))}`);
        } catch {
          m.reply('Invalid expression!');
        }
        break;
      }

      case 'listadmin': {
        if (!isGroup) return m.reply('Group only!');
        let adminText = `*LIST ADMINS*\n\n`;
        for (let adm of groupAdmins) {
          adminText += `- @${adm.split('@')[0]}\n`;
        }
        jamesdev.sendMessage(from, { text: adminText, mentions: groupAdmins }, { quoted: m });
        break;
      }

      case 'listonline': {
        if (!isGroup) return m.reply('Group only!');
        let online = participants.filter(v => v.id !== jamesdev.user.id);
        m.reply(`*ONLINE USERS*\n\n${online.map(v => `- @${v.id.split('@')[0]}`).join('\n')}`);
        break;
      }

      case 'setbotname': {
        if (!isOwner) return m.reply('Owner only!');
        global.botName = text;
        m.reply(`Bot name changed to: ${text}`);
        break;
      }

      case 'block': {
        if (!isOwner) return m.reply('Owner only!');
        let user = m.mentionedJid[0] ? m.mentionedJid[0] : m.quoted ? m.quoted.sender : text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        await jamesdev.updateBlockStatus(user, 'block');
        m.reply('Blocked!');
        break;
      }

      case 'unblock': {
        if (!isOwner) return m.reply('Owner only!');
        let user = m.mentionedJid[0] ? m.mentionedJid[0] : m.quoted ? m.quoted.sender : text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        await jamesdev.updateBlockStatus(user, 'unblock');
        m.reply('Unblocked!');
        break;
      }

      case 'listsession': {
        if (!isOwner) return m.reply('Owner only!');
        const sessions = fs.readdirSync('./sessionfile');
        m.reply(`*ACTIVE SESSIONS*\n\n${sessions.map(s => `- ${s}`).join('\n')}`);
        break;
      }

      case 'broadcast':
      case 'bc': {
        if (!isOwner) return m.reply('Owner only!');
        if (!text) return m.reply('Provide text!');
        let chats = await jamesdev.groupFetchAllParticipating();
        let groups = Object.values(chats).map(v => v.id);
        m.reply(`Broadcasting to ${groups.length} groups...`);
        for (let id of groups) {
          await jamesdev.sendMessage(id, { text: `*[ BROADCAST ]*\n\n${text}` });
        }
        m.reply('Done!');
        break;
      }

      case 'setbotimage': {
        if (!isOwner) return m.reply('Owner only!');
        if (!text) return m.reply('Provide image URL!');
        global.menuImage = text;
        m.reply('Bot image changed!');
        break;
      }

      case 'antimedia': {
        if (!isGroup) return m.reply('Group only!');
        if (!isAdmin) return m.reply('Admin only!');
        if (args[0] === 'on' || args[0] === 'del') {
          global.antiMedia = 'del';
          m.reply('Anti-Media enabled (Delete mode)!');
        } else if (args[0] === 'warn') {
          global.antiMedia = 'warn';
          m.reply('Anti-Media enabled (Warn mode)!');
        } else if (args[0] === 'kick') {
          global.antiMedia = 'kick';
          m.reply('Anti-Media enabled (Kick mode)!');
        } else if (args[0] === 'off') {
          global.antiMedia = 'off';
          m.reply('Anti-Media disabled!');
        } else {
          m.reply('Use on/del, warn, kick, or off!');
        }
        break;
      }

      case 'antigcmention': {
        if (!isGroup) return m.reply('Group only!');
        if (!isAdmin) return m.reply('Admin only!');
        if (args[0] === 'on' || args[0] === 'del') {
          global.antiGcMention = 'del';
          m.reply('Anti-GC Mention enabled (Delete mode)!');
        } else if (args[0] === 'warn') {
          global.antiGcMention = 'warn';
          m.reply('Anti-GC Mention enabled (Warn mode)!');
        } else if (args[0] === 'kick') {
          global.antiGcMention = 'kick';
          m.reply('Anti-GC Mention enabled (Kick mode)!');
        } else if (args[0] === 'off') {
          global.antiGcMention = 'off';
          m.reply('Anti-GC Mention disabled!');
        } else {
          m.reply('Use on/del, warn, kick, or off!');
        }
        break;
      }

      case 'antitag': {
        if (!isGroup) return m.reply('Group only!');
        if (!isAdmin) return m.reply('Admin only!');
        if (args[0] === 'on' || args[0] === 'del') {
          global.antiTag = 'del';
          m.reply('Anti-Tag enabled (Delete mode)!');
        } else if (args[0] === 'warn') {
          global.antiTag = 'warn';
          m.reply('Anti-Tag enabled (Warn mode)!');
        } else if (args[0] === 'kick') {
          global.antiTag = 'kick';
          m.reply('Anti-Tag enabled (Kick mode)!');
        } else if (args[0] === 'off') {
          global.antiTag = 'off';
          m.reply('Anti-Tag disabled!');
        } else {
          m.reply('Use on/del, warn, kick, or off!');
        }
        break;
      }

      case 'antibadword': {
        if (!isGroup) return m.reply('Group only!');
        if (!isAdmin) return m.reply('Admin only!');
        if (args[0] === 'on' || args[0] === 'del') {
          global.antiBadword = 'del';
          m.reply('Anti-Badword enabled (Delete mode)!');
        } else if (args[0] === 'warn') {
          global.antiBadword = 'warn';
          m.reply('Anti-Badword enabled (Warn mode)!');
        } else if (args[0] === 'kick') {
          global.antiBadword = 'kick';
          m.reply('Anti-Badword enabled (Kick mode)!');
        } else if (args[0] === 'off') {
          global.antiBadword = 'off';
          m.reply('Anti-Badword disabled!');
        } else {
          m.reply('Use on/del, warn, kick, or off!');
        }
        break;
      }

      case 'antisticker': {
        if (!isGroup) return m.reply('Group only!');
        if (!isAdmin) return m.reply('Admin only!');
        if (args[0] === 'on' || args[0] === 'del') {
          global.antiSticker = 'del';
          m.reply('Anti-Sticker enabled (Delete mode)!');
        } else if (args[0] === 'warn') {
          global.antiSticker = 'warn';
          m.reply('Anti-Sticker enabled (Warn mode)!');
        } else if (args[0] === 'kick') {
          global.antiSticker = 'kick';
          m.reply('Anti-Sticker enabled (Kick mode)!');
        } else if (args[0] === 'off') {
          global.antiSticker = 'off';
          m.reply('Anti-Sticker disabled!');
        } else {
          m.reply('Use on/del, warn, kick, or off!');
        }
        break;
      }

      case 'antiscam': {
        if (!isGroup) return m.reply('Group only!');
        if (!isAdmin) return m.reply('Admin only!');
        if (args[0] === 'on' || args[0] === 'del') {
          global.antiScam = 'del';
          m.reply('Anti-Scam enabled (Delete mode)!');
        } else if (args[0] === 'warn') {
          global.antiScam = 'warn';
          m.reply('Anti-Scam enabled (Warn mode)!');
        } else if (args[0] === 'kick') {
          global.antiScam = 'kick';
          m.reply('Anti-Scam enabled (Kick mode)!');
        } else if (args[0] === 'off') {
          global.antiScam = 'off';
          m.reply('Anti-Scam disabled!');
        } else {
          m.reply('Use on/del, warn, kick, or off!');
        }
        break;
      }

      case 'antivirus': {
        if (!isGroup) return m.reply('Group only!');
        if (!isAdmin) return m.reply('Admin only!');
        if (args[0] === 'on' || args[0] === 'del') {
          global.antiVirus = 'del';
          m.reply('Anti-Virus enabled (Delete mode)!');
        } else if (args[0] === 'warn') {
          global.antiVirus = 'warn';
          m.reply('Anti-Virus enabled (Warn mode)!');
        } else if (args[0] === 'kick') {
          global.antiVirus = 'kick';
          m.reply('Anti-Virus enabled (Kick mode)!');
        } else if (args[0] === 'off') {
          global.antiVirus = 'off';
          m.reply('Anti-Virus disabled!');
        } else {
          m.reply('Use on/del, warn, kick, or off!');
        }
        break;
      }

      case 'antibug': {
        if (!isGroup) return m.reply('Group only!');
        if (!isAdmin) return m.reply('Admin only!');
        if (args[0] === 'on' || args[0] === 'del') {
          global.antiBug = 'del';
          m.reply('Anti-Bug enabled (Delete mode)!');
        } else if (args[0] === 'warn') {
          global.antiBug = 'warn';
          m.reply('Anti-Bug enabled (Warn mode)!');
        } else if (args[0] === 'kick') {
          global.antiBug = 'kick';
          m.reply('Anti-Bug enabled (Kick mode)!');
        } else if (args[0] === 'off') {
          global.antiBug = 'off';
          m.reply('Anti-Bug disabled!');
        } else {
          m.reply('Use on/del, warn, kick, or off!');
        }
        break;
      }

      case 'anticall': {
        if (!isOwner) return m.reply('Owner only!');
        if (args[0] === 'on') {
          global.antiCall = 'on';
          m.reply('Anti-Call enabled!');
        } else if (args[0] === 'off') {
          global.antiCall = 'off';
          m.reply('Anti-Call disabled!');
        } else {
          m.reply('Use on or off!');
        }
        break;
      }

      case 'antisimp': {
        if (!isGroup) return m.reply('Group only!');
        if (!isAdmin) return m.reply('Admin only!');
        if (args[0] === 'on') {
          global.antiSimp = 'on';
          m.reply('Anti-Simp enabled!');
        } else if (args[0] === 'off') {
          global.antiSimp = 'off';
          m.reply('Anti-Simp disabled!');
        } else {
          m.reply('Use on or off!');
        }
        break;
      }

      case 'antibot': {
        if (!isGroup) return m.reply('Group only!');
        if (!isAdmin) return m.reply('Admin only!');
        if (args[0] === 'on') {
          global.antiBot = 'on';
          m.reply('Anti-Bot enabled!');
        } else if (args[0] === 'off') {
          global.antiBot = 'off';
          m.reply('Anti-Bot disabled!');
        } else {
          m.reply('Use on or off!');
        }
        break;
      }

      case 'revoke': {
        if (!isGroup) return m.reply('Group only!');
        if (!isAdmin) return m.reply('Admin only!');
        if (!isBotAdmin) return m.reply('Bot not admin!');
        await jamesdev.groupRevokeInvite(from);
        m.reply('Link revoked!');
        break;
      }

      case 'linkgc': {
        if (!isGroup) return m.reply('Group only!');
        if (!isBotAdmin) return m.reply('Bot not admin!');
        let link = await jamesdev.groupInviteCode(from);
        m.reply(`https://chat.whatsapp.com/${link}`);
        break;
      }

      // ... and so on ...
    }

    // Plugin Handler
    const pluginsPath = path.join(__dirname, 'plugins');
    const pluginFiles = fs.readdirSync(pluginsPath);
    for (const file of pluginFiles) {
      if (file.endsWith('.js')) {
        const plugin = require(path.join(pluginsPath, file));
        if (plugin.name === command) {
          await plugin.execute(m, { jamesdev, args, text, isGroup, isAdmin, isBotAdmin, isOwner, isPrem, store });
        }
      }
    }

  } catch (err) {
    console.log(chalk.redBright('[ ERROR ]'), err);
  }
};
