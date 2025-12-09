/**
 * Firebase Cloud Functions for Yetwork
 * Handles email notifications via Resend
 */

const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { Resend } = require("resend");

// Initialize Firebase Admin
admin.initializeApp();

// Set global options
setGlobalOptions({ region: "europe-west1" });

// Define secret for Resend API key
const resendApiKey = defineSecret("RESEND_API_KEY");

// App configuration
const APP_URL = process.env.APP_URL || "https://yet.lu";
const FROM_EMAIL = "Yetwork <noreply@yet.lu>";

/**
 * Trigger: When a new invite document is created
 * Action: Send invitation email via Resend
 */
exports.sendInviteEmail = onDocumentCreated(
  {
    document: "invites/{inviteId}",
    secrets: [resendApiKey],
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("No data associated with the event");
      return null;
    }

    const invite = snapshot.data();
    const inviteId = event.params.inviteId;

    // Only send email for pending invites
    if (invite.status !== "pending") {
      console.log("Invite is not pending, skipping email");
      return null;
    }

    // Skip if email already sent
    if (invite.emailSent) {
      console.log("Email already sent for this invite");
      return null;
    }

    try {
      const resend = new Resend(resendApiKey.value());

      // Get inviter name
      let inviterName = "A team member";
      if (invite.invitedBy) {
        const inviterDoc = await admin
          .firestore()
          .collection("users")
          .doc(invite.invitedBy)
          .get();
        if (inviterDoc.exists) {
          inviterName = inviterDoc.data().name || inviterDoc.data().email || inviterName;
        }
      }

      const acceptUrl = `${APP_URL}/accept-invite?token=${inviteId}`;
      const roleName = invite.role.charAt(0).toUpperCase() + invite.role.slice(1);

      // Send email
      const { data, error } = await resend.emails.send({
        from: FROM_EMAIL,
        to: invite.email,
        subject: `You're invited to join ${invite.tenantName} on Yetwork`,
        html: generateInviteEmailHtml({
          tenantName: invite.tenantName,
          inviterName,
          roleName,
          acceptUrl,
          email: invite.email,
        }),
        text: generateInviteEmailText({
          tenantName: invite.tenantName,
          inviterName,
          roleName,
          acceptUrl,
        }),
      });

      if (error) {
        console.error("Error sending email:", error);
        throw new Error(error.message);
      }

      console.log("Email sent successfully:", data);

      // Mark email as sent
      await snapshot.ref.update({
        emailSent: true,
        emailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        emailId: data.id,
      });

      return { success: true, emailId: data.id };
    } catch (error) {
      console.error("Error in sendInviteEmail:", error);

      // Mark email as failed
      await snapshot.ref.update({
        emailError: error.message,
        emailAttemptedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { success: false, error: error.message };
    }
  }
);

/**
 * Generate HTML email template for invite
 */
function generateInviteEmailHtml({ tenantName, inviterName, roleName, acceptUrl, email }) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're Invited to ${tenantName}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="min-height: 100vh;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center;">
              <div style="width: 60px; height: 60px; background-color: #2563eb; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px;">
                <span style="color: white; font-size: 24px; font-weight: bold;">Y</span>
              </div>
              <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #111827;">
                You're invited to join
              </h1>
              <h2 style="margin: 8px 0 0; font-size: 28px; font-weight: 700; color: #2563eb;">
                ${tenantName}
              </h2>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 20px 40px;">
              <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #4b5563;">
                Hi there,
              </p>
              <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #4b5563;">
                <strong>${inviterName}</strong> has invited you to join <strong>${tenantName}</strong> as a <strong>${roleName}</strong> on Yetwork.
              </p>
              <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #4b5563;">
                Yetwork is a project management platform that helps teams collaborate and deliver projects efficiently.
              </p>

              <!-- CTA Button -->
              <div style="text-align: center; margin: 32px 0;">
                <a href="${acceptUrl}" style="display: inline-block; padding: 14px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">
                  Accept Invitation
                </a>
              </div>

              <p style="margin: 24px 0 0; font-size: 14px; line-height: 1.6; color: #6b7280;">
                Or copy and paste this link into your browser:
              </p>
              <p style="margin: 8px 0 0; font-size: 14px; line-height: 1.6; color: #2563eb; word-break: break-all;">
                ${acceptUrl}
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 40px 40px;">
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 0 0 20px;">
              <p style="margin: 0; font-size: 12px; line-height: 1.6; color: #9ca3af; text-align: center;">
                This invitation was sent to ${email}. If you didn't expect this email, you can safely ignore it.
              </p>
              <p style="margin: 12px 0 0; font-size: 12px; line-height: 1.6; color: #9ca3af; text-align: center;">
                This invitation expires in 7 days.
              </p>
            </td>
          </tr>
        </table>

        <!-- Brand Footer -->
        <p style="margin: 24px 0 0; font-size: 12px; color: #9ca3af;">
          Powered by <a href="https://yet.lu" style="color: #2563eb; text-decoration: none;">Yetwork</a>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Generate plain text email for invite
 */
function generateInviteEmailText({ tenantName, inviterName, roleName, acceptUrl }) {
  return `
You're invited to join ${tenantName}

Hi there,

${inviterName} has invited you to join ${tenantName} as a ${roleName} on Yetwork.

Yetwork is a project management platform that helps teams collaborate and deliver projects efficiently.

Accept your invitation by clicking the link below:
${acceptUrl}

This invitation expires in 7 days.

---
Powered by Yetwork (https://yet.lu)
  `.trim();
}

/**
 * Trigger: When a task is assigned or reassigned
 * Action: Send notification email to the assignee
 */
exports.sendTaskAssignedEmail = onDocumentUpdated(
  {
    document: "tenants/{tenantId}/projects/{projectId}/tasks/{taskId}",
    secrets: [resendApiKey],
  },
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();

    // Check if assignee changed
    if (before.assignedTo === after.assignedTo) {
      return null;
    }

    // Only send if there's a new assignee
    if (!after.assignedTo) {
      return null;
    }

    const { tenantId, projectId, taskId } = event.params;

    try {
      // Get assignee user details
      const userDoc = await admin.firestore().collection("users").doc(after.assignedTo).get();
      if (!userDoc.exists) {
        console.log("Assignee user not found");
        return null;
      }

      const user = userDoc.data();

      // Check user notification preferences
      if (user.emailPreferences?.taskAssigned === false) {
        console.log("User has disabled task assigned emails");
        return null;
      }

      // Get project and tenant info
      const projectDoc = await admin.firestore()
        .collection("tenants").doc(tenantId)
        .collection("projects").doc(projectId)
        .get();

      const tenantDoc = await admin.firestore().collection("tenants").doc(tenantId).get();

      const project = projectDoc.exists ? projectDoc.data() : { title: "Unknown Project" };
      const tenant = tenantDoc.exists ? tenantDoc.data() : { name: "Unknown Organization" };

      // Get assigner name
      let assignerName = "Someone";
      if (after.updatedBy) {
        const assignerDoc = await admin.firestore().collection("users").doc(after.updatedBy).get();
        if (assignerDoc.exists) {
          assignerName = assignerDoc.data().name || assignerDoc.data().email || assignerName;
        }
      }

      const taskUrl = `${APP_URL}/t/${tenant.slug}/projects/${projectId}?task=${taskId}`;

      const resend = new Resend(resendApiKey.value());

      await resend.emails.send({
        from: FROM_EMAIL,
        to: user.email,
        subject: `Task assigned: ${after.title}`,
        html: generateTaskAssignedHtml({
          taskTitle: after.title,
          taskDescription: after.description,
          projectTitle: project.title,
          tenantName: tenant.name,
          assignerName,
          priority: after.priority,
          dueDate: after.dueDate,
          taskUrl,
        }),
        text: generateTaskAssignedText({
          taskTitle: after.title,
          projectTitle: project.title,
          tenantName: tenant.name,
          assignerName,
          taskUrl,
        }),
      });

      console.log("Task assigned email sent to:", user.email);
      return { success: true };
    } catch (error) {
      console.error("Error sending task assigned email:", error);
      return { success: false, error: error.message };
    }
  }
);

/**
 * Trigger: Daily at 8am - Send due date reminders
 * Action: Email users about tasks due today or tomorrow
 */
exports.sendDueDateReminders = onSchedule(
  {
    schedule: "0 8 * * *",
    timeZone: "Europe/Luxembourg",
    secrets: [resendApiKey],
  },
  async () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfterTomorrow = new Date(today);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);

    try {
      // Get all tenants
      const tenantsSnapshot = await admin.firestore().collection("tenants").get();

      for (const tenantDoc of tenantsSnapshot.docs) {
        const tenant = tenantDoc.data();
        const tenantId = tenantDoc.id;

        // Get all projects in tenant
        const projectsSnapshot = await admin.firestore()
          .collection("tenants").doc(tenantId)
          .collection("projects").get();

        for (const projectDoc of projectsSnapshot.docs) {
          const project = projectDoc.data();
          const projectId = projectDoc.id;

          // Get tasks due today or tomorrow
          const tasksSnapshot = await admin.firestore()
            .collection("tenants").doc(tenantId)
            .collection("projects").doc(projectId)
            .collection("tasks")
            .where("dueDate", ">=", admin.firestore.Timestamp.fromDate(today))
            .where("dueDate", "<", admin.firestore.Timestamp.fromDate(dayAfterTomorrow))
            .where("status", "!=", "done")
            .get();

          // Group tasks by assignee
          const tasksByAssignee = {};
          tasksSnapshot.docs.forEach((taskDoc) => {
            const task = taskDoc.data();
            if (task.assignedTo) {
              if (!tasksByAssignee[task.assignedTo]) {
                tasksByAssignee[task.assignedTo] = [];
              }
              tasksByAssignee[task.assignedTo].push({
                ...task,
                id: taskDoc.id,
                projectTitle: project.title,
                projectId,
              });
            }
          });

          // Send emails to each assignee
          for (const [userId, tasks] of Object.entries(tasksByAssignee)) {
            const userDoc = await admin.firestore().collection("users").doc(userId).get();
            if (!userDoc.exists) continue;

            const user = userDoc.data();

            // Check preferences
            if (user.emailPreferences?.dueReminders === false) continue;

            const resend = new Resend(resendApiKey.value());

            await resend.emails.send({
              from: FROM_EMAIL,
              to: user.email,
              subject: `${tasks.length} task${tasks.length > 1 ? "s" : ""} due soon in ${tenant.name}`,
              html: generateDueReminderHtml({
                userName: user.name || "there",
                tenantName: tenant.name,
                tenantSlug: tenant.slug,
                tasks,
              }),
              text: generateDueReminderText({
                tenantName: tenant.name,
                tasks,
              }),
            });

            console.log(`Due reminder sent to ${user.email} for ${tasks.length} tasks`);
          }
        }
      }

      return { success: true };
    } catch (error) {
      console.error("Error sending due date reminders:", error);
      return { success: false, error: error.message };
    }
  }
);

/**
 * Trigger: When a comment is added to a task
 * Action: Notify task assignee and mentioned users
 */
exports.sendCommentNotification = onDocumentCreated(
  {
    document: "tenants/{tenantId}/projects/{projectId}/tasks/{taskId}/comments/{commentId}",
    secrets: [resendApiKey],
  },
  async (event) => {
    const comment = event.data.data();
    const { tenantId, projectId, taskId } = event.params;

    try {
      // Get task details
      const taskDoc = await admin.firestore()
        .collection("tenants").doc(tenantId)
        .collection("projects").doc(projectId)
        .collection("tasks").doc(taskId)
        .get();

      if (!taskDoc.exists) return null;
      const task = taskDoc.data();

      // Get project and tenant
      const projectDoc = await admin.firestore()
        .collection("tenants").doc(tenantId)
        .collection("projects").doc(projectId)
        .get();
      const tenantDoc = await admin.firestore().collection("tenants").doc(tenantId).get();

      const project = projectDoc.exists ? projectDoc.data() : { title: "Unknown Project" };
      const tenant = tenantDoc.exists ? tenantDoc.data() : { name: "Unknown", slug: "unknown" };

      // Get commenter details
      let commenterName = "Someone";
      if (comment.createdBy) {
        const commenterDoc = await admin.firestore().collection("users").doc(comment.createdBy).get();
        if (commenterDoc.exists) {
          commenterName = commenterDoc.data().name || commenterDoc.data().email || commenterName;
        }
      }

      const taskUrl = `${APP_URL}/t/${tenant.slug}/projects/${projectId}?task=${taskId}`;

      // Collect users to notify (assignee + mentioned users)
      const usersToNotify = new Set();

      // Add task assignee (if not the commenter)
      if (task.assignedTo && task.assignedTo !== comment.createdBy) {
        usersToNotify.add(task.assignedTo);
      }

      // Extract mentioned users from comment (@mentions)
      const mentionRegex = /@\[([^\]]+)\]\(([^)]+)\)/g;
      let match;
      while ((match = mentionRegex.exec(comment.text)) !== null) {
        const mentionedUserId = match[2];
        if (mentionedUserId !== comment.createdBy) {
          usersToNotify.add(mentionedUserId);
        }
      }

      const resend = new Resend(resendApiKey.value());

      for (const userId of usersToNotify) {
        const userDoc = await admin.firestore().collection("users").doc(userId).get();
        if (!userDoc.exists) continue;

        const user = userDoc.data();

        // Check preferences
        if (user.emailPreferences?.comments === false) continue;

        await resend.emails.send({
          from: FROM_EMAIL,
          to: user.email,
          subject: `New comment on: ${task.title}`,
          html: generateCommentNotificationHtml({
            taskTitle: task.title,
            projectTitle: project.title,
            tenantName: tenant.name,
            commenterName,
            commentText: comment.text.replace(mentionRegex, "$1"), // Clean up mentions
            taskUrl,
          }),
          text: generateCommentNotificationText({
            taskTitle: task.title,
            commenterName,
            commentText: comment.text.replace(mentionRegex, "$1"),
            taskUrl,
          }),
        });

        console.log("Comment notification sent to:", user.email);
      }

      return { success: true };
    } catch (error) {
      console.error("Error sending comment notification:", error);
      return { success: false, error: error.message };
    }
  }
);

// ============================================
// Email Template Functions
// ============================================

function generateTaskAssignedHtml({ taskTitle, taskDescription, projectTitle, tenantName, assignerName, priority, dueDate, taskUrl }) {
  const priorityColors = {
    high: "#ef4444",
    medium: "#f59e0b",
    low: "#22c55e",
  };
  const priorityColor = priorityColors[priority] || priorityColors.medium;

  const dueDateStr = dueDate ? new Date(dueDate._seconds * 1000).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }) : null;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 8px; font-size: 14px; color: #6b7280;">
                ${tenantName} &middot; ${projectTitle}
              </p>
              <h1 style="margin: 0 0 16px; font-size: 20px; font-weight: 600; color: #111827;">
                📋 Task Assigned to You
              </h1>
              <p style="margin: 0 0 24px; font-size: 15px; color: #4b5563;">
                <strong>${assignerName}</strong> assigned you a task:
              </p>

              <div style="background-color: #f9fafb; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
                <h2 style="margin: 0 0 8px; font-size: 18px; font-weight: 600; color: #111827;">
                  ${taskTitle}
                </h2>
                ${taskDescription ? `<p style="margin: 0 0 16px; font-size: 14px; color: #6b7280;">${taskDescription.substring(0, 200)}${taskDescription.length > 200 ? "..." : ""}</p>` : ""}
                <div style="display: flex; gap: 16px; flex-wrap: wrap;">
                  <span style="font-size: 12px; color: ${priorityColor}; font-weight: 500;">
                    ● ${priority.charAt(0).toUpperCase() + priority.slice(1)} Priority
                  </span>
                  ${dueDateStr ? `<span style="font-size: 12px; color: #6b7280;">📅 Due ${dueDateStr}</span>` : ""}
                </div>
              </div>

              <div style="text-align: center;">
                <a href="${taskUrl}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; border-radius: 6px;">
                  View Task
                </a>
              </div>
            </td>
          </tr>
        </table>
        <p style="margin: 24px 0 0; font-size: 12px; color: #9ca3af;">
          Yetwork &middot; <a href="${APP_URL}" style="color: #2563eb;">yet.lu</a>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

function generateTaskAssignedText({ taskTitle, projectTitle, tenantName, assignerName, taskUrl }) {
  return `
Task Assigned to You

${assignerName} assigned you a task in ${tenantName}:

${taskTitle}
Project: ${projectTitle}

View task: ${taskUrl}

---
Yetwork (${APP_URL})
  `.trim();
}

function generateDueReminderHtml({ userName, tenantName, tenantSlug, tasks }) {
  const taskRows = tasks.map((task) => {
    const dueDate = new Date(task.dueDate._seconds * 1000);
    const isToday = dueDate.toDateString() === new Date().toDateString();
    const taskUrl = `${APP_URL}/t/${tenantSlug}/projects/${task.projectId}?task=${task.id}`;

    return `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
          <a href="${taskUrl}" style="color: #2563eb; text-decoration: none; font-weight: 500;">${task.title}</a>
          <p style="margin: 4px 0 0; font-size: 12px; color: #6b7280;">${task.projectTitle}</p>
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">
          <span style="font-size: 12px; color: ${isToday ? "#ef4444" : "#f59e0b"}; font-weight: 500;">
            ${isToday ? "Due Today" : "Due Tomorrow"}
          </span>
        </td>
      </tr>
    `;
  }).join("");

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="padding: 32px;">
              <h1 style="margin: 0 0 8px; font-size: 20px; font-weight: 600; color: #111827;">
                ⏰ Tasks Due Soon
              </h1>
              <p style="margin: 0 0 24px; font-size: 15px; color: #4b5563;">
                Hi ${userName}, you have ${tasks.length} task${tasks.length > 1 ? "s" : ""} due soon in ${tenantName}.
              </p>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid #e5e7eb; border-radius: 8px;">
                <thead>
                  <tr>
                    <th style="padding: 12px; text-align: left; font-size: 12px; font-weight: 600; color: #6b7280; background-color: #f9fafb; border-bottom: 1px solid #e5e7eb;">Task</th>
                    <th style="padding: 12px; text-align: right; font-size: 12px; font-weight: 600; color: #6b7280; background-color: #f9fafb; border-bottom: 1px solid #e5e7eb;">Due</th>
                  </tr>
                </thead>
                <tbody>
                  ${taskRows}
                </tbody>
              </table>

              <div style="text-align: center; margin-top: 24px;">
                <a href="${APP_URL}/t/${tenantSlug}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; border-radius: 6px;">
                  View All Tasks
                </a>
              </div>
            </td>
          </tr>
        </table>
        <p style="margin: 24px 0 0; font-size: 12px; color: #9ca3af;">
          Yetwork &middot; <a href="${APP_URL}" style="color: #2563eb;">yet.lu</a>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

function generateDueReminderText({ tenantName, tasks }) {
  const taskList = tasks.map((task) => {
    const dueDate = new Date(task.dueDate._seconds * 1000);
    const isToday = dueDate.toDateString() === new Date().toDateString();
    return `- ${task.title} (${task.projectTitle}) - ${isToday ? "Due Today" : "Due Tomorrow"}`;
  }).join("\n");

  return `
Tasks Due Soon in ${tenantName}

${taskList}

---
Yetwork (${APP_URL})
  `.trim();
}

function generateCommentNotificationHtml({ taskTitle, projectTitle, tenantName, commenterName, commentText, taskUrl }) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 8px; font-size: 14px; color: #6b7280;">
                ${tenantName} &middot; ${projectTitle}
              </p>
              <h1 style="margin: 0 0 16px; font-size: 20px; font-weight: 600; color: #111827;">
                💬 New Comment on "${taskTitle}"
              </h1>

              <div style="background-color: #f9fafb; border-left: 3px solid #2563eb; padding: 16px; margin-bottom: 24px;">
                <p style="margin: 0 0 8px; font-size: 14px; font-weight: 600; color: #111827;">
                  ${commenterName}
                </p>
                <p style="margin: 0; font-size: 14px; color: #4b5563; white-space: pre-wrap;">
                  ${commentText.substring(0, 500)}${commentText.length > 500 ? "..." : ""}
                </p>
              </div>

              <div style="text-align: center;">
                <a href="${taskUrl}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; border-radius: 6px;">
                  View Conversation
                </a>
              </div>
            </td>
          </tr>
        </table>
        <p style="margin: 24px 0 0; font-size: 12px; color: #9ca3af;">
          Yetwork &middot; <a href="${APP_URL}" style="color: #2563eb;">yet.lu</a>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

function generateCommentNotificationText({ taskTitle, commenterName, commentText, taskUrl }) {
  return `
New Comment on "${taskTitle}"

${commenterName} commented:

${commentText}

View conversation: ${taskUrl}

---
Yetwork (${APP_URL})
  `.trim();
}
