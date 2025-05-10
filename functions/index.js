/* eslint-disable no-case-declarations */
/* eslint-disable no-unused-vars */
/* eslint-disable valid-jsdoc */
/* eslint-disable max-len */
// index.js - Firebase Cloud Function that sends WhatsApp messages via Twilio
// when new documents are created in Firestore

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const twilio = require("twilio");
const express = require("express");
const bodyParser = require("body-parser");
const {
  onDocumentWritten,
  Change,
  FirestoreEvent,
} = require("firebase-functions/v2/firestore");
const {logger} = require("firebase-functions");

// Initialize Firebase Admin SDK
admin.initializeApp();

// Initialize Twilio client with your account credentials
// Replace these with your actual Twilio credentials
const twilioAccountSid = "";
const twilioAuthToken = "";
const twilioPhoneNumber = "whatsapp:+1415523888"; // Should be in format: 'whatsapp:+1234567890' whatsapp:+14155238886

const twilioClient = twilio(twilioAccountSid, twilioAuthToken);

/**
 * Cloud Function that triggers when a new document is created in the 'posts' collection
 * and sends a WhatsApp message to the user's phone number using Twilio
 */
// Create Express app for webhook handling
const app = express();
app.use(bodyParser.urlencoded({extended: false}));

/**
 * Cloud Function to handle incoming WhatsApp messages via webhook
 * This processes responses to the interactive options
 */
exports.handleWhatsAppWebhook = functions.https.onRequest(app);

// Configure the Express app to handle POST requests from Twilio
app.post("/", async (req, res) => {
  try {
    // Extract the message information from the Twilio webhook
    const incomingMsg = req.body.Body ? req.body.Body.trim() : "";
    const fromNumber = req.body.From || "";
    const sessionId = req.body.SessionSid || "";

    // Get the user's active session from Firestore
    const sessionRef = admin.firestore().collection("whatsapp_sessions").doc(fromNumber);
    const sessionDoc = await sessionRef.get();
    const sessionData = sessionDoc.exists ? sessionDoc.data() : null;

    // Process user choice
    let responseMessage = "";

    // Check if this is a response to our menu options
    if (sessionData && sessionData.activePostId) {
      const postId = sessionData.activePostId;

      // Handle different menu options
      switch (incomingMsg) {
        case "1":
          // Add comment option
          responseMessage = `To add a comment to post ${postId}, please type your comment now.`;
          await sessionRef.update({
            state: "awaiting_comment",
            lastActivity: admin.firestore.FieldValue.serverTimestamp(),
          });
          break;

        case "2":
          // View analytics option
          const analytics = await getPostAnalytics(postId);
          responseMessage = `*Analytics for Post ${postId}*\n\n${analytics}`;
          await sessionRef.update({
            state: "main_menu",
            lastActivity: admin.firestore.FieldValue.serverTimestamp(),
          });
          break;

        case "3":
          // Translate option
          responseMessage = `Select language for translation:\n1. Swahili\n2. Kikuyu\n3. Luo\n4. Kisii\n5. Kalenjin\n\nReply with the number of your choice.`;
          await sessionRef.update({
            state: "selecting_language",
            lastActivity: admin.firestore.FieldValue.serverTimestamp(),
          });
          break;

        case "4":
          // Export submission option
          responseMessage = `Your submission export has been scheduled. You'll receive it shortly as a PDF.`;

          // Trigger the export process
          await exportPostData(postId, fromNumber);

          await sessionRef.update({
            state: "main_menu",
            lastActivity: admin.firestore.FieldValue.serverTimestamp(),
          });
          break;

        default:
          // Handle comment submission or other states
          if (sessionData.state === "awaiting_comment") {
            await addCommentToPost(postId, fromNumber, incomingMsg);
            responseMessage = `Your comment has been added to post ${postId}. Thank you!`;
            await sessionRef.update({
              state: "main_menu",
              lastActivity: admin.firestore.FieldValue.serverTimestamp(),
            });
          } else if (sessionData.state === "selecting_language" &&
            ["1", "2", "3", "4", "5"].includes(incomingMsg)) {
            const languages = {
              1: "Swahili",
              2: "Kikuyu",
              3: "Luo",
              4: "Kisii",
              5: "Kalenjin",
            };
            const language = languages[incomingMsg];
            responseMessage = `Post will be translated to ${language}. You'll receive the translation shortly.`;

            // Trigger translation process
            await translatePost(postId, fromNumber, language);

            await sessionRef.update({
              state: "main_menu",
              lastActivity: admin.firestore.FieldValue.serverTimestamp(),
            });
          } else {
            responseMessage = `I don't understand that choice. Please reply with a number 1-4.`;
          }
      }
    } else {
      // No active session, provide generic help
      responseMessage = `Sorry, I couldn't find an active post for you to interact with. Please try again later.`;
    }

    // Send the response back to the user
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(responseMessage);

    // Set content type and send response
    res.set("Content-Type", "text/xml");
    res.send(twiml.toString());
  } catch (error) {
    console.error("Error handling webhook:", error);
    res.status(500).send("Error processing message");
  }
});

/**
 * Add a comment to a post
 */
async function addCommentToPost(postId, userPhone, commentText) {
  const commentRef = admin.firestore().collection("policies").doc(postId).collection("comments").doc();
  await commentRef.set({
    text: commentText,
    userPhone: userPhone,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Update comment count on the main post document
  const postRef = admin.firestore().collection("policies").doc(postId);
  await postRef.update({
    commentCount: admin.firestore.FieldValue.increment(1),
  });
}

/**
 * Get analytics for a specific post
 */
async function getPostAnalytics(postId) {
  const postRef = admin.firestore().collection("policies").doc(postId);
  const postDoc = await postRef.get();

  if (!postDoc.exists) {
    return "Post not found";
  }

  const data = postDoc.data();

  // Get comment count
  const commentsSnapshot = await postRef.collection("comments").count().get();
  const commentCount = commentsSnapshot.data().count;

  // Format analytics information
  return `Views: ${data.viewCount || 0}\nComments: ${commentCount}\nShares: ${
    data.shareCount || 0
  }\nLikes: ${data.likeCount || 0}`;
}

/**
 * Translate post content
 * In a real app, you would integrate with a translation API
 */
async function translatePost(postId, userPhone, language) {
  const postRef = admin.firestore().collection("policies").doc(postId);
  const postDoc = await postRef.get();

  if (!postDoc.exists) {
    return;
  }

  const postData = postDoc.data();

  // In a real app, call a translation API here
  // For demo purposes, we'll just send a mock translated message
  setTimeout(async () => {
    await twilioClient.messages.create({
      body:
        `*${postData.title}* [Translated to ${language}]\n\n` +
        `[Translated content would appear here]\n\n` +
        `Original posted by: ${postData.author || "Anonymous"}`,
      from: twilioPhoneNumber,
      to: userPhone,
    });
  }, 2000);
}

/**
 * Export post data as a document
 * In a real app, you would generate a PDF and send it
 */
async function exportPostData(postId, userPhone) {
  const postRef = admin.firestore().collection("policies").doc(postId);
  const postDoc = await postRef.get();

  if (!postDoc.exists) {
    return;
  }

  // In a real app, generate PDF here
  // For demo purposes, we'll just send a mock message
  setTimeout(async () => {
    await twilioClient.messages.create({
      body:
        `Your export for post ${postId} is ready.\n\n` +
        `[In a production app, a PDF document would be attached here]`,
      from: twilioPhoneNumber,
      to: userPhone,
    });
  }, 3000);
}

// Define the Firestore document trigger for sending WhatsApp notifications
exports.sendWhatsAppNotification = onDocumentWritten(
    "policies/{postId}",
    async (event) => {
      try {
        const postId = event.params.postId; // Get the postId from Firestore path parameters
        logger.info(`New document created in 'policies' collection with postId: ${postId}`);

        // Get the data from the Firestore snapshot
        const postData = event.data?.after?.data();
        logger.info(`Post data for postId ${postId}:`, postData);

        // Validate that necessary data exists
        if (!postData) {
          logger.error(`Post data is undefined or null for postId: ${postId}`);
          return null;
        }

        // Create message content from post data
        const {recipientNumbers = ["+0835"]} = postData;


        const messageContent = formatMessage(postData);
        logger.info(`Sending WhatsApp message to ${recipientNumbers.length} recipients.`);
        logger.info(`Message content: ${messageContent}`);
        logger.info(`Recipient numbers: ${recipientNumbers}`);

        // Send WhatsApp messages to all recipients
        const messagePromises = recipientNumbers.map((phoneNumber) => {
          const whatsappNumber = phoneNumber.startsWith("whatsapp:") ? phoneNumber : `whatsapp:${phoneNumber}`;
          return twilioClient.messages.create({
            body: messageContent,
            from: twilioPhoneNumber,
            to: whatsappNumber,
          });
        });

        // Wait for all messages to be sent
        const results = await Promise.all(messagePromises);

        // Log results
        results.forEach((message, index) => {
          logger.info(
              `Message sent to ${recipientNumbers[index]}, SID: ${message.sid}`,
          );
        });

        // Create or update session data for each recipient
        const sessionUpdates = recipientNumbers.map((phoneNumber) => {
          const whatsappNumber = phoneNumber.startsWith("whatsapp:") ? phoneNumber : `whatsapp:${phoneNumber}`;
          return admin.firestore().collection("whatsapp_sessions").doc(whatsappNumber).set(
              {
                activePostId: postId,
                state: "main_menu",
                lastActivity: admin.firestore.FieldValue.serverTimestamp(),
              },
              {merge: true},
          );
        });

        await Promise.all(sessionUpdates);

        return {
          success: true,
          messagesSent: results.length,
        };
      } catch (error) {
        logger.error(
            `Error sending WhatsApp notification for postId ${event.params.postId}:`,
            error,
        );

        return {
          success: false,
          error: error.message,
        };
      }
    },
);

/**
 * Format message content based on post data
 * Includes interactive options for the WhatsApp bot UI
 */
function formatMessage(postData) {
  // Extract post details
  const title = postData.title || "New Post";
  const body = postData.content || "";
  const pdfLink = postData.pdfLink || "";
  const author = postData.author || "Nairobi County";

  // Format the main message content
  const messageContent = `📢 *${title}*\n\n${body}\n\nRead more: ${pdfLink}`;

  // Add interactive options as numbered choices
  const options = `\n\n*Available Actions:*\n1️⃣ Add comment\n2️⃣ View analytics\n3️⃣ Translate\n4️⃣ Export submission\n\nReply with the number of your choice.`;

  return messageContent + options;
}
