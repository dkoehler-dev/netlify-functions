import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { Resend } from 'resend';

// Type definitions
interface ContactFormData {
  name: string;
  email: string;
  subject?: string;
  message: string;
  phone?: string;
  company?: string;
}

interface ApiResponse {
  success: boolean;
  message: string;
  error?: string;
}

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// Configuration
const CONFIG = {
  recipientEmail: process.env.RECIPIENT_EMAIL!,
  fromEmail: process.env.FROM_EMAIL!,
  fromName: process.env.FROM_NAME || 'PortfolioWebsite',
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || [],
  maxMessageLength: 2000,
  rateLimitWindowMs: 60000, // 1 minute
  maxRequestsPerWindow: 5,
};

// Simple in-memory rate limiting (for basic protection)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

// Utility functions
const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const sanitizeString = (str: string): string => {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim();
};

const checkRateLimit = (clientIP: string): boolean => {
  const now = Date.now();
  const clientData = rateLimitMap.get(clientIP);

  if (!clientData || now > clientData.resetTime) {
    rateLimitMap.set(clientIP, {
      count: 1,
      resetTime: now + CONFIG.rateLimitWindowMs,
    });
    return true;
  }

  if (clientData.count >= CONFIG.maxRequestsPerWindow) {
    return false;
  }

  clientData.count++;
  return true;
};

const validateContactData = (data: any): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (!data.name || typeof data.name !== 'string' || data.name.trim().length < 2) {
    errors.push('Name is required and must be at least 2 characters');
  }

  if (!data.email || typeof data.email !== 'string' || !isValidEmail(data.email)) {
    errors.push('Valid email address is required');
  }

  if (!data.message || typeof data.message !== 'string' || data.message.trim().length < 10) {
    errors.push('Message is required and must be at least 10 characters');
  }

  if (data.message && data.message.length > CONFIG.maxMessageLength) {
    errors.push(`Message must be less than ${CONFIG.maxMessageLength} characters`);
  }

  return { isValid: errors.length === 0, errors };
};

const createEmailContent = (data: ContactFormData): { subject: string; html: string; text: string } => {
  const subject = data.subject
    ? `Contact form: ${sanitizeString(data.subject)}`
    : `New contact from ${sanitizeString(data.name)}`;

  // Use table-based layout and inline styles for cross-client rendering
  const html = `
<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${subject}</title>
  </head>
  <body style="margin:0; padding:0; background-color:#f4f5f7;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f4f5f7;">
      <tr>
        <td align="center" style="padding:24px 16px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:600px; background-color:#ffffff; border-radius:8px; overflow:hidden; box-shadow:0 1px 3px rgba(16,24,40,0.1);">
            <tr>
              <td style="padding:24px 24px 0 24px;">
                <h1 style="margin:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, 'Apple Color Emoji', 'Segoe UI Emoji'; font-size:20px; line-height:28px; color:#111827;">New contact form submission</h1>
                <p style="margin:8px 0 0 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial; font-size:14px; line-height:20px; color:#6b7280;">You received a new message from your website.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px 0 24px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f9fafb; border:1px solid #e5e7eb; border-radius:8px;">
                  <tr>
                    <td style="padding:16px 16px 0 16px;">
                      <p style="margin:0 0 8px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial; font-size:14px; line-height:20px; color:#111827;"><strong style="color:#111827;">Name:</strong> ${sanitizeString(data.name)}</p>
                      <p style="margin:0 0 8px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial; font-size:14px; line-height:20px; color:#111827;"><strong style="color:#111827;">Email:</strong> ${sanitizeString(data.email)}</p>
                      ${data.phone ? `<p style="margin:0 0 8px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial; font-size:14px; line-height:20px; color:#111827;"><strong style=\"color:#111827;\">Phone:</strong> ${sanitizeString(data.phone)}</p>` : ''}
                      ${data.company ? `<p style="margin:0 0 8px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial; font-size:14px; line-height:20px; color:#111827;"><strong style=\"color:#111827;\">Company:</strong> ${sanitizeString(data.company)}</p>` : ''}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 16px 16px 16px;">
                      <p style="margin:8px 0 8px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial; font-size:14px; line-height:20px; color:#111827;"><strong style="color:#111827;">Subject:</strong> ${data.subject ? sanitizeString(data.subject) : 'Contact form submission'}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px 24px 24px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border:1px solid #e5e7eb; border-radius:8px;">
                  <tr>
                    <td style="padding:12px 16px; background-color:#f9fafb; border-bottom:1px solid #e5e7eb;">
                      <p style="margin:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial; font-weight:600; font-size:14px; line-height:20px; color:#111827;">Message</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:16px; background-color:#ffffff;">
                      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial; font-size:14px; line-height:22px; color:#111827; white-space:pre-wrap;">${sanitizeString(data.message)}</div>
                    </td>
                  </tr>
                </table>
                <p style="margin:16px 0 0 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial; font-size:12px; line-height:18px; color:#6b7280;">Sent on ${new Date().toLocaleString()}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>`;

  const text = `New contact form submission\n\nName: ${data.name}\nEmail: ${data.email}\n${data.phone ? `Phone: ${data.phone}\n` : ''}${data.company ? `Company: ${data.company}\n` : ''}Subject: ${data.subject || 'Contact form submission'}\n\nMessage:\n${data.message}\n\nSent on: ${new Date().toLocaleString()}`;

  return { subject, html, text };
};

// Main handler function
export const handler: Handler = async (
  event: HandlerEvent,
  context: HandlerContext
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> => {
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': CONFIG.allowedOrigins.length > 0 
      ? (CONFIG.allowedOrigins.includes(event.headers.origin || '') ? event.headers.origin || '' : 'null')
      : '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  try {
    // Handle preflight OPTIONS request
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'CORS preflight successful' }),
      };
    }

    // Only allow POST method
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          message: 'Method not allowed. Use POST.',
        } as ApiResponse),
      };
    }

    // Rate limiting
    const clientIP = event.headers['client-ip'] || event.headers['x-forwarded-for'] || 'unknown';
    if (!checkRateLimit(clientIP)) {
      return {
        statusCode: 429,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          message: 'Too many requests. Please try again later.',
        } as ApiResponse),
      };
    }

    // Parse request body
    let contactData: ContactFormData;
    try {
      contactData = JSON.parse(event.body || '{}');
    } catch (parseError) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          message: 'Invalid JSON in request body',
        } as ApiResponse),
      };
    }

    // Validate input data
    const validation = validateContactData(contactData);
    if (!validation.isValid) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          message: 'Validation failed',
          error: validation.errors.join(', '),
        } as ApiResponse),
      };
    }

    // Create email content
    const emailContent = createEmailContent(contactData);

    // Send email via Resend
    const emailResult = await resend.emails.send({
      from: CONFIG.fromName ? `${CONFIG.fromName} <${CONFIG.fromEmail}>` : CONFIG.fromEmail,
      to: CONFIG.recipientEmail,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
      replyTo: contactData.email,
    });

    if (emailResult.error) {
      console.error('Resend API error:', emailResult.error);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          message: 'Failed to send email. Please try again.',
        } as ApiResponse),
      };
    }

    // Success response
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Message sent successfully!',
      } as ApiResponse),
    };

  } catch (error) {
    console.error('Unexpected error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        message: 'An unexpected error occurred. Please try again.',
      } as ApiResponse),
    };
  }
};