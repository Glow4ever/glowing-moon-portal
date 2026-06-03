const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, clientName, month, notificationEmail, fileName, comment } = req.body;

  const portalLink = 'https://portal.glowingmoonmedia.com/content';

  try {
    if (type === 'review') {
      await resend.emails.send({
        from: 'Glowing Moon Media <noreply@glowingmoonmedia.com>',
        to: notificationEmail,
        subject: `Your ${month} content is ready for review`,
        html: `
          <!DOCTYPE html>
          <html>
          <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
          <body style="margin:0;padding:0;background:#0a0a0b;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;padding:40px 20px;">
              <tr><td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

                  <!-- Header -->
                  <tr>
                    <td style="background:#111113;border-radius:12px 12px 0 0;padding:36px 40px;text-align:center;border-bottom:2px solid #D3C9A7;">
                      <div style="font-size:13px;letter-spacing:3px;color:#D3C9A7;text-transform:uppercase;font-weight:600;">Glowing Moon Media</div>
                    </td>
                  </tr>

                  <!-- Body -->
                  <tr>
                    <td style="background:#111113;padding:40px 40px 32px;">
                      <h1 style="margin:0 0 8px;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">Your ${month} content<br>is ready to review</h1>
                      <p style="margin:16px 0 0;font-size:15px;color:#888;line-height:1.6;">Hi ${clientName}, your content package for <strong style="color:#fff;">${month}</strong> has been uploaded to your portal. Take a look, leave any revision notes on specific files, and approve when everything looks good.</p>
                    </td>
                  </tr>

                  <!-- CTA -->
                  <tr>
                    <td style="background:#111113;padding:0 40px 40px;text-align:center;">
                      <a href="${portalLink}" style="display:inline-block;background:#D3C9A7;color:#000000;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:6px;letter-spacing:0.5px;">Review My Content</a>
                    </td>
                  </tr>

                  <!-- Divider -->
                  <tr>
                    <td style="background:#111113;padding:0 40px;">
                      <div style="border-top:1px solid #222;"></div>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="background:#111113;border-radius:0 0 12px 12px;padding:24px 40px;text-align:center;">
                      <p style="margin:0;font-size:12px;color:#444;line-height:1.6;">You're receiving this because you're a Glowing Moon Media client.<br>Questions? Reply to this email or contact us at <a href="mailto:contact@glowingmoonmedia.com" style="color:#D3C9A7;text-decoration:none;">contact@glowingmoonmedia.com</a></p>
                    </td>
                  </tr>

                </table>
              </td></tr>
            </table>
          </body>
          </html>
        `
      });
    }

    if (type === 'approved') {
      await resend.emails.send({
        from: 'Glowing Moon Media <noreply@glowingmoonmedia.com>',
        to: 'hector@glowingmoonmedia.com',
        subject: `${clientName} approved ${month} content`,
        html: `
          <!DOCTYPE html>
          <html>
          <body style="margin:0;padding:0;background:#0a0a0b;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;padding:40px 20px;">
              <tr><td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#111113;border-radius:12px;overflow:hidden;border-top:2px solid #D3C9A7;">
                  <tr>
                    <td style="padding:40px;">
                      <div style="font-size:13px;letter-spacing:3px;color:#D3C9A7;text-transform:uppercase;font-weight:600;margin-bottom:24px;">Glowing Moon Media</div>
                      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#ffffff;">Content Approved</h1>
                      <p style="margin:0;font-size:15px;color:#888;line-height:1.6;"><strong style="color:#fff;">${clientName}</strong> has approved all content for <strong style="color:#fff;">${month}</strong>. You're clear to schedule and publish.</p>
                    </td>
                  </tr>
                </table>
              </td></tr>
            </table>
          </body>
          </html>
        `
      });
    }

    if (type === 'comment') {
      await resend.emails.send({
        from: 'Glowing Moon Media <noreply@glowingmoonmedia.com>',
        to: 'hector@glowingmoonmedia.com',
        subject: `${clientName} requested a revision`,
        html: `
          <!DOCTYPE html>
          <html>
          <body style="margin:0;padding:0;background:#0a0a0b;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;padding:40px 20px;">
              <tr><td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#111113;border-radius:12px;overflow:hidden;border-top:2px solid #ff6b6b;">
                  <tr>
                    <td style="padding:40px;">
                      <div style="font-size:13px;letter-spacing:3px;color:#D3C9A7;text-transform:uppercase;font-weight:600;margin-bottom:24px;">Glowing Moon Media</div>
                      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#ffffff;">Revision Requested</h1>
                      <p style="margin:0 0 24px;font-size:15px;color:#888;line-height:1.6;"><strong style="color:#fff;">${clientName}</strong> left a note on <strong style="color:#fff;">${fileName}</strong>:</p>
                      <div style="background:#1a1a1c;border-left:3px solid #D3C9A7;border-radius:4px;padding:16px 20px;">
                        <p style="margin:0;font-size:15px;color:#fff;line-height:1.6;">${comment}</p>
                      </div>
                    </td>
                  </tr>
                </table>
              </td></tr>
            </table>
          </body>
          </html>
        `
      });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Email error:', err);
    return res.status(500).json({ error: err.message });
  }
};
