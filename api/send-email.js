const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, clientName, month, portalLink, fileName, comment, notificationEmail } = req.body;

  try {
    if (type === 'review') {
      await resend.emails.send({
        from: 'Glowing Moon Media <noreply@glowingmoonmedia.com>',
        to: notificationEmail,
        subject: `Your ${month} content is ready for review`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
            <h2 style="color:#d4af37;">Your ${month} content is ready</h2>
            <p>Hi ${clientName},</p>
            <p>Your content for <strong>${month}</strong> has been uploaded and is ready for your review.</p>
            <p>Log in to the portal to preview files, leave comments on anything that needs revision, and approve the full month when you're ready.</p>
            <a href="${portalLink}" style="display:inline-block;background:#d4af37;color:#000;padding:12px 24px;text-decoration:none;border-radius:4px;font-weight:bold;margin:16px 0;">Review Content</a>
            <p style="color:#888;font-size:12px;">Glowing Moon Media</p>
          </div>
        `
      });
    }

    if (type === 'approved') {
      await resend.emails.send({
        from: 'Glowing Moon Media <noreply@glowingmoonmedia.com>',
        to: 'hector@glowingmoonmedia.com',
        subject: `${clientName} approved ${month} content`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
            <h2 style="color:#d4af37;">${clientName} approved their content</h2>
            <p><strong>${clientName}</strong> has approved all content for <strong>${month}</strong>.</p>
            <p style="color:#888;font-size:12px;">Glowing Moon Media Portal</p>
          </div>
        `
      });
    }

    if (type === 'comment') {
      await resend.emails.send({
        from: 'Glowing Moon Media <noreply@glowingmoonmedia.com>',
        to: 'hector@glowingmoonmedia.com',
        subject: `${clientName} left a revision note`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
            <h2 style="color:#d4af37;">Revision requested</h2>
            <p><strong>${clientName}</strong> left a comment on <strong>${fileName}</strong>:</p>
            <blockquote style="border-left:3px solid #d4af37;padding-left:16px;color:#333;">${comment}</blockquote>
            <p style="color:#888;font-size:12px;">Glowing Moon Media Portal</p>
          </div>
        `
      });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Email error:', err);
    return res.status(500).json({ error: err.message });
  }
};
