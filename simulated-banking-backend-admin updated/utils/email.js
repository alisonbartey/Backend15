// utils/email.js
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY); // Store your API key in .env

async function sendEmail({ to, subject, html }) {
  try {
    const response = await resend.emails.send({
      from: 'Your Bank <noreply@yourbank.com>', // Must be verified in Resend
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
