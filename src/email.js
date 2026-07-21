import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const fromEmail = process.env.RESEND_FROM_EMAIL || "hello@trackqa.dev";
const appUrl = process.env.APP_URL || "http://localhost:3000";

export async function sendVerificationEmail(email, token) {
  const verificationLink = `${appUrl}/verify-email?token=${token}`;
  try {
    const { data, error } = await resend.emails.send({
      from: `TrackQA <${fromEmail}>`,
      to: [email],
      subject: "Verify your email — TrackQA",
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 16px;">
          <h1 style="color: #f8fafc; font-size: 24px; margin-bottom: 8px;">Verify your email</h1>
          <p style="color: #94a3b8; font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
            Thanks for signing up for TrackQA. Click the button below to verify your email address and get started.
          </p>
          <a href="${verificationLink}" style="display: inline-block; background-color: #3b82f6; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px;">
            Verify Email
          </a>
          <p style="color: #64748b; font-size: 13px; margin-top: 32px; line-height: 1.5;">
            If you didn't create an account on TrackQA, you can safely ignore this email.
          </p>
          <p style="color: #475569; font-size: 12px; margin-top: 8px;">
            Link not working? Copy and paste this into your browser:<br />
            <span style="color: #3b82f6;">${verificationLink}</span>
          </p>
        </div>
      `,
    });

    if (error) {
      console.error("[Email] Failed to send verification email:", error);
    } else {
      console.log("[Email] Verification email sent to:", email, data?.id);
    }
  } catch (err) {
    console.error("[Email] Exception sending verification email:", err);
  }
}

export async function sendPasswordResetEmail(email, token) {
  const resetLink = `${appUrl}/reset-password?token=${token}`;
  try {
    const { data, error } = await resend.emails.send({
      from: `TrackQA <${fromEmail}>`,
      to: [email],
      subject: "Reset your password — TrackQA",
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 16px;">
          <h1 style="color: #f8fafc; font-size: 24px; margin-bottom: 8px;">Reset your password</h1>
          <p style="color: #94a3b8; font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
            You requested a password reset for your TrackQA account. Click the button below to choose a new password.
          </p>
          <a href="${resetLink}" style="display: inline-block; background-color: #3b82f6; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px;">
            Reset Password
          </a>
          <p style="color: #64748b; font-size: 13px; margin-top: 32px; line-height: 1.5;">
            If you didn't request a password reset, you can safely ignore this email. The link expires in 24 hours.
          </p>
          <p style="color: #475569; font-size: 12px; margin-top: 8px;">
            Link not working? Copy and paste this into your browser:<br />
            <span style="color: #3b82f6;">${resetLink}</span>
          </p>
        </div>
      `,
    });

    if (error) {
      console.error("[Email] Failed to send password reset email:", error);
    } else {
      console.log("[Email] Password reset email sent to:", email, data?.id);
    }
  } catch (err) {
    console.error("[Email] Exception sending password reset email:", err);
  }
}
