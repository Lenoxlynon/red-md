const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const axios = require('axios');
const ytdl = require('ytdl-core');
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

    // Cache message for anti-delete
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
    
    // Owner logic
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
    if (!fs.existsSync('./Downloads')) fs.mkdirSync('./Downloads');

    const isPrem = getPremiumData().includes(senderNumber) || isOwner;

    // Helper to reply
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

    // Auto Features
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

    // Parse Mentions
    const mentions = [...text.matchAll(/@([0-9]{5,16}|0)/g)].map(v => v[1] + '@s.whatsapp.net');
    if (mentions.length > 0) {
      m.mentionedJid = [...new Set([...(m.mentionedJid || []), ...mentions])];
    }

    // Anti-Delete Logic
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

    // Anti-Features Logic
    let antiTriggered = false;
    if (!isOwner) {
      const handleAntiAction = async (action, reason) => {
        if (action === 'off' || antiTriggered) return;
        antiTriggered = true;
        await jamesdev.sendMessage(from, { delete: m.key });
        if (isGroup) {
          if (action === 'warn' || action === 'del') {
            m.reply(`*[ ${reason} ]* @${sender.split('@')[0]} Warning! Violation detected.`, { mentions: [sender] });
          } else if (action === 'kick' && isBotAdmin) {
            await m.reply(`*[ ${reason} ]* Kicking @${sender.split('@')[0]} for violating group rules.`, { mentions: [sender] });
            await jamesdev.groupParticipantsUpdate(from, [sender], 'remove');
          }
        } else {
          if (action === 'warn' || action === 'del') {
            m.reply(`*[ ${reason} ]* Warning! Violation detected.`);
          } else if (action === 'block') {
            await m.reply(`*[ ${reason} ]* You have been blocked.`);
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
┃ 🔓 open
┃ 🔒 close
┃ ✏️ setname
┃ ✏️ setdesc
┃ 🔗 linkgc
┃ 🔄 revoke
┃ 📢 tagall
┃ 🗑️ delete
┃ 👮 listadmin
┃ 🟢 listonline
┃ 🆕 creategroup
┗━━━━━━━━━━━━━━━━━━┛

┏━━━〔 *DOWNLOADER* 〕━━━┓
┃ 🎵 ytmp3 <link>
┃ 🎬 ytmp4 <link>
┃ 📄 ytmpdoc <link>
┃ 🔍 yta <song name>
┃ 🔍 ytv <video name>
┃ 📱 ig <link>
┃ 🎵 tiktok <link>
┃ 🐦 twitter <link>
┃ 📘 facebook <link>
┃ 📁 download <link>
┗━━━━━━━━━━━━━━━━━━┛

┏━━━〔 *GAMES* 〕━━━┓
┃ 🎲 truth
┃ 🎲 dare
┃ ✂️ rps
┗━━━━━━━━━━━━━━━━━━┛

┏━━━〔 *TOOLS* 〕━━━┓
┃ 🖼️ sticker
┃ ✂️ take/steal
┃ 👁️ vv
┃ 👤 getpp
┃ 🖼️ toimg
┃ 🗣️ ttop
┃ 🔊 ttoaudio
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
┃ 🤖 antibot [on/off]
┃ 🖼️ antimedia [warn/kick/off]
┃ 🏷️ antitag [warn/kick/off]
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
        const sections = [
          {
            title: '📋 MAIN MENU',
            rows: [
              { title: '⚡ Main Commands', rowId: `${prefix}menu`, description: 'Show all main commands' },
              { title: '👥 Group Commands', rowId: `${prefix}help group`, description: 'Group management' },
              { title: '📥 Downloader', rowId: `${prefix}help download`, description: 'Download media' },
              { title: '🎮 Games', rowId: `${prefix}help games`, description: 'Fun games' },
              { title: '🛠️ Tools', rowId: `${prefix}help tools`, description: 'Useful tools' }
            ]
          }
        ];

        const listMessage = {
          text: '┏━━━〔 *SELECTIVE MENU* 〕━━━┓\n┃ Choose a category below:\n┗━━━━━━━━━━━━━━━━━━┛',
          footer: 'Red MD • Multi Device Bot',
          title: '📱 RED MD MENU',
          buttonText: 'SELECT CATEGORY',
          sections
        };

        await jamesdev.sendMessage(from, listMessage, { quoted: m });
        break;
      }

      case 'open': {
        if (!isGroup) return m.reply('❌ Group only!');
        if (!isAdmin) return m.reply('❌ Admin only!');
        if (!isBotAdmin) return m.reply('❌ Bot not admin!');
        await jamesdev.groupSettingUpdate(from, 'not_announcement');
        m.reply('✅ Group has been *OPENED*\nAll members can now send messages.');
        break;
      }

      case 'close': {
        if (!isGroup) return m.reply('❌ Group only!');
        if (!isAdmin) return m.reply('❌ Admin only!');
        if (!isBotAdmin) return m.reply('❌ Bot not admin!');
        await jamesdev.groupSettingUpdate(from, 'announcement');
        m.reply('✅ Group has been *CLOSED*\nOnly admins can send messages now.');
        break;
      }

      case 'kick':
      case 'remove': {
        if (!isGroup) return m.reply('❌ Group only!');
        if (!isAdmin) return m.reply('❌ You need to be an admin to kick members!');
        if (!isBotAdmin) return m.reply('❌ Bot needs to be admin to kick members!');
        
        let target = null;
        
        if (m.quoted) {
          target = m.quoted.sender;
        } else if (m.mentionedJid && m.mentionedJid[0]) {
          target = m.mentionedJid[0];
        } else if (args[0]) {
          let number = args[0].replace(/[^0-9]/g, '');
          if (number.length < 10) return m.reply('❌ Invalid number!');
          target = number + '@s.whatsapp.net';
        }
        
        if (!target) {
          return m.reply('❌ Please tag a user, reply to their message, or provide a number!\n\n📌 Examples:\n.kick @user\n.kick (reply to message)\n.kick 628123456789');
        }
        
        if (target === sender) return m.reply('❌ You cannot kick yourself!');
        if (target === botNumber) return m.reply('❌ You cannot kick the bot!');
        
        try {
          await jamesdev.groupParticipantsUpdate(from, [target], 'remove');
          m.reply(`✅ Successfully kicked @${target.split('@')[0]}!`, { mentions: [target] });
        } catch (err) {
          console.log('Kick error:', err);
          m.reply(`❌ Failed to kick user: ${err.message}`);
        }
        break;
      }

      case 'add': {
        if (!isGroup) return m.reply('❌ Group only!');
        if (!isAdmin) return m.reply('❌ Admin only!');
        if (!isBotAdmin) return m.reply('❌ Bot not admin!');
        if (!text) return m.reply('❌ Provide a number!');
        
        let users = text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        try {
          await jamesdev.groupParticipantsUpdate(from, [users], 'add');
          m.reply(`✅ Added @${text.replace(/[^0-9]/g, '')}!`, { mentions: [users] });
        } catch (err) {
          m.reply(`❌ Failed to add user: ${err.message}`);
        }
        break;
      }

      case 'promote': {
        if (!isGroup) return m.reply('❌ Group only!');
        if (!isAdmin) return m.reply('❌ Admin only!');
        if (!isBotAdmin) return m.reply('❌ Bot not admin!');
        
        let users = m.mentionedJid[0] ? m.mentionedJid[0] : m.quoted ? m.quoted.sender : text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        try {
          await jamesdev.groupParticipantsUpdate(from, [users], 'promote');
          m.reply(`✅ Promoted @${users.split('@')[0]} to admin!`, { mentions: [users] });
        } catch (err) {
          m.reply(`❌ Failed to promote: ${err.message}`);
        }
        break;
      }

      case 'demote':
      case 'unpromote': {
        if (!isGroup) return m.reply('❌ Group only!');
        if (!isAdmin) return m.reply('❌ Admin only!');
        if (!isBotAdmin) return m.reply('❌ Bot not admin!');
        
        let users = m.mentionedJid[0] ? m.mentionedJid[0] : m.quoted ? m.quoted.sender : text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        try {
          await jamesdev.groupParticipantsUpdate(from, [users], 'demote');
          m.reply(`✅ Demoted @${users.split('@')[0]} from admin!`, { mentions: [users] });
        } catch (err) {
          m.reply(`❌ Failed to demote: ${err.message}`);
        }
        break;
      }

      case 'setdesc': {
        if (!isGroup) return m.reply('❌ Group only!');
        if (!isAdmin) return m.reply('❌ Admin only!');
        if (!isBotAdmin) return m.reply('❌ Bot not admin!');
        if (!text) return m.reply('❌ Provide a description!');
        
        try {
          await jamesdev.groupUpdateDescription(from, text);
          m.reply('✅ Group description updated successfully!');
        } catch (err) {
          m.reply(`❌ Failed to update description: ${err.message}`);
        }
        break;
      }

      case 'creategroup': {
        if (!isOwner) return m.reply('❌ Owner only!');
        if (!args[0]) return m.reply('❌ Usage: .creategroup <name> @user1 @user2');
        
        const groupName = args.join(' ').split(' @')[0];
        const participants = m.mentionedJid;
        
        if (participants.length === 0) return m.reply('❌ Tag at least one user to add!');
        
        try {
          const group = await jamesdev.groupCreate(groupName, participants);
          m.reply(`✅ Group created successfully!\nGroup Name: ${groupName}\nGroup Link: https://chat.whatsapp.com/${await jamesdev.groupInviteCode(group.id)}`);
        } catch (err) {
          m.reply(`❌ Failed to create group: ${err.message}`);
        }
        break;
      }

      // DOWNLOADER COMMANDS
      
      case 'ytmp3': {
        if (!args[0]) return m.reply('❌ Please provide a YouTube link!\nExample: .ytmp3 https://youtu.be/xxxxx');
        
        const url = args[0];
        if (!ytdl.validateURL(url)) return m.reply('❌ Invalid YouTube URL!');
        
        m.reply('🎵 Downloading audio... Please wait.');
        
        try {
          const info = await ytdl.getInfo(url);
          const title = info.videoDetails.title.replace(/[^\w\s]/gi, '');
          
          const audioStream = ytdl(url, {
            quality: 'highestaudio',
            filter: 'audioonly'
          });
          
          await jamesdev.sendMessage(from, {
            audio: audioStream,
            mimetype: 'audio/mpeg',
            fileName: `${title}.mp3`,
            caption: `🎵 *${title}*\n📥 Downloaded by ${global.botName}`
          }, { quoted: m });
          
          m.reply('✅ Audio sent successfully!');
        } catch (err) {
          console.error(err);
          m.reply(`❌ Error downloading audio: ${err.message}`);
        }
        break;
      }

      case 'ytmp4': {
        if (!args[0]) return m.reply('❌ Please provide a YouTube link!\nExample: .ytmp4 https://youtu.be/xxxxx');
        
        const url = args[0];
        if (!ytdl.validateURL(url)) return m.reply('❌ Invalid YouTube URL!');
        
        m.reply('🎬 Downloading video... Please wait.');
        
        try {
          const info = await ytdl.getInfo(url);
          const title = info.videoDetails.title.replace(/[^\w\s]/gi, '');
          
          const videoStream = ytdl(url, {
            quality: '18',
            filter: 'audioandvideo'
          });
          
          await jamesdev.sendMessage(from, {
            video: videoStream,
            caption: `🎬 *${title}*\n📥 Downloaded by ${global.botName}`,
            mimetype: 'video/mp4'
          }, { quoted: m });
          
          m.reply('✅ Video sent successfully!');
        } catch (err) {
          console.error(err);
          m.reply(`❌ Error downloading video: ${err.message}`);
        }
        break;
      }

      case 'ytmpdoc': {
        if (!args[0]) return m.reply('❌ Please provide a YouTube link!\nExample: .ytmpdoc https://youtu.be/xxxxx');
        
        const url = args[0];
        if (!ytdl.validateURL(url)) return m.reply('❌ Invalid YouTube URL!');
        
        m.reply('📄 Downloading audio as document... Please wait.');
        
        try {
          const info = await ytdl.getInfo(url);
          const title = info.videoDetails.title.replace(/[^\w\s]/gi, '');
          
          const audioStream = await ytdl(url, {
            quality: 'highestaudio',
            filter: 'audioonly'
          });
          
          const chunks = [];
          for await (const chunk of audioStream) {
            chunks.push(chunk);
          }
          const buffer = Buffer.concat(chunks);
          
          await jamesdev.sendMessage(from, {
            document: buffer,
            mimetype: 'audio/mpeg',
            fileName: `${title}.mp3`,
            caption: `📄 *${title}*\n📥 Downloaded by ${global.botName}`
          }, { quoted: m });
          
          m.reply('✅ Audio document sent successfully!');
        } catch (err) {
          console.error(err);
          m.reply(`❌ Error: ${err.message}`);
        }
        break;
      }

      case 'yta': {
        if (!args[0]) return m.reply('❌ Please provide a song name to search!\nExample: .yta Blinding Lights');
        
        const query = args.join(' ');
        m.reply(`🔍 Searching for "${query}"...`);
        
        try {
          const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=1&q=${encodeURIComponent(query)}&key=${global.youtubeApiKey}`;
          const searchRes = await axios.get(searchUrl);
          
          if (!searchRes.data.items || searchRes.data.items.length === 0) {
            return m.reply('❌ No results found!');
          }
          
          const videoId = searchRes.data.items[0].id.videoId;
          const url = `https://youtu.be/${videoId}`;
          const info = await ytdl.getInfo(url);
          const title = info.videoDetails.title;
          
          m.reply(`🎵 Found: *${title}*\nDownloading audio...`);
          
          const audioStream = ytdl(url, {
            quality: 'highestaudio',
            filter: 'audioonly'
          });
          
          await jamesdev.sendMessage(from, {
            audio: audioStream,
            mimetype: 'audio/mpeg',
            fileName: `${title}.mp3`,
            caption: `🎵 *${title}*\n📥 Downloaded by ${global.botName}`
          }, { quoted: m });
        } catch (err) {
          console.error(err);
          m.reply(`❌ Error: ${err.message}`);
        }
        break;
      }

      case 'ytv': {
        if (!args[0]) return m.reply('❌ Please provide a video name to search!\nExample: .ytv Funny Cats');
        
        const query = args.join(' ');
        m.reply(`🔍 Searching for "${query}"...`);
        
        try {
          const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=1&q=${encodeURIComponent(query)}&key=${global.youtubeApiKey}`;
          const searchRes = await axios.get(searchUrl);
          
          if (!searchRes.data.items || searchRes.data.items.length === 0) {
            return m.reply('❌ No results found!');
          }
          
          const videoId = searchRes.data.items[0].id.videoId;
          const url = `https://youtu.be/${videoId}`;
          const info = await ytdl.getInfo(url);
          const title = info.videoDetails.title;
          
          m.reply(`🎬 Found: *${title}*\nDownloading video...`);
          
          const videoStream = ytdl(url, {
            quality: '18',
            filter: 'audioandvideo'
          });
          
          await jamesdev.sendMessage(from, {
            video: videoStream,
            caption: `🎬 *${title}*\n📥 Downloaded by ${global.botName}`,
            mimetype: 'video/mp4'
          }, { quoted: m });
        } catch (err) {
          console.error(err);
          m.reply(`❌ Error: ${err.message}`);
        }
        break;
      }
case 'download': {
    if (!args[0]) {
        return m.reply(`📥 *DOWNLOADER*
        
Usage: .download <url>

Example: .download https://www.facebook.com/reel/1410328040142238/?app=fbl

Supported: Facebook, TikTok, Instagram, YouTube, Twitter
`);
    }
    
    const url = args[0];
    m.reply('⏳ Downloading...');
    
    try {
        // This calls the API - no need to put anything anywhere
        const response = await fetch(`https://omegatech-api.dixonomega.tech/downloader/all?url=${encodeURIComponent(url)}`);
        const data = await response.json();
        
        if (!data.success || !data.result) {
            return m.reply('❌ Failed to download!');
        }
        
        // Get video URL
        if (data.result.video && data.result.video.length > 0) {
            const videoUrl = data.result.video[0].url;
            
            await jamesdev.sendMessage(from, {
                video: { url: videoUrl },
                caption: `✅ Download complete!`
            }, { quoted: m });
        } else {
            m.reply('❌ No video found!');
        }
        
    } catch (err) {
        m.reply(`❌ Error: ${err.message}`);
    }
    break;
}

      // GAMES
      case 'truth': {
        const truths = [
          "What's your biggest fear?",
          "What's the biggest lie you've told?",
          "What's something you've never told anyone?",
          "What's your biggest regret?",
          "What's something you're insecure about?",
          "What's the last thing you Googled?",
          "What's your craziest dream?",
          "What's something you've stolen?",
          "What's your deepest secret?",
          "What's something you've lied about?"
        ];
        const randomTruth = truths[Math.floor(Math.random() * truths.length)];
        m.reply(`🎲 *TRUTH*\n\n${randomTruth}`);
        break;
      }

      case 'dare': {
        const dares = [
          "Send a funny selfie to the group",
          "Share your most embarrassing moment",
          "Send a voice message singing your favorite song",
          "Share a screenshot of your recent Google search",
          "Do 10 pushups and send a video",
          "Send a message to your crush right now",
          "Share your gallery's last 3 photos",
          "Change your profile picture to something funny",
          "Send a voice message imitating a celebrity",
          "Share your most used emoji combination"
        ];
        const randomDare = dares[Math.floor(Math.random() * dares.length)];
        m.reply(`🎲 *DARE*\n\n${randomDare}`);
        break;
      }

      case 'rps': {
        const choices = ['rock', 'paper', 'scissors'];
        const botChoice = choices[Math.floor(Math.random() * 3)];
        const userChoice = args[0]?.toLowerCase();
        
        if (!userChoice || !choices.includes(userChoice)) {
          return m.reply('🎮 *ROCK PAPER SCISSORS*\n\nChoose: rock, paper, or scissors\nExample: .rps rock');
        }
        
        let result = '';
        if (userChoice === botChoice) {
          result = "It's a tie! 🤝";
        } else if (
          (userChoice === 'rock' && botChoice === 'scissors') ||
          (userChoice === 'paper' && botChoice === 'rock') ||
          (userChoice === 'scissors' && botChoice === 'paper')
        ) {
          result = "You win! 🎉";
        } else {
          result = "Bot wins! 🤖";
        }
        
        m.reply(`🎮 *ROCK PAPER SCISSORS*\n\nYou: ${userChoice}\nBot: ${botChoice}\n\n*${result}*`);
        break;
      }

      // Other existing commands...
      case 'ping': {
        const start = Date.now();
        await m.reply('Testing speed...');
        const end = Date.now();
        m.reply(`> ⚡ Bot Speed: ${end - start}ms`);
        break;
      }

      case 'public': {
        if (!isOwner) return;
        global.mode = 'public';
        m.reply('✅ Bot is now in *PUBLIC* mode.');
        break;
      }

      case 'self': {
        if (!isOwner) return;
        global.mode = 'self';
        m.reply('✅ Bot is now in *SELF* mode.');
        break;
      }

      case 'iphonemode': {
        if (!isOwner) return;
        if (args[0] === 'on') {
          global.iphoneMode = true;
          m.reply('📱 iPhone Mode *ENABLED* (Plain text only)');
        } else if (args[0] === 'off') {
          global.iphoneMode = false;
          m.reply('📱 iPhone Mode *DISABLED* (Rich media enabled)');
        } else {
          m.reply('Usage: .iphonemode on/off');
        }
        break;
      }

      case 'status': {
        const statusText = `📊 *BOT STATUS*
━━━━━━━━━━━━━━━━
🔧 Mode: ${global.mode}
📱 iPhone Mode: ${global.iphoneMode ? 'ON' : 'OFF'}
👁️ Auto Read: ${global.autoRead ? 'ON' : 'OFF'}
⌨️ Auto Type: ${global.autoType ? 'ON' : 'OFF'}
🖼️ Auto Online: ${global.autoOnline ? 'ON' : 'OFF'}
🗑️ Anti Delete: ${global.antiDelete || 'OFF'}
🔗 Anti Link: ${global.antiLink || 'OFF'}
━━━━━━━━━━━━━━━━`;
        m.reply(statusText);
        break;
      }

      default:
        // Plugin Handler
        const pluginsPath = path.join(__dirname, 'plugins');
        if (fs.existsSync(pluginsPath)) {
          const pluginFiles = fs.readdirSync(pluginsPath);
          for (const file of pluginFiles) {
            if (file.endsWith('.js')) {
              const plugin = require(path.join(pluginsPath, file));
              if (plugin.name === finalCommand) {
                await plugin.execute(m, { jamesdev, args, text, isGroup, isAdmin, isBotAdmin, isOwner, isPrem, store });
                break;
              }
            }
          }
        }
        break;
    }

  } catch (err) {
    console.log(chalk.redBright('[ ERROR ]'), err);
    if (m && m.reply) m.reply(`❌ Error: ${err.message}`);
  }
};
