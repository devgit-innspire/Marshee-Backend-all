const nodemailer = require('nodemailer');
const config = require('../config/config');

// Create reusable transporter object using SMTP transport
const createTransporter = () => {
  // Check if email config is available
  if (!config.email.host || !config.email.user || !config.email.pass) {
    console.warn('Email configuration not found. Email sending will be disabled.');
    console.warn('Required env vars: SMTP_HOST, SMTP_USER, SMTP_PASS');
    return null;
  }

  // Debug: Log configuration (without showing password)
  console.log('Email Config:', {
    host: config.email.host,
    port: config.email.port || 587,
    user: config.email.user,
    passLength: config.email.pass ? config.email.pass.length : 0,
    passHasSpaces: config.email.pass ? config.email.pass.includes(' ') : false
  });

  // Gmail-specific configuration
  const isGmail = config.email.host.includes('gmail.com') || config.email.host.includes('google');
  
  // Remove spaces from password if present (common mistake with App Passwords)
  const cleanPassword = config.email.pass.replace(/\s/g, '');
  
  // Validate App Password length for Gmail
  if (isGmail && cleanPassword.length !== 16) {
    console.error('❌ ERROR: Gmail App Password must be exactly 16 characters (without spaces)');
    console.error(`❌ Current password length: ${cleanPassword.length}`);
    console.error('❌ Please generate a new App Password: https://myaccount.google.com/apppasswords');
    console.error('❌ Make sure you are using an App Password, not your regular password!');
  }
  
  if (config.email.pass.includes(' ') && isGmail) {
    console.warn('⚠️  Warning: App Password contains spaces. Removing spaces automatically.');
    console.warn('⚠️  Make sure your App Password in .env has no spaces.');
  }
  
  const transporterConfig = {
    host: config.email.host,
    port: parseInt(config.email.port) || 587,
    secure: parseInt(config.email.port) === 465, // true for 465, false for other ports
    auth: {
      user: config.email.user.trim(),
      pass: cleanPassword.trim()
    }
  };

  // For Gmail, use service instead of host
  if (isGmail) {
    transporterConfig.service = 'gmail';
    // Remove host when using service
    delete transporterConfig.host;
    delete transporterConfig.port;
    delete transporterConfig.secure;
  }

  return nodemailer.createTransport(transporterConfig);
};

/**
 * Send OTP email
 * @param {String} email - Recipient email address
 * @param {String} otp - 6-digit OTP code
 * @param {String} purpose - Purpose of OTP (login, registration, etc.)
 * @returns {Promise<Object>} - Result object with success status
 */
const sendOtpEmail = async (email, otp, purpose = 'login') => {
  try {
    const transporter = createTransporter();
    
    if (!transporter) {
      console.error('Email transporter not configured');
      return {
        success: false,
        error: 'Email service not configured. Please set SMTP credentials in environment variables.'
      };
    }

    const purposeText = {
      'login': 'Login',
      'registration': 'Registration',
      'password-reset': 'Password Reset',
      'email-verification': 'Email Verification'
    }[purpose] || 'Authentication';

    const mailOptions = {
      from: `"Marshee Pet Tech" <${config.email.user}>`,
      to: email,
      subject: `${purposeText} OTP - Marshee Pet Tech`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>OTP Verification</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: #fff; margin: 0;">Marshee</h1>
          </div>
          <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #ddd;">
            <h2 style="color: #667eea; margin-top: 0;">${purposeText} Verification Code</h2>
            <p>Hello,</p>
            <p>Your ${purposeText.toLowerCase()} verification code is:</p>
            <div style="background: #fff; border: 2px dashed #667eea; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0;">
              <h1 style="color: #667eea; font-size: 36px; letter-spacing: 8px; margin: 0; font-weight: bold;">${otp}</h1>
            </div>
            <p style="color: #666; font-size: 14px;">This code will expire in <strong>5 minutes</strong>.</p>
            <p style="color: #666; font-size: 14px;">If you didn't request this code, please ignore this email.</p>
            <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
            <p style="color: #999; font-size: 12px; text-align: center; margin: 0;">
              This is an automated email. Please do not reply to this message.
            </p>
          </div>
        </body>
        </html>
      `,
      text: `
        Marshee - ${purposeText} Verification
        
        Your ${purposeText.toLowerCase()} verification code is: ${otp}
        
        This code will expire in 5 minutes.
        
        If you didn't request this code, please ignore this email.
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', info.messageId);
    
    return {
      success: true,
      messageId: info.messageId
    };
  } catch (error) {
    console.error('Error sending email:', error);
    
    // Provide helpful error messages for common issues
    let errorMessage = error.message;
    
    if (error.code === 'EAUTH') {
      if (error.responseCode === 535) {
        errorMessage = 'Gmail authentication failed. Please ensure:\n' +
          '1. You have enabled 2-Step Verification on your Google account\n' +
          '2. You are using an App Password (not your regular password)\n' +
          '3. Generate App Password: https://myaccount.google.com/apppasswords\n' +
          '4. Use the 16-character App Password in your SMTP_PASS environment variable';
      } else {
        errorMessage = 'Email authentication failed. Please check your SMTP credentials.';
      }
    } else if (error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT') {
      errorMessage = 'Failed to connect to email server. Please check your SMTP_HOST and SMTP_PORT settings.';
    }
    
    return {
      success: false,
      error: errorMessage,
      code: error.code,
      responseCode: error.responseCode
    };
  }
};

/**
 * Send welcome email
 * @param {String} email - Recipient email address
 * @param {String} name - User name
 * @returns {Promise<Object>} - Result object with success status
 */
const sendWelcomeEmail = async (email, name) => {
  try {
    const transporter = createTransporter();
    
    if (!transporter) {
      return { success: false, error: 'Email service not configured' };
    }

    const mailOptions = {
      from: `"Marshee" <${config.email.user}>`,
      to: email,
      subject: 'Welcome to Marshee!',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: #fff; margin: 0;">Welcome to Marshee!</h1>
          </div>
          <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #ddd;">
            <h2 style="color: #667eea;">Hello ${name || 'there'}!</h2>
            <p>Thank you for joining Marshee. We're excited to have you on board!</p>
            <p>Start exploring our amazing products and services today.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="#" style="background: #667eea; color: #fff; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Get Started</a>
            </div>
          </div>
        </body>
        </html>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    return {
      success: true,
      messageId: info.messageId
    };
  } catch (error) {
    console.error('Error sending welcome email:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Send pre-order confirmation email
 * @param {String} email - Recipient email address
 * @param {String} name - Customer name
 * @param {Object} preOrderDetails - Pre-order details (optional)
 * @returns {Promise<Object>} - Result object with success status
 */
const sendPreOrderConfirmationEmail = async (email, name, preOrderDetails = {}) => {
  try {
    const transporter = createTransporter();

    if (!transporter) {
      return { success: false, error: 'Email service not configured' };
    }

    const { orderId, amount, couponCode, discountAmount } = preOrderDetails;

    const primary = '#1f9ed9';
    const accent = '#177bb0';
    const bg = '#f4f6f8';
    const cardBg = '#ffffff';
    const text = '#102027';
    const muted = '#6b7780';
    const success = '#2e7d32';

    const mailOptions = {
      from: `"Marshee Pet Tech" <${config.email.user}>`,
      to: email,
      subject: 'Pre-Order Confirmation - Marshee Pet Tech',
      html: `
      <!doctype html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width">
        <title>Pre-Order Confirmation</title>
      </head>
      
      <body style="margin:0; padding:0; background:#D3D3D3; font-family:Arial, Helvetica, sans-serif; color:#1a1a1a;">
      
        <!-- Outer wrapper -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#D3D3D3; padding:24px 0;">
          <tr>
            <td align="center">
      
              <!-- Email card -->
              <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; width:100%; max-width:600px; border-radius:12px; box-shadow:0 6px 20px rgba(0,0,0,0.08); overflow:hidden;">
      
                <!-- Header -->
                <tr>
                  <td style="background:#F3BC07; padding:28px 24px; text-align:center;">
                    <div style="font-size:24px; font-weight:700; color:#1a1a1a;">Marshee Pet Tech</div>
                    <div style="margin-top:6px; font-size:14px; color:#333;">Pre-Order Confirmation</div>
                  </td>
                </tr>
      
                <!-- Main content -->
                <tr>
                  <td style="padding:24px;">
      
                    <p style="font-size:18px; font-weight:600; margin:0 0 12px 0;">
                      Hello ${name || 'Customer'},
                    </p>
      
                    <p style="font-size:15px; margin:0 0 16px 0; line-height:1.6; color:#333;">
                      Thank you for your pre-order with <strong>Marshee Pet Tech</strong>.  
                      Your request has been received and successfully Saved.
                    </p>
      
                  </td>
                </tr>
      
                <!-- Order Summary (vertical stacked) -->
                ${orderId ? `
                <tr>
                  <td style="padding:0 24px 24px 24px;">
                    
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FCD7E8; border-left:6px solid #F3BC07; border-radius:8px; padding:16px;">
                      
                      <tr>
                        <td colspan="2" style="font-size:16px; font-weight:700; padding-bottom:10px; color:#1a1a1a;">
                          Pre-Order Summary
                        </td>
                      </tr>
      
                      <tr>
                        <td style="font-size:14px; color:#555; padding:6px 0;">Order ID</td>
                        <td style="font-size:14px; font-weight:700; color:#1a1a1a; text-align:right;">${orderId}</td>
                      </tr>
      
                      ${amount ? `
                      <tr>
                        <td style="font-size:14px; color:#555; padding:6px 0;">Amount</td>
                        <td style="font-size:14px; font-weight:700; color:#1a1a1a; text-align:right;">₹${amount}</td>
                      </tr>
                      ` : ''}
      
                      ${couponCode ? `
                      <tr>
                        <td style="font-size:14px; color:#555; padding:6px 0;">Coupon</td>
                        <td style="font-size:14px; font-weight:700; color:#1a1a1a; text-align:right;">${couponCode}</td>
                      </tr>
                      ` : ''}
      
                      ${discountAmount ? `
                      <tr>
                        <td style="font-size:14px; color:#555; padding:6px 0;">Discount</td>
                        <td style="font-size:14px; font-weight:700; color:#2e7d32; text-align:right;">-₹${discountAmount}</td>
                      </tr>
                      ` : ''}
      
                    </table>
      
                  </td>
                </tr>
                ` : ''}
      
                <!-- Automatic Note -->
                <tr>
                  <td style="padding:20px 24px; font-size:13px; color:#777; border-top:1px solid #eee; border-radius:0 0 12px 12px;">
                    This is an automated confirmation email — please do not reply.
                  </td>
                </tr>
      
               
      
              </table>
      
            </td>
          </tr>
        </table>
      
      </body>
      </html>
      `,
      
      text: `
MARSHEE PET TECH - Pre-Order Confirmation

Dear ${name || 'Customer'},

Thank you — we have received your pre-order with Marshee Pet Tech. It has been recorded in our system.

${orderId ? `Pre-Order Summary:
Order ID: ${orderId}
${amount ? `Amount: ₹${amount}` : ''}
${couponCode ? `Coupon: ${couponCode}` : ''}
${discountAmount ? `Discount: -₹${discountAmount}` : ''}
` : ''}

We'll notify you with any updates related to this pre-order (availability, confirmation, and shipping) using the email address we have on file.

Best regards,
Marshee Pet Tech

---
This is an automated email — please do not reply to this message.
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Pre-order confirmation email sent successfully:', info.messageId);

    return {
      success: true,
      messageId: info.messageId
    };
  } catch (error) {
    console.error('Error sending pre-order confirmation email:', error);
    return {
      success: false,
      error: error.message
    };
  }
};




/**
 * Send partner password setup email with JWT token
 * @param {String} email - Partner email address
 * @param {String} name - Partner name
 * @param {String} setupToken - JWT token for password setup
 * @param {String} setupUrl - Full URL for password setup
 * @returns {Promise<Object>} - Result object with success status
 */
const sendPartnerPasswordSetupEmail = async (email, name, setupToken, setupUrl) => {
  try {
    const transporter = createTransporter();
    
    if (!transporter) {
      return { success: false, error: 'Email service not configured' };
    }

    const mailOptions = {
      from: `"Marshee Pet Tech" <${config.email.user}>`,
      to: email,
      subject: 'Welcome to Marshee Partner Portal - Set Up Your Password',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: #fff; margin: 0;">Welcome to Marshee Partner Portal!</h1>
          </div>
          <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #ddd;">
            <h2 style="color: #667eea;">Hello ${name}!</h2>
            <p>Your partner application has been approved! 🎉</p>
            <p>You can now access the Marshee Partner Portal to manage your products and track your sales.</p>
            <p><strong>To get started, please set up your password by clicking the button below:</strong></p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${setupUrl}" style="background: #667eea; color: #fff; padding: 15px 40px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">Set Up Password</a>
            </div>
            <p style="font-size: 12px; color: #666; margin-top: 30px;">
              <strong>Important:</strong> This link will expire in 7 days. If you didn't request this, please contact support.
            </p>
            <p style="font-size: 12px; color: #666;">
              Or copy and paste this link into your browser:<br>
              <a href="${setupUrl}" style="color: #667eea; word-break: break-all;">${setupUrl}</a>
            </p>
          </div>
        </body>
        </html>
      `,
      text: `
        Welcome to Marshee Partner Portal!
        
        Hello ${name},
        
        Your partner application has been approved! You can now access the Marshee Partner Portal.
        
        To get started, please set up your password by visiting:
        ${setupUrl}
        
        This link will expire in 7 days.
        
        If you didn't request this, please contact support.
      `
    };

    const info = await transporter.sendMail(mailOptions);
    return {
      success: true,
      messageId: info.messageId
    };
  } catch (error) {
    console.error('Error sending partner password setup email:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Send sub-admin password setup email with JWT token
 * @param {String} email - Sub-admin email address
 * @param {String} name - Sub-admin name
 * @param {String} setupUrl - Full URL for password setup
 * @returns {Promise<Object>} - Result object with success status
 */
const sendSubadminPasswordSetupEmail = async (email, name, setupUrl) => {
  try {
    const transporter = createTransporter();

    if (!transporter) {
      return { success: false, error: 'Email service not configured' };
    }

    const mailOptions = {
      from: `"Marshee Pet Tech" <${config.email.user}>`,
      to: email,
      subject: 'Your Marshee Admin Console access - Set Up Your Password',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: #fff; margin: 0;">Marshee Admin Console</h1>
          </div>
          <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #ddd;">
            <h2 style="color: #667eea;">Hello ${name}!</h2>
            <p>A sub-admin account has been created for you on the Marshee Admin Console.</p>
            <p><strong>To get started, please set up your password by clicking the button below:</strong></p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${setupUrl}" style="background: #667eea; color: #fff; padding: 15px 40px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">Set Up Password</a>
            </div>
            <p style="font-size: 12px; color: #666; margin-top: 30px;">
              <strong>Important:</strong> This link will expire in 7 days. If you didn't expect this, please contact your administrator.
            </p>
            <p style="font-size: 12px; color: #666;">
              Or copy and paste this link into your browser:<br>
              <a href="${setupUrl}" style="color: #667eea; word-break: break-all;">${setupUrl}</a>
            </p>
          </div>
        </body>
        </html>
      `,
      text: `
        Marshee Admin Console

        Hello ${name},

        A sub-admin account has been created for you on the Marshee Admin Console.

        To get started, please set up your password by visiting:
        ${setupUrl}

        This link will expire in 7 days.

        If you didn't expect this, please contact your administrator.
      `
    };

    const info = await transporter.sendMail(mailOptions);
    return {
      success: true,
      messageId: info.messageId
    };
  } catch (error) {
    console.error('Error sending sub-admin password setup email:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

module.exports = {
  sendOtpEmail,
  sendWelcomeEmail,
  sendPreOrderConfirmationEmail,
  sendPartnerPasswordSetupEmail,
  sendSubadminPasswordSetupEmail
};

