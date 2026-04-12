import axios from 'axios'

class DownrScraper {
  constructor() {
    this.baseURL = 'https://downr.org'
    this.headers = {
      'accept': '*/*',
      'content-type': 'application/json',
      'origin': 'https://downr.org',
      'referer': 'https://downr.org/',
      'user-agent':
        'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36'
    }
  }

  async getSessionCookie() {
    const baseCookie =
      '_ga=GA1.1.536005378.1770437315; _clck=17lj13q%5E2%5Eg3d'

    const res = await axios.get(
      `${this.baseURL}/.netlify/functions/analytics`,
      { headers: { ...this.headers, cookie: baseCookie } }
    )

    const sess = res.headers['set-cookie']?.[0]?.split(';')[0]
    return sess ? `${baseCookie}; ${sess}` : baseCookie
  }

  async fetch(url) {
    const cookie = await this.getSessionCookie()

    const res = await axios.post(
      `${this.baseURL}/.netlify/functions/nyt`,
      { url },
      {
        headers: {
          ...this.headers,
          cookie
        }
      }
    )

    return res.data
  }
}

let handler = async (m, { conn, text, quoted }) => {
  let url = text

  // allow reply to message with link
  if (!url && quoted?.text) {
    url = quoted.text
  }

  if (!url) {
    return m.reply(`Send a link\nExample:\n.dl https://tiktok.com/...`)
  }

  try {
    await m.react('🔍')

    const downr = new DownrScraper()
    const data = await downr.fetch(url)

    if (!data?.medias?.length) {
      throw 'No media found'
    }

    const medias = data.medias

    const video = medias.find(v => v.type === 'video')
    const images = medias.filter(v => v.type === 'image')
    const audio = medias.find(v => v.type === 'audio')

    // 🎥 VIDEO
    if (video) {
      await conn.sendMessage(
        m.chat,
        {
          video: { url: video.url },
          mimetype: 'video/mp4'
        },
        { quoted: m }
      )
      return
    }

    // 🖼️ IMAGES
    if (images.length) {
      for (let img of images) {
        await conn.sendMessage(
          m.chat,
          { image: { url: img.url } },
          { quoted: m }
        )
      }
      return
    }

    // 🎵 AUDIO
    if (audio) {
      await conn.sendMessage(
        m.chat,
        {
          audio: { url: audio.url },
          mimetype: 'audio/mpeg'
        },
        { quoted: m }
      )
      return
    }

    throw 'Unsupported media'

  } catch (e) {
    console.error('DL ERROR:', e)
    await m.react('❌')
    m.reply('Failed to download media')
  }
}

handler.command = ['dl']
handler.help = ['dl <link>']
handler.tags = ['tools']

export default handler
