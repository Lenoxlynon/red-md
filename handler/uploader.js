const axios = require('axios');
const FormData = require('form-data');
const { fromBuffer } = require('file-type');

async function uploadFile(buffer) {
  const { ext } = await fromBuffer(buffer);
  const form = new FormData();
  form.append('file', buffer, 'tmp.' + ext);
  // Using a generic uploader for demo
  try {
    const res = await axios.post('https://telegra.ph/upload', form, {
      headers: form.getHeaders()
    });
    return 'https://telegra.ph' + res.data[0].src;
  } catch (e) {
    return null;
  }
}

module.exports = { uploadFile };
