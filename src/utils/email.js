import nodemailer from "nodemailer"

// Create reusable transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER || "jaishivkumar1999@gmail.com",
    pass: process.env.EMAIL_PASS || "scyz eskz lmov lobe", 
  },
  tls: {
    rejectUnauthorized: false,
  },
})

/**
 * Send OTP email for password reset
 */
export const sendOtpEmail = async (email, otp, username = "User") => {
  const mailOptions = {
    from: process.env.EMAIL_USER || "jaishivkumar1999@gmail.com",
    to: email,
    subject: "Your OTP Code for Password Reset",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2 style="color: #333;">Password Reset Request</h2>
        <p>Hello ${username},</p>
        <p>We received a request to reset your password. Please use the following OTP (One-Time Password) to complete the process:</p>
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; text-align: center; font-size: 24px; letter-spacing: 5px; font-weight: bold;">
          ${otp}
        </div>
        <p>This OTP will expire in 15 minutes.</p>
        <p>If you didn't request this password reset, please ignore this email or contact support if you have concerns.</p>
        <p>Thank you,<br>Your App Team</p>
      </div>
    `,
  }

  try {
    const info = await transporter.sendMail(mailOptions)
    console.log("OTP email sent:", info.response)
    return info
  } catch (error) {
    console.error("Email sending error:", error)
    throw error
  }
}

