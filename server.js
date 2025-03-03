const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const nodemailer = require("nodemailer");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 9001;

// Create necessary directories
const emailsDir = path.join(__dirname, "saved_emails");
if (!fs.existsSync(emailsDir)) {
  fs.mkdirSync(emailsDir);
  console.log("Saved emails directory created");
}

// Create email logs directory
const emailLogsDir = path.join(__dirname, "email_logs");
if (!fs.existsSync(emailLogsDir)) {
  fs.mkdirSync(emailLogsDir);
  console.log("Email logs directory created");
}

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use(cors({
  origin: ["http://localhost:3000/*", "https://NQDa.netlify.app"], 
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.use(express.static("uploads"));

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
  console.log("Uploads directory created");
}

// Email validation function
const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return false;
  if (email.includes('..') || email.endsWith('.') || email.startsWith('.')) return false;
  if (email.includes('@@') || email.startsWith('@')) return false;
  const domain = email.split('@')[1];
  if (!domain || domain.length < 3) return false;
  const tld = domain.split('.').pop();
  if (!tld || tld.length < 2) return false;
  return true;
};

// Create a robust email transporter
const createTransporter = () => {
  return nodemailer.createTransport({
    service: "gmail",
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL,
      pass: process.env.EMAIL_PASS
    },
    tls: {
      rejectUnauthorized: false
    },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: 5,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });
};

// Function to log email attempts
const logEmailAttempt = (recipientEmail, success, messageId = null, errorDetails = null) => {
  try {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      recipient: recipientEmail,
      success,
      messageId,
      errorDetails: errorDetails ? JSON.stringify(errorDetails) : null
    };
    const date = new Date().toISOString().split('T')[0];
    const logFilePath = path.join(emailLogsDir, `email_log_${date}.json`);
    let logs = [];
    if (fs.existsSync(logFilePath)) {
      const fileContent = fs.readFileSync(logFilePath, 'utf8');
      logs = JSON.parse(fileContent);
    }
    logs.push(logEntry);
    fs.writeFileSync(logFilePath, JSON.stringify(logs, null, 2));
    console.log(`Email attempt logged: ${success ? 'SUCCESS' : 'FAILED'} - ${recipientEmail}`);
  } catch (err) {
    console.error("Error logging email attempt:", err);
  }
};

// Set up multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir); 
  },
  filename: (req, file, cb) => {
    cb(null, `photo-${Date.now()}${path.extname(file.originalname)}`);
  },
});
const upload = multer({ storage });

// Upload endpoint
app.post("/upload", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }
  console.log("File uploaded:", req.file.filename);
  res.json({ imageUrl: `/${req.file.filename}` });
});

// Get images endpoint
app.get("/images", (req, res) => {
  fs.readdir(uploadDir, (err, files) => {
    if (err) {
      console.error("Error reading uploads directory:", err);
      return res.status(500).json({ message: "Error reading uploads" });
    }
    res.json(files.map(file => ({ url: `/${file}` })));
  });
});

// Send contact message endpoint
app.post("/send-message", async (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ message: "All fields are required" });
  }
  console.log("Incoming message:", { name, email, message });
  const logDir = path.join(__dirname, "email_logs");
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
  }
  const logRequest = {
    timestamp: new Date().toISOString(),
    sender: email,
    name,
    messagePreview: message.substring(0, 50) + (message.length > 50 ? "..." : "")
  };
  
  fs.writeFileSync(
    path.join(logDir, `request_${Date.now()}.json`), 
    JSON.stringify(logRequest, null, 2)
  );

  try {
    console.log("Testing email credentials...");
    console.log("Using email:", process.env.EMAIL);
    console.log("Password length:", process.env.EMAIL_PASS ? process.env.EMAIL_PASS.length : 0);
    
    const transporter = nodemailer.createTransport({
      service: "gmail",
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_PASS
      },
      tls: {
        rejectUnauthorized: false
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      debug: true
    });
    
    await transporter.verify();
    console.log("Email server is ready");

    const formattedFrom = name ? `"${name}" <${email}>` : email;
    
    const mailOptions = {
      from: formattedFrom,
      to: process.env.EMAIL,
      subject: `New Message from ${name}`,
      text: `Email: ${email}\n\nMessage:\n${message}`,
      replyTo: email
    };

    const sendWithRetry = async (attempts = 3, delay = 1000) => {
      try {
        return await transporter.sendMail(mailOptions);
      } catch (error) {
        if (attempts <= 1) throw error;
        console.log(`Email send failed, retrying... (${attempts-1} attempts left)`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return sendWithRetry(attempts - 1, delay * 1.5);
      }
    };

    const info = await sendWithRetry();
    console.log("Email sent:", info.response);
    
    const logSuccess = {
      timestamp: new Date().toISOString(),
      sender: email,
      status: "success",
      messageId: info.messageId,
      response: info.response
    };

    fs.writeFileSync(
      path.join(logDir, `success_${Date.now()}.json`), 
      JSON.stringify(logSuccess, null, 2)
    );

    res.status(200).json({ message: "Email sent successfully" });
  } catch (error) {
    console.error("Error sending email:", error);
    
    const logError = {
      timestamp: new Date().toISOString(),
      sender: email,
      status: "error",
      errorCode: error.code || "unknown",
      errorMessage: error.message,
      stack: error.stack
    };
    
    fs.writeFileSync(
      path.join(logDir, `error_${Date.now()}.json`), 
      JSON.stringify(logError, null, 2)
    );

    const failedEmail = {
      timestamp: new Date().toISOString(),
      name,
      email,
      message
    };
    
    fs.writeFileSync(
      path.join(__dirname, "saved_emails", `failed_${Date.now()}.json`), 
      JSON.stringify(failedEmail, null, 2)
    );

    res.status(500).json({ 
      message: "Failed to send email. Your message has been saved and we'll try to process it later.", 
      error: error.message 
    });
  }
});

// Send photo strip endpoint
app.post("/send-photo-strip", async (req, res) => {
  const { recipientEmail, imageData } = req.body;

  console.log("Attempting to send photo strip to:", recipientEmail);
  console.log("Environment variables check:", {
    hasEmail: !!process.env.EMAIL,
    hasEmailPass: !!process.env.EMAIL_PASS
  });
  
  if (!recipientEmail || !imageData) {
    return res.status(400).json({ 
      success: false,
      message: "Missing email or image data" 
    });
  }
  
  if (!validateEmail(recipientEmail)) {
    return res.status(400).json({
      success: false,
      message: "Invalid email format"
    });
  }

  try {
    const transporter = createTransporter();
    await transporter.verify();
    console.log("Email transporter verified successfully");

    let imageContent;
    try {
      const parts = imageData.split("base64,");
      if (parts.length !== 2) {
        throw new Error("Invalid image data format");
      }
      imageContent = parts[1];
    } catch (error) {
      console.error("Error processing image data:", error);
      return res.status(400).json({
        success: false,
        message: "Invalid image data format"
      });
    }

    const mailOptions = {
      from: `"NQD Photobooth" <${process.env.EMAIL}>`,
      to: recipientEmail,
      subject: "Your Photo Strip from NQD 📸",
      text: "Thanks for using NQD! Here's your photo strip. We hope you had fun!",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
          <h1 style="color: #ff69b4; text-align: center;">Your NQD Photo Strip!</h1>
          <p style="text-align: center; font-size: 16px;">
            Thanks for using NQD! Here's your photo strip.
          </p>
          <div style="text-align: center; margin: 20px 0;">
            <img src="cid:photostrip" alt="Photo Strip" style="max-width: 100%; border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);" />
          </div>
          <p style="font-size: 14px; text-align: center; color: #777;">
            NQĐ. All Rights Reserved.
          </p>
        </div>
      `,
      attachments: [{
        filename: "photo-strip.png",
        content: imageContent,
        encoding: "base64",
        cid: "photostrip"
      }]
    };

    await new Promise(resolve => setTimeout(resolve, 300));

    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", info.messageId);
    
    logEmailAttempt(recipientEmail, true, info.messageId);

    res.status(200).json({
      success: true,
      message: "Photo strip sent successfully!",
      messageId: info.messageId
    });
  } catch (error) {
    console.error("Email sending error:", error);
    
    logEmailAttempt(recipientEmail, false, null, {
      code: error.code,
      message: error.message
    });
    
    let errorMessage = "Failed to send email";
    let statusCode = 500;
    
    if (error.code === 'EENVELOPE') {
      errorMessage = "Invalid recipient email address";
      statusCode = 400;
    } else if (error.code === 'ETIMEDOUT') {
      errorMessage = "Connection to email server timed out";
    } else if (error.code === 'EAUTH') {
      errorMessage = "Email authentication failed. Check your credentials.";
    }
    
    res.status(statusCode).json({
      success: false,
      message: errorMessage,
      error: error.toString()
    });
  }
});

// Saved emails endpoint
app.get("/saved-emails", (req, res) => {
  fs.readdir(emailsDir, (err, files) => {
    if (err) {
      return res.status(500).json({ message: "Error reading saved emails" });
    }
    const emails = files
      .filter(file => file.endsWith('.json'))
      .map(file => {
        const data = JSON.parse(fs.readFileSync(path.join(emailsDir, file)));
        return {
          filename: file,
          to: data.to,
          date: data.date
        };
      });
    res.json(emails);
  });
});

// Test endpoint to verify email configuration
app.get("/test-email", async (req, res) => {
  const testEmail = req.query.email;
  const adminKey = req.query.key;
  
  if (adminKey !== "NQD-admin-key") {
    return res.status(401).json({ message: "Unauthorized access" });
  }
  
  if (!testEmail) {
    return res.status(400).json({ message: "Email parameter is required" });
  }
  
  try {
    console.log("Testing email delivery to:", testEmail);
    
    if (!validateEmail(testEmail)) {
      return res.status(400).json({ message: "Invalid email format" });
    }
    
    const transporter = nodemailer.createTransport({
      service: "gmail",
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_PASS
      },
      tls: {
        rejectUnauthorized: false
      },
      debug: true,
      logger: true
    });
    
    const verificationResult = await transporter.verify();
    console.log("Transporter verification:", verificationResult);
    
    const mailOptions = {
      from: `"NQD Test" <${process.env.EMAIL}>`,
      to: testEmail,
      subject: "Email Delivery Test from NQD",
      text: "This is a test email to verify the delivery system is working correctly.",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f9f9f9; border-radius: 5px;">
          <h2 style="color: #ff69b4;">NQD Email Test</h2>
          <p>This is a test email to verify that our delivery system is working correctly.</p>
          <p>Current server time: ${new Date().toLocaleString()}</p>
          <p>If you received this email, the system is functioning properly!</p>
        </div>
      `
    };
    
    const info = await transporter.sendMail(mailOptions);
    
    console.log("Test email sent:", info);
    
    logEmailAttempt(testEmail, true, info.messageId, { type: "test_email" });
    
    res.json({
      success: true,
      message: "Test email sent successfully",
      details: {
        messageId: info.messageId,
        response: info.response,
        accepted: info.accepted,
        rejected: info.rejected,
        envelope: info.envelope
      }
    });
  } catch (error) {
    console.error("Test email error:", error);
    
    logEmailAttempt(testEmail, false, null, {
      code: error.code,
      message: error.message,
      type: "test_email"
    });
    
    res.status(500).json({
      success: false,
      message: "Failed to send test email",
      error: {
        code: error.code,
        message: error.message,
        response: error.response
      }
    });
  }
});

// Email stats endpoint
app.get("/email-stats", (req, res) => {
  const adminKey = req.query.key;
  
  if (adminKey !== "NQD-admin-key") {
    return res.status(401).json({ message: "Unauthorized access" });
  }
  
  try {
    const files = fs.readdirSync(emailLogsDir);
    let totalAttempts = 0;
    let successfulDeliveries = 0;
    let failedDeliveries = 0;
    let domainStats = {};
    
    files.forEach(file => {
      if (file.endsWith('.json')) {
        try {
          const content = fs.readFileSync(path.join(emailLogsDir, file), 'utf8');
          const logs = JSON.parse(content);
          
          logs.forEach(log => {
            totalAttempts++;
            
            if (log.success) {
              successfulDeliveries++;
            } else {
              failedDeliveries++;
            }
            
            try {
              const domain = log.recipient.split('@')[1];
              if (domain) {
                if (!domainStats[domain]) {
                  domainStats[domain] = { attempts: 0, success: 0, failure: 0 };
                }
                
                domainStats[domain].attempts++;
                if (log.success) {
                  domainStats[domain].success++;
                } else {
                  domainStats[domain].failure++;
                }
              }
            } catch (e) {
              console.error("Error processing domain stats:", e);
            }
          });
        } catch (error) {
          console.error(`Error reading log file ${file}:`, error);
        }
      }
    });
    
    Object.keys(domainStats).forEach(domain => {
      const stats = domainStats[domain];
      stats.successRate = stats.attempts > 0 
        ? (stats.success / stats.attempts * 100).toFixed(2) + "%" 
        : "0%";
    });
    
    res.json({
      totalAttempts,
      successfulDeliveries,
      failedDeliveries,
      successRate: totalAttempts > 0 ? (successfulDeliveries / totalAttempts * 100).toFixed(2) + "%" : "0%",
      domainStats
    });
  } catch (error) {
    res.status(500).json({ message: "Error retrieving stats", error: error.message });
  }
});

// Root endpoint
app.get("/", (req, res) => {
  res.send("NQD Backend is running");
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});