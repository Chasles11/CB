const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Resend } = require('resend');

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// Shopify webhook secret
const SHOPIFY_WEBHOOK_SECRET = 'b071e25ca2d71245bcfd7cc3987a48fe19525f1cee4d2b1e7e480f7a5b4a5e75';

/**
 * Verify Shopify webhook signature
 */
function verifyShopifyWebhook(body, hmacHeader) {
  const hash = crypto
    .createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
    .update(body, 'utf8')
    .digest('base64');
  
  return hash === hmacHeader;
}

/**
 * Generate simple readable password (8 characters, alphanumeric)
 */
function generateSimplePassword() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let password = '';
  for (let i = 0; i < 8; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

/**
 * Generate license key in format: XXXX-XXXX-XXXX-XXXX
 */
function generateLicenseKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const segments = [];
  
  for (let i = 0; i < 4; i++) {
    let segment = '';
    for (let j = 0; j < 4; j++) {
      segment += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    segments.push(segment);
  }
  
  return segments.join('-');
}

/**
 * Send license email via Resend
 */
async function sendLicenseEmail(email, firstName, licenses, password, isNewAccount) {
  const licenseList = licenses.map((lic, idx) => `🔑 License Key ${idx + 1}: ${lic}`).join('\n');
  
  const subject = isNewAccount 
    ? 'Your myChallengeBuddy License Keys 🎉'
    : 'New myChallengeBuddy License Keys Added 🎉';
  
  const loginSection = isNewAccount 
    ? `
---

ACCESS YOUR PORTAL:
👉 https://portal.mychallengebuddy.com

Email: ${email}
Password: ${password}

💡 Tip: You can change your password anytime in Account Settings.
`
    : `
---

ACCESS YOUR PORTAL:
👉 https://portal.mychallengebuddy.com

Your new licenses have been added to your existing account.
`;

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2>Hi ${firstName || 'there'},</h2>
      
      <p>Thank you for your purchase! Your ${licenses.length} license key${licenses.length > 1 ? 's are' : ' is'} ready:</p>
      
      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        ${licenses.map((lic, idx) => `<div style="margin: 10px 0;">🔑 <strong>License Key ${idx + 1}:</strong> <code style="background: white; padding: 5px 10px; border-radius: 3px;">${lic}</code></div>`).join('')}
      </div>
      
      ${isNewAccount ? `
      <div style="background-color: #e3f2fd; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <h3 style="margin-top: 0;">🌐 ACCESS YOUR PORTAL:</h3>
        <p><strong>URL:</strong> <a href="https://portal.mychallengebuddy.com">portal.mychallengebuddy.com</a></p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Password:</strong> <code style="background: white; padding: 5px 10px; border-radius: 3px;">${password}</code></p>
        <p style="font-size: 14px; color: #666;">💡 Tip: You can change your password anytime in Account Settings.</p>
      </div>
      ` : `
      <div style="background-color: #e3f2fd; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <h3 style="margin-top: 0;">🌐 ACCESS YOUR PORTAL:</h3>
        <p><strong>URL:</strong> <a href="https://portal.mychallengebuddy.com">portal.mychallengebuddy.com</a></p>
        <p>Your new licenses have been added to your existing account.</p>
      </div>
      `}
      
      <div style="margin-top: 30px;">
        <h3>📋 NEXT STEPS:</h3>
        <ol>
          <li>Log in to your portal</li>
          <li>Download the EA (Expert Advisor)</li>
          <li>Bind your licenses to your trading accounts</li>
        </ol>
      </div>
      
      <p style="margin-top: 30px; color: #666;">Need help? Just reply to this email.</p>
      
      <p style="margin-top: 20px;">Happy trading!<br><strong>- The myChallengeBuddy Team</strong></p>
    </div>
  `;

  try {
    const result = await resend.emails.send({
      from: 'myChallengeBuddy <noreply@mychallengebuddy.com>',
      to: email,
      subject: subject,
      html: htmlContent,
    });
    
    return result;
  } catch (error) {
    console.error('Error sending license email:', error);
    throw error;
  }
}

/**
 * Main Shopify webhook handler
 */
async function handleShopifyOrderPaid(req, res, pool) {
  try {
    // Verify webhook signature
    const hmacHeader = req.headers['x-shopify-hmac-sha256'];
    const rawBody = req.rawBody; // You'll need to capture raw body in Express
    
    if (!hmacHeader || !verifyShopifyWebhook(rawBody, hmacHeader)) {
      console.error('Invalid Shopify webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const order = req.body;
    console.log('Received Shopify order:', order.id, order.order_number);

    // Extract customer info
    const customerEmail = order.email;
    const customerFirstName = order.customer?.first_name || order.billing_address?.first_name || '';
    const customerLastName = order.customer?.last_name || order.billing_address?.last_name || '';
    const customerName = `${customerFirstName} ${customerLastName}`.trim() || 'Customer';

    if (!customerEmail) {
      console.error('No email found in order');
      return res.status(400).json({ error: 'No customer email found' });
    }

    // Count "myChallengeBuddy" products in order
    let totalLicenses = 0;
    for (const item of order.line_items) {
      if (item.title === 'myChallengeBuddy' || item.name === 'myChallengeBuddy') {
        // Each product = 2 licenses, multiply by quantity
        totalLicenses += item.quantity * 2;
      }
    }

    if (totalLicenses === 0) {
      console.log('No myChallengeBuddy products in order');
      return res.status(200).json({ message: 'No licenses to create' });
    }

    console.log(`Creating ${totalLicenses} licenses for ${customerEmail}`);

    // Check if user exists
    const userCheck = await pool.query(
      'SELECT id, email FROM users WHERE email = $1',
      [customerEmail.toLowerCase()]
    );

    let userId;
    let isNewAccount = false;
    let password = null;

    if (userCheck.rows.length === 0) {
      // Create new account
      console.log('Creating new account for:', customerEmail);
      isNewAccount = true;
      password = generateSimplePassword();
      const hashedPassword = await bcrypt.hash(password, 10);

      const userResult = await pool.query(
        'INSERT INTO users (email, password_hash, name, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id',
        [customerEmail.toLowerCase(), hashedPassword, customerName]
      );
      
      userId = userResult.rows[0].id;
      console.log('Created user ID:', userId);
    } else {
      // Existing user
      userId = userCheck.rows[0].id;
      console.log('Existing user ID:', userId);
    }

    // Generate licenses (never expire)
    const licenses = [];
    for (let i = 0; i < totalLicenses; i++) {
      const licenseKey = generateLicenseKey();
      
      await pool.query(
        `INSERT INTO licenses 
         (user_id, license_key, status, platform, created_at, expires_at) 
         VALUES ($1, $2, 'active', 'MT5', NOW(), NULL)`,
        [userId, licenseKey]
      );
      
      licenses.push(licenseKey);
      console.log(`Created license: ${licenseKey}`);
    }

    // Send email
    await sendLicenseEmail(
      customerEmail,
      customerFirstName,
      licenses,
      password,
      isNewAccount
    );

    console.log('License email sent successfully');

    // Log the order in database (optional tracking)
    await pool.query(
      `INSERT INTO shopify_orders 
       (order_id, email, licenses_created, created_at) 
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (order_id) DO NOTHING`,
      [order.id.toString(), customerEmail, totalLicenses]
    );

    return res.status(200).json({
      success: true,
      licenses_created: totalLicenses,
      email: customerEmail,
      is_new_account: isNewAccount
    });

  } catch (error) {
    console.error('Error processing Shopify webhook:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  handleShopifyOrderPaid,
  verifyShopifyWebhook
};
