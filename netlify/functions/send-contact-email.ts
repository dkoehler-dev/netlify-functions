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
  return str.trim().replace(/[<>]/g, '');
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
    ? `Contact Form: ${sanitizeString(data.subject)}`
    : `New Contact Form Submission from ${sanitizeString(data.name)}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px;">
        New Contact Form Submission
      </h2>
      
      <div style="background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
        <p><strong>Name:</strong> ${sanitizeString(data.name)}</p>
        <p><strong>Email:</strong> ${sanitizeString(data.email)}</p>
        ${data.phone ? `<p><strong>Phone:</strong> ${sanitizeString(data.phone)}</p>` : ''}
        ${data.company ? `<p><strong>Company:</strong> ${sanitizeString(data.company)}</p>` : ''}
      </div>
      
      <div style="margin: 20px 0;">
        <h3 style="color: #333; margin-bottom: 10px;">Message:</h3>
        <div style="background: white; padding: 15px; border-left: 4px solid #007bff; border-radius: 3px;">
          ${sanitizeString(data.message).replace(/\n/g, '<br>')}
        </div>
      </div>
      
      <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666;">
        <p>This message was sent via your website contact form on ${new Date().toLocaleString()}.</p>
      </div>
    </div>
  `;

  const text = `
New Contact Form Submission

Name: ${data.name}
Email: ${data.email}
${data.phone ? `Phone: ${data.phone}` : ''}
${data.company ? `Company: ${data.company}` : ''}

Message:
${data.message}

Sent on: ${new Date().toLocaleString()}
  `;

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
      from: CONFIG.fromEmail,
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