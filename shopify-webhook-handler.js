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
 * @param {string} email - Customer email
 * @param {string} firstName - Customer first name
 * @param {object} licensesByProduct - Object with product types as keys and license arrays as values
 * @param {string} password - Generated password (if new account)
 * @param {boolean} isNewAccount - Whether this is a new account
 */
async function sendLicenseEmail(email, firstName, licensesByProduct, password, isNewAccount) {
  // Product name mapping for display
  const productNames = {
    challengebuddy: 'ChallengeBuddy',
    reaction_zones: 'CB Reaction Level',
    cb_combo: 'CB Combo'
  };

  // Count total licenses
  const totalLicenses = Object.values(licensesByProduct).flat().length;
  
  const subject = isNewAccount 
    ? 'Your ChallengeBuddy License Keys 🎉'
    : 'New ChallengeBuddy License Keys Added 🎉';

  // Generate HTML for licenses grouped by product
  let licensesHtml = '';
  for (const [productType, licenses] of Object.entries(licensesByProduct)) {
    const productName = productNames[productType] || productType;
    licensesHtml += `
      <div style="margin-bottom: 25px;">
        <h4 style="color: #1877f2; margin-bottom: 12px;">📦 ${productName} (${licenses.length} ${licenses.length === 1 ? 'license' : 'licenses'})</h4>
        ${licenses.map((lic, idx) => `
          <div style="margin: 10px 0; padding: 10px; background: white; border-left: 3px solid #1877f2; border-radius: 4px;">
            🔑 <strong>License ${idx + 1}:</strong><br>
            <code style="background: #f5f5f5; padding: 8px 12px; border-radius: 4px; font-size: 16px; letter-spacing: 1px; display: inline-block; margin-top: 5px;">${lic}</code>
          </div>
        `).join('')}
      </div>
    `;
  }

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #1877f2;">Hi ${firstName || 'there'},</h2>
      
      <p>Thank you for your purchase! Your ${totalLicenses} license key${totalLicenses > 1 ? 's are' : ' is'} ready:</p>
      
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
        ${licensesHtml}
      </div>
      
      ${isNewAccount ? `
      <div style="background-color: #e3f2fd; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin-top: 0; color: #1877f2;">🌐 ACCESS YOUR PORTAL</h3>
        <p style="margin: 10px 0;"><strong>URL:</strong> <a href="https://portal.mychallengebuddy.com" style="color: #1877f2;">portal.mychallengebuddy.com</a></p>
        <p style="margin: 10px 0;"><strong>Email:</strong> ${email}</p>
        <p style="margin: 10px 0;"><strong>Password:</strong> <code style="background: white; padding: 5px 10px; border-radius: 4px;">${password}</code></p>
        <p style="font-size: 14px; color: #666; margin-top: 15px;">💡 Tip: You can change your password anytime in Account Settings.</p>
      </div>
      ` : `
      <div style="background-color: #e3f2fd; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin-top: 0; color: #1877f2;">🌐 ACCESS YOUR PORTAL</h3>
        <p><strong>URL:</strong> <a href="https://portal.mychallengebuddy.com" style="color: #1877f2;">portal.mychallengebuddy.com</a></p>
        <p>Your new licenses have been added to your existing account.</p>
      </div>
      `}
      
      <div style="margin-top: 30px; background-color: #f8f9fa; padding: 20px; border-radius: 8px;">
        <h3 style="margin-top: 0; color: #1877f2;">📋 NEXT STEPS</h3>
        <ol style="padding-left: 20px; line-height: 1.8;">
          <li>Log in to your portal</li>
          <li>View your active licenses</li>
          <li>Download the EA (Expert Advisor)</li>
          <li>Bind your licenses to your trading accounts</li>
        </ol>
      </div>
      
      <p style="margin-top: 30px; color: #666; font-size: 14px;">Need help? Just reply to this email and we'll assist you!</p>
      
      <p style="margin-top: 30px; font-size: 16px;">
        Happy trading!<br>
        <strong style="color: #1877f2;">- The ChallengeBuddy Team</strong>
      </p>
      
      <hr style="margin: 30px 0; border: none; border-top: 1px solid #e0e0e0;">
      <p style="color: #999; font-size: 12px; text-align: center;">ChallengeBuddy - Professional Trading License Management</p>
    </div>
  `;

  try {
    const result = await resend.emails.send({
      from: 'ChallengeBuddy <noreply@mychallengebuddy.com>',
      to: email,
      subject: subject,
      html: htmlContent,
    });
    
    console.log('✅ License email sent successfully to:', email);
    return result;
  } catch (error) {
    console.error('❌ Error sending license email:', error);
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

    // Detect products and count licenses
    let totalLicenses = 0;
    let productType = 'challengebuddy'; // Default product type
    const productsFound = [];
    
    for (const item of order.line_items) {
      const itemTitle = (item.title || item.name || '').toLowerCase();
      let licensesForItem = 0;
      let detectedProductType = null;
      
      // ChallengeBuddy (main product)
      if (itemTitle.includes('challengebuddy') || itemTitle.includes('my challenge buddy')) {
        licensesForItem = item.quantity * 2;
        detectedProductType = 'challengebuddy';
        console.log(`  ✅ Found: ${item.quantity}x "${item.title}" → ${licensesForItem} licenses (ChallengeBuddy)`);
      }
      // CB Reaction Level (formerly Reaction Zones)
      else if (itemTitle.includes('reaction level') || itemTitle.includes('reaction zone') || itemTitle.includes('reaction zones')) {
        licensesForItem = item.quantity * 2;
        detectedProductType = 'reaction_zones';
        console.log(`  ✅ Found: ${item.quantity}x "${item.title}" → ${licensesForItem} licenses (Reaction Level)`);
      }
      // CB Combo
      else if (itemTitle.includes('combo') || itemTitle.includes('cb combo')) {
        licensesForItem = item.quantity * 3; // Combo includes 3 licenses
        detectedProductType = 'cb_combo';
        console.log(`  ✅ Found: ${item.quantity}x "${item.title}" → ${licensesForItem} licenses (CB Combo)`);
      }
      
      if (licensesForItem > 0 && detectedProductType) {
        totalLicenses += licensesForItem;
        productsFound.push({
          type: detectedProductType,
          quantity: item.quantity,
          licenses: licensesForItem,
          title: item.title
        });
        // Use the first product type as default for single-product orders
        if (productsFound.length === 1) {
          productType = detectedProductType;
        }
      }
    }

    if (totalLicenses === 0) {
      console.log('ℹ️ No ChallengeBuddy products in order');
      return res.status(200).json({ message: 'No licenses to create' });
    }

    console.log(`🔑 Creating ${totalLicenses} licenses for ${customerEmail}`);
    console.log(`📦 Products found:`, productsFound);

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

    // Generate licenses (never expire) grouped by product
    const licensesByProduct = {};
    
    for (const product of productsFound) {
      licensesByProduct[product.type] = [];
      
      for (let i = 0; i < product.licenses; i++) {
        const licenseKey = generateLicenseKey();
        
        await pool.query(
          `INSERT INTO licenses 
           (user_id, license_key, status, platform, product_type, created_at, expires_at) 
           VALUES ($1, $2, 'active', 'MT5', $3, NOW(), NULL)`,
          [userId, licenseKey, product.type]
        );
        
        licensesByProduct[product.type].push(licenseKey);
        console.log(`  🔑 Created ${product.type} license: ${licenseKey}`);
      }
    }

    // Flatten all licenses for email
    const allLicenses = Object.values(licensesByProduct).flat();

    // Send email
    await sendLicenseEmail(
      customerEmail,
      customerFirstName,
      licensesByProduct,
      password,
      isNewAccount
    );

    console.log('✅ License email sent successfully');

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
