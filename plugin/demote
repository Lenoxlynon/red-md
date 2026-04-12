module.exports = {
  name: 'demote',
  category: 'group',
  desc: 'Demote an admin to member',
  async execute(m, { conn, args, isGroup, isAdmin, isBotAdmin }) {
    if (!isGroup) return m.reply('This command is only for groups!');
    if (!isAdmin) return m.reply('You are not an admin!');
    if (!isBotAdmin) return m.reply('Bot is not an admin!');
    
    let users = m.mentionedJid[0] ? m.mentionedJid[0] : m.quoted ? m.quoted.sender : args[0] ? args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : '';
    if (!users) return m.reply('Tag or reply to the user you want to demote!');
    
    await conn.groupParticipantsUpdate(m.chat, [users], 'demote');
    m.reply('Successfully demoted!');
  }
}
