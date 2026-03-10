import { Resend } from 'resend';

let connectionSettings: any;

async function getCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=resend',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  if (!connectionSettings || (!connectionSettings.settings.api_key)) {
    throw new Error('Resend not connected');
  }
  return { apiKey: connectionSettings.settings.api_key, fromEmail: connectionSettings.settings.from_email };
}

async function getUncachableResendClient() {
  const { apiKey, fromEmail } = await getCredentials();
  return {
    client: new Resend(apiKey),
    fromEmail
  };
}

export async function sendWelcomeEmail(
  toEmail: string,
  userName: string,
  resetToken: string,
  baseUrl: string
) {
  try {
    const { client, fromEmail } = await getUncachableResendClient();
    
    const setupUrl = `${baseUrl}/setup-password?token=${resetToken}`;
    
    const result = await client.emails.send({
      from: fromEmail || 'Poodflow <onboarding@resend.dev>',
      to: toEmail,
      subject: 'Welcome to Poodflow - Complete Your Registration',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; text-align: center; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #3b82f6; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
            .button:hover { background: #2563eb; }
            .footer { margin-top: 20px; font-size: 12px; color: #6b7280; text-align: center; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">Welcome to Poodflow!</h1>
            </div>
            <div class="content">
              <p>Hi ${userName},</p>
              <p>You've been invited to join the Poodflow team! To get started, please set up your password by clicking the button below:</p>
              <p style="text-align: center;">
                <a href="${setupUrl}" class="button" style="color: white;">Set Up Your Password</a>
              </p>
              <p>This link will expire in 24 hours for security reasons.</p>
              <p>If you didn't expect this invitation, you can safely ignore this email.</p>
              <p>Best regards,<br>The Poodflow Team</p>
            </div>
            <div class="footer">
              <p>If the button doesn't work, copy and paste this link into your browser:</p>
              <p style="word-break: break-all;">${setupUrl}</p>
            </div>
          </div>
        </body>
        </html>
      `
    });
    
    console.log('Welcome email sent:', result);
    return { success: true, result };
  } catch (error) {
    console.error('Failed to send welcome email:', error);
    return { success: false, error };
  }
}
