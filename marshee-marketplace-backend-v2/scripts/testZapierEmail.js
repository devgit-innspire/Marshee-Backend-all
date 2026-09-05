require('dotenv').config();
const { sendZapierEmail } = require('../utils/zapierEmailService');

(async () => {
  const res = await sendZapierEmail({
    email: 'hy249796@gmail.com',
    subject: 'Zapier test',
    message: '<h1>Hello</h1><p>This is a test</p>',
    name: 'John'
  });

  console.log(res);
  process.exit(res.success ? 0 : 1);
})();