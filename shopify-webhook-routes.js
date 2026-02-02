const express = require('express');
const { handleShopifyOrderPaid } = require('./shopify-webhook-handler');

/**
 * Setup Shopify webhook routes
 * 
 * IMPORTANT: This route needs raw body access for signature verification
 * Add this to your main Express app BEFORE other JSON parsers
 */
function setupShopifyWebhook(app, pool) {
  
  // Raw body parser middleware for Shopify webhooks ONLY
  app.post('/webhook/shopify-order-paid',
    express.raw({ type: 'application/json' }),
    async (req, res, next) => {
      // Store raw body for signature verification
      req.rawBody = req.body.toString('utf8');
      
      // Parse JSON manually
      try {
        req.body = JSON.parse(req.rawBody);
      } catch (error) {
        return res.status(400).json({ error: 'Invalid JSON' });
      }
      
      next();
    },
    (req, res) => handleShopifyOrderPaid(req, res, pool)
  );
  
  console.log('✅ Shopify webhook route registered: POST /webhook/shopify-order-paid');
}

module.exports = { setupShopifyWebhook };
