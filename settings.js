const fs = require('fs');
const chalk = require('chalk');

// Settings for Red MD
global.owner = ['27634988678', '27824275911'];
global.ownerName = 'reddragon';
global.botName = 'RED MD';
global.prefix = ['.', '/', '!']; // Multiprefix
global.newsletterJid = '120363351424590490@newsletter';
global.groupInvite = 'HeMpaJhQvBD1qm9LD56gnP';
global.mode = 'public'; // 'public' or 'self'
global.iphoneMode = false; // 'true' or 'false'

// Auto features
global.autoStatus = true;
global.autoLikeStatus = true;
global.autoViewStatus = true;
global.autoRead = true;
global.autoType = true;
global.autoRecord = false;
global.autoOnline = true;
global.freezeLastSeen = false;
global.offlineMod = false;

// Anti-features options: 'del', 'warn', 'kick', 'block', 'on', 'off'
global.antiLink = 'del';
global.antiGcMention = 'del';
global.antiTag = 'del';
global.antiBot = 'del';
global.antiMedia = 'off';
global.antiBadword = 'del';
global.antiSticker = 'off';
global.antiScam = 'del';
global.antiVirus = 'del';
global.antiBug = 'del';
global.antiCall = 'on'; // Anticall on
global.antiSimp = 'off';
global.antiDelete = 'on'; // Antidelete on
global.welcome = 'on'; // Welcome on
global.left = 'on'; // Left on
global.autoJoin = true; // Auto join on

// Session ID prefix
global.sessionPrefix = 'red~';

// Thumbnails & Media (Indonesian Girl theme)
global.thumb = 'https://files.catbox.moe/8j8p8p.jpg'; // Indonesian girl placeholder
global.menuImage = 'https://files.catbox.moe/8j8p8p.jpg';
global.carouselImages = [
  'https://files.catbox.moe/8j8p8p.jpg',
  'https://files.catbox.moe/8j8p8p.jpg',
  'https://files.catbox.moe/8j8p8p.jpg'
];

// Verification
global.verifiedBusiness = true;

let file = require.resolve(__filename);
fs.watchFile(file, () => {
  fs.unwatchFile(file);
  console.log(chalk.redBright(`Update 'settings.js'`));
  delete require.cache[file];
  require(file);
});
