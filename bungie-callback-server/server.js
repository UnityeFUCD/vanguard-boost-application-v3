// Express server setup
const express = require('express');
const axios = require('axios');
require('dotenv').config();
const app = express();
const PORT = process.env.PORT || 3000;

// Airtable setup
const Airtable = require('airtable');
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const table = base(process.env.AIRTABLE_TABLE_NAME);

// Bungie API credentials
const BUNGIE_CLIENT_ID = process.env.BUNGIE_CLIENT_ID;
const BUNGIE_API_KEY = process.env.BUNGIE_API_KEY;
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://vanguard-bungie-verify-c7de395776dd.herokuapp.com/callback';

// Middleware to parse JSON
app.use(express.json());

// Handle callback from Bungie OAuth
app.get('/callback', async (req, res) => {
  try {
    // Get the authorization code and state from the URL
    const { code, state } = req.query;
    
    if (!code) {
      return res.status(400).send('Authorization code missing');
    }
    
    if (!state) {
      return res.status(400).send('State parameter missing');
    }
    
    // The state parameter now contains the nickname directly
    const userNickname = decodeURIComponent(state);
    
    console.log('Received nickname from state parameter:', userNickname);
    
    // Exchange authorization code for access token
    const tokenResponse = await axios.post(
      'https://www.bungie.net/platform/app/oauth/token/',
      `grant_type=authorization_code&code=${code}&client_id=${BUNGIE_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-API-Key': BUNGIE_API_KEY
        }
      }
    );

    const accessToken = tokenResponse.data.access_token;
    
    if (!accessToken) {
      throw new Error('Failed to get access token');
    }
    
    // Get Bungie user info with the access token
    const userResponse = await axios.get(
      'https://www.bungie.net/platform/User/GetCurrentBungieNetUser/',
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'X-API-Key': BUNGIE_API_KEY
        }
      }
    );
    
    const bungieUsername = userResponse.data.Response.displayName;
    
    console.log('Bungie username:', bungieUsername);
    console.log('Application nickname:', userNickname);

    // Check if the Bungie username matches the nickname from the application
    // This is now a direct comparison without querying Airtable
    if (bungieUsername.toLowerCase() === userNickname.toLowerCase()) {
      console.log('Username verified successfully!');
      
      // After successful verification, update the record in Airtable
      try {
        // Find the record with the matching nickname in Airtable
        const records = await table.select({
          filterByFormula: `{nickname} = '${userNickname}'`
        }).firstPage();
        
        if (records.length > 0) {
          // Update the record to mark it as verified
          await table.update(records[0].id, {
            'verified': true,
            'bungieUsername': bungieUsername
          });
          console.log('Airtable record updated successfully');
        } else {
          console.log('Could not find matching record in Airtable');
          // Even if we can't find the record, the verification is still successful
          // because we directly compared the nickname from state param with Bungie username
        }
      } catch (airtableError) {
        console.error('Error updating Airtable:', airtableError);
        // We don't fail the verification if Airtable update fails
      }
      
      return res.send(`
        <html>
          <head>
            <title>Verification Successful</title>
            <style>
              body {
                font-family: Arial, sans-serif;
                background-color: #101114;
                color: #ffffff;
                text-align: center;
                padding: 50px 20px;
              }
              .container {
                max-width: 600px;
                margin: 0 auto;
                background-color: rgba(0, 0, 0, 0.5);
                padding: 30px;
                border-radius: 8px;
              }
              h1 {
                color: #c4ff00;
              }
              .success-icon {
                font-size: 60px;
                color: #c4ff00;
                margin-bottom: 20px;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="success-icon">✓</div>
              <h1>Verification Successful!</h1>
              <p>Your Bungie account has been successfully verified.</p>
              <p>You may now close this window and return to Discord.</p>
            </div>
          </body>
        </html>
      `);
    } else {
      console.log('Verification failed: username mismatch');
      return res.status(400).send(`
        <html>
          <head>
            <title>Verification Failed</title>
            <style>
              body {
                font-family: Arial, sans-serif;
                background-color: #101114;
                color: #ffffff;
                text-align: center;
                padding: 50px 20px;
              }
              .container {
                max-width: 600px;
                margin: 0 auto;
                background-color: rgba(0, 0, 0, 0.5);
                padding: 30px;
                border-radius: 8px;
              }
              h1 {
                color: #ff3e3e;
              }
              .error-icon {
                font-size: 60px;
                color: #ff3e3e;
                margin-bottom: 20px;
              }
              .details {
                text-align: left;
                background-color: rgba(255, 62, 62, 0.1);
                padding: 15px;
                border-radius: 5px;
                margin: 20px 0;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="error-icon">✗</div>
              <h1>Verification Failed</h1>
              <p>The Bungie username does not match the nickname you provided in your application.</p>
              <div class="details">
                <p><strong>Bungie Username:</strong> ${bungieUsername}</p>
                <p><strong>Application Nickname:</strong> ${userNickname}</p>
              </div>
              <p>Please make sure you're logged in with the correct Bungie account and try again.</p>
            </div>
          </body>
        </html>
      `);
    }
  } catch (error) {
    console.error('Error during verification:', error);
    
    // Handle specific errors
    let errorMessage = 'An unexpected error occurred during verification.';
    
    if (error.response) {
      if (error.response.status === 401) {
        errorMessage = 'Authentication failed. Please try again.';
      } else if (error.response.data && error.response.data.error_description) {
        errorMessage = error.response.data.error_description;
      }
    }
    
    return res.status(500).send(`
      <html>
        <head>
          <title>Verification Error</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              background-color: #101114;
              color: #ffffff;
              text-align: center;
              padding: 50px 20px;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              background-color: rgba(0, 0, 0, 0.5);
              padding: 30px;
              border-radius: 8px;
            }
            h1 {
              color: #ff3e3e;
            }
            .error-icon {
              font-size: 60px;
              color: #ff3e3e;
              margin-bottom: 20px;
            }
            pre {
              text-align: left;
              background-color: rgba(255, 255, 255, 0.1);
              padding: 15px;
              border-radius: 5px;
              overflow-x: auto;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="error-icon">⚠</div>
            <h1>Verification Error</h1>
            <p>${errorMessage}</p>
            <p>Please try again or contact support if the issue persists.</p>
          </div>
        </body>
      </html>
    `);
  }
});

// Simple home page
app.get('/', (req, res) => {
  res.send('Bungie OAuth Verification Service');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});