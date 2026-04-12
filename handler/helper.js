const { proto, getContentType } = require('@trashcore/baileys');

function getMessage(m) {
  if (m.key) {
    m.id = m.key.id;
    m.isBot = m.id.startsWith('BAE5') && m.id.length === 16;
    m.chat = m.key.remoteJid;
    m.fromMe = m.key.fromMe;
    m.isGroup = m.chat.endsWith('@g.us');
    m.sender = m.fromMe ? (m.conn.user.id.split(':')[0] + '@s.whatsapp.net' || m.conn.user.id) : (m.key.participant || m.key.remoteJid);
  }
  if (m.message) {
    m.mtype = getContentType(m.message);
    m.msg = (m.mtype === 'viewOnceMessage' ? m.message[m.mtype].message[getContentType(m.message[m.mtype].message)] : m.message[m.mtype]);
    m.body = m.message.conversation || m.msg.caption || m.msg.text || (m.mtype === 'listResponseMessage') && m.msg.singleSelectReply.selectedRowId || (m.mtype === 'buttonsResponseMessage') && m.msg.selectedButtonId || (m.mtype === 'viewOnceMessage') && m.msg.caption || m.body;
  }
  return m;
}

module.exports = { getMessage };
