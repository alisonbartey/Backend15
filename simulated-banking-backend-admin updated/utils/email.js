// utils/email.js
const { Resend } = require('resend');

// Load API key from environment variables
const resend = new Resend(process.env.RESEND_API_KEY);

async function sendEmail({ to, subject, html }) {
  try {
    const response = await resend.emails.send({
      from: 'Wells Fargo Bank <onboarding@resend.dev>', // Using Resend's onboard sender
      to,
      subject,
      html,
    });

    console.log('Email sent:', response);
    return response;
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
}

module.exports = { sendEmail };
