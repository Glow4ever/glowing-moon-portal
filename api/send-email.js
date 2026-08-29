const { requireAuth } = require('./_auth')
const { Resend } = require('resend')

const resend = new Resend(process.env.RESEND_API_KEY)

function sanitize(str) {
  if (typeof str !== 'string') return ''
  return str.replace(/[<>]/g, '').trim().slice(0, 2000)
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://portal.glowingmoonmedia.com')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await requireAuth(req, res)
  if (!user) return

  const { type, clientName, month, notificationEmail, fileName, comment, recipientEmail, content, reportType } = req.body

  const safeClient = sanitize(clientName)
  const safeMonth = sanitize(month)
  const safeEmail = sanitize(notificationEmail)
  const safeFile = sanitize(fileName)
  const safeComment = sanitize(comment)
  const safeRecipient = sanitize(recipientEmail)
  const safeContent = sanitize(content)
  const safeReportType = sanitize(reportType)

  const portalLink = 'https://portal.glowingmoonmedia.com/content'
  const loginLink = 'https://portal.glowingmoonmedia.com/login'

  try {
    if (type === 'review') {
      await resend.emails.send({
        from: 'Glowing Moon Media <noreply@glowingmoonmedia.com>',
        to: safeEmail,
        subject: `Your ${safeMonth} content is ready for review`,
        html: `
          <!DOCTYPE html>
          <html>
          <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
          <body style="margin:0;padding:0;background:#0a0a0b;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;padding:40px 20px;">
              <tr><td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
                  <tr>
                    <td style="background:#111113;border-radius:12px 12px 0 0;padding:36px 40px;text-align:center;border-bottom:2px solid #D3C9A7;">
                      <div style="font-size:13px;letter-spacing:3px;color:#D3C9A7;text-transform:uppercase;font-weight:600;">Glowing Moon Media</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="background:#111113;padding:40px 40px 32px;">
                      <h1 style="margin:0 0 8px;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">Your ${safeMonth} content<br>is ready to review</h1>
                      <p style="margin:16px 0 0;font-size:15px;color:#888;line-height:1.6;">Hi ${safeClient}, your content package for <strong style="color:#fff;">${safeMonth}</strong> has been uploaded to your portal. Take a look, leave any revision notes on specific files, and approve when everything looks good.</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="background:#111113;padding:0 40px 40px;text-align:center;">
                      <a href="${portalLink}" style="display:inline-block;background:#D3C9A7;color:#000000;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:6px;letter-spacing:0.5px;">Review My Content</a>
                    </td>
                  </tr>
                  <tr><td style="background:#111113;padding:0 40px;"><div style="border-top:1px solid #222;"></div></td></tr>
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
      })
    }

    if (type === 'approved') {
      await resend.emails.send({
        from: 'Glowing Moon Media <noreply@glowingmoonmedia.com>',
        to: 'hector@glowingmoonmedia.com',
        subject: `${safeClient} approved ${safeMonth} content`,
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
                      <p style="margin:0;font-size:15px;color:#888;line-height:1.6;"><strong style="color:#fff;">${safeClient}</strong> has approved all content for <strong style="color:#fff;">${safeMonth}</strong>. You're clear to schedule and publish.</p>
                    </td>
                  </tr>
                </table>
              </td></tr>
            </table>
          </body>
          </html>
        `
      })
    }

    if (type === 'comment') {
      await resend.emails.send({
        from: 'Glowing Moon Media <noreply@glowingmoonmedia.com>',
        to: 'hector@glowingmoonmedia.com',
        subject: `${safeClient} requested a revision`,
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
                      <p style="margin:0 0 24px;font-size:15px;color:#888;line-height:1.6;"><strong style="color:#fff;">${safeClient}</strong> left a note on <strong style="color:#fff;">${safeFile}</strong>:</p>
                      <div style="background:#1a1a1c;border-left:3px solid #D3C9A7;border-radius:4px;padding:16px 20px;">
                        <p style="margin:0;font-size:15px;color:#fff;line-height:1.6;">${safeComment}</p>
                      </div>
                    </td>
                  </tr>
                </table>
              </td></tr>
            </table>
          </body>
          </html>
        `
      })
    }

    if (type === 'comment_reply') {
      await resend.emails.send({
        from: 'Glowing Moon Media <noreply@glowingmoonmedia.com>',
        to: safeEmail,
        subject: `New reply on ${safeFile}`,
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
                      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#ffffff;">New reply on your note</h1>
                      <p style="margin:0 0 24px;font-size:15px;color:#888;line-height:1.6;">Your team replied to your note on <strong style="color:#fff;">${safeFile}</strong>:</p>
                      <div style="background:#1a1a1c;border-left:3px solid #D3C9A7;border-radius:4px;padding:16px 20px;">
                        <p style="margin:0;font-size:15px;color:#fff;line-height:1.6;">${safeComment}</p>
                      </div>
                      <p style="margin:24px 0 0;font-size:14px;color:#888;">
                        <a href="${portalLink}" style="color:#D3C9A7;text-decoration:none;">View the full thread in your portal →</a>
                      </p>
                    </td>
                  </tr>
                </table>
              </td></tr>
            </table>
          </body>
          </html>
        `
      })
    }

    if (type === 'file_revised') {
      await resend.emails.send({
        from: 'Glowing Moon Media <noreply@glowingmoonmedia.com>',
        to: safeEmail,
        subject: `A revised file is ready for your review`,
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
                      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#ffffff;">One file, revised and ready</h1>
                      <p style="margin:0 0 24px;font-size:15px;color:#888;line-height:1.6;">We've updated <strong style="color:#fff;">${safeFile}</strong> based on your note — take a look whenever you get a chance.</p>
                      <p style="margin:0;font-size:14px;color:#888;">
                        <a href="${portalLink}" style="color:#D3C9A7;text-decoration:none;">Review it in your portal →</a>
                      </p>
                    </td>
                  </tr>
                </table>
              </td></tr>
            </table>
          </body>
          </html>
        `
      })
    }

    if (type === 'client_report') {
      const isMonthly = safeReportType === 'month_in_review'
      await resend.emails.send({
        from: 'Glowing Moon Media <noreply@glowingmoonmedia.com>',
        to: safeEmail,
        subject: isMonthly ? 'Your month in review' : 'A quick update on your content',
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
                      <h1 style="margin:0 0 20px;font-size:24px;font-weight:700;color:#ffffff;">${isMonthly ? 'Your Month in Review' : "Here's what we've been up to"}</h1>
                      <div style="font-size:15px;color:#ddd;line-height:1.7;white-space:pre-wrap;">${safeContent}</div>
                      <p style="margin:28px 0 0;font-size:14px;color:#888;">
                        <a href="${portalLink}" style="color:#D3C9A7;text-decoration:none;">View your full portal →</a>
                      </p>
                    </td>
                  </tr>
                </table>
              </td></tr>
            </table>
          </body>
          </html>
        `
      })
    }

    if (type === 'welcome') {
      await resend.emails.send({
        from: 'Glowing Moon Media <noreply@glowingmoonmedia.com>',
        to: safeRecipient,
        subject: `You've been added to the ${safeClient} portal`,
        html: `
          <!DOCTYPE html>
          <html>
          <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
          <body style="margin:0;padding:0;background:#0a0a0b;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;padding:40px 20px;">
              <tr><td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
                  <tr>
                    <td style="background:#111113;border-radius:12px 12px 0 0;padding:36px 40px;text-align:center;border-bottom:2px solid #D3C9A7;">
                      <div style="font-size:13px;letter-spacing:3px;color:#D3C9A7;text-transform:uppercase;font-weight:600;">Glowing Moon Media</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="background:#111113;padding:40px 40px 32px;">
                      <h1 style="margin:0 0 8px;font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:400;color:#ffffff;line-height:1.3;">Welcome to the<br>${safeClient} portal</h1>
                      <p style="margin:16px 0 0;font-size:15px;color:#888;line-height:1.6;">You now have access to ${safeClient}'s client portal, where you can view assets, review content, check the schedule, and message the team.</p>
                      <p style="margin:16px 0 0;font-size:15px;color:#888;line-height:1.6;">To get started, go to the login page below and click <strong style="color:#fff;">Forgot Password</strong> to set your own password.</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="background:#111113;padding:0 40px 40px;text-align:center;">
                      <a href="${loginLink}" style="display:inline-block;background:#D3C9A7;color:#000000;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:6px;letter-spacing:0.5px;">Go to Portal Login</a>
                    </td>
                  </tr>
                  <tr><td style="background:#111113;padding:0 40px;"><div style="border-top:1px solid #222;"></div></td></tr>
                  <tr>
                    <td style="background:#111113;border-radius:0 0 12px 12px;padding:24px 40px;text-align:center;">
                      <p style="margin:0;font-size:12px;color:#444;line-height:1.6;">Your login email is <strong style="color:#888;">${safeRecipient}</strong>.<br>Questions? Reply to this email or contact us at <a href="mailto:contact@glowingmoonmedia.com" style="color:#D3C9A7;text-decoration:none;">contact@glowingmoonmedia.com</a></p>
                    </td>
                  </tr>
                </table>
              </td></tr>
            </table>
          </body>
          </html>
        `
      })
    }

    return res.status(200).json({ success: true })
  } catch (err) {
    console.error('Email error:', err)
    return res.status(500).json({ error: err.message })
  }
}
