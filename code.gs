/**
 * BACKEND CONFIGURATION & DATABASE SETUP
 */
const ADMIN_EMAILS = ["aman@example.com"]; // REPLACE with your actual Gmail to access Admin Panel

function setupEnvironment() {
  const ss = SpreadsheetApp.create("Imgbuy_PRO_Database");
  const drive = DriveApp.getRootFolder();
  
  // Create Folders
  const qrFolder = drive.createFolder("Imgbuy_Payment_QRs");
  const stockFolder = drive.createFolder("Imgbuy_Stock_Images");
  
  // Setup User Sheet (Added: Referred_By, Wallet_Balance)
  const userSheet = ss.insertSheet("Users");
  userSheet.appendRow(["User ID", "Name", "Mobile", "Email", "PasswordHash", "QR_File_ID", "Date_Joined", "Referred_By", "Wallet_Balance"]);
  
  // Setup Images Sheet (Added: Admin_Comment)
  const imgSheet = ss.insertSheet("Images");
  imgSheet.appendRow(["Image ID", "User_Mobile", "Image_URL", "Category", "Status", "Earnings", "Upload_Date", "Admin_Comment"]);
  
  // Setup Consent Sheet
  const consentSheet = ss.insertSheet("Consent_Logs");
  consentSheet.appendRow(["User_Mobile", "Image_ID", "Consent_Text", "Timestamp"]);
  
  try { ss.deleteSheet(ss.getSheetByName("Sheet1")); } catch(e) {}
  
  const props = PropertiesService.getScriptProperties();
  props.setProperty("SHEET_ID", ss.getId());
  props.setProperty("QR_FOLDER_ID", qrFolder.getId());
  props.setProperty("STOCK_FOLDER_ID", stockFolder.getId());
}

function doGet(e) {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('Imgbuy PRO')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) { return HtmlService.createHtmlOutputFromFile(filename).getContent(); }

/* --- CORE API --- */

// 1. SIGN UP (With Referral)
function apiSignup(data) {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("SHEET_ID"));
  const userSheet = ss.getSheetByName("Users");
  const users = userSheet.getDataRange().getValues();
  
  // Check duplicates
  for (let i = 1; i < users.length; i++) {
    if (users[i][2] == data.mobile || users[i][3] == data.email) {
      return { success: false, message: "User already exists." };
    }
  }
  
  // Save QR
  const qrFolder = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty("QR_FOLDER_ID"));
  const blob = Utilities.newBlob(Utilities.base64Decode(data.qrFile.split(',')[1]), data.mimeType, "QR_" + data.mobile);
  const file = qrFolder.createFile(blob);
  
  // Hash Password
  const passwordHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, data.password)
    .reduce((str,chr) => str + (chr < 0 ? chr + 256 : chr).toString(16).padStart(2,'0'), '');
  
  const userId = "USER_" + new Date().getTime();
  // Columns: ID, Name, Mobile, Email, Hash, QR, Date, Referred_By, Wallet
  userSheet.appendRow([userId, data.name, data.mobile, data.email, passwordHash, file.getId(), new Date(), data.referral || "", 0]);
  
  // Send Welcome Email
  sendEmailNotification(data.email, "Welcome to Imgbuy!", 
    `Hi ${data.name},<br>Welcome to Imgbuy! Start uploading photos today.<br>Your Referral Code is your Mobile Number: <b>${data.mobile}</b>`);

  return { success: true, message: "Account created! Please Login." };
}

// 2. LOGIN (Checks for Admin)
function apiLogin(loginInput, password) {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("SHEET_ID"));
  const users = ss.getSheetByName("Users").getDataRange().getValues();
  
  const inputHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)
    .reduce((str,chr) => str + (chr < 0 ? chr + 256 : chr).toString(16).padStart(2,'0'), '');

  for (let i = 1; i < users.length; i++) {
    if ((users[i][2] == loginInput || users[i][3] == loginInput) && users[i][4] == inputHash) {
      const email = users[i][3];
      const isAdmin = ADMIN_EMAILS.includes(email);
      return { 
        success: true, 
        token: users[i][2], 
        name: users[i][1],
        isAdmin: isAdmin
      };
    }
  }
  return { success: false, message: "Invalid credentials." };
}

// 3. UPLOAD (With Compression handling)
function apiUploadImage(data) {
  const props = PropertiesService.getScriptProperties();
  const ss = SpreadsheetApp.openById(props.getProperty("SHEET_ID"));
  
  const stockFolder = DriveApp.getFolderById(props.getProperty("STOCK_FOLDER_ID"));
  // Using generic name to avoid filename issues
  const blob = Utilities.newBlob(Utilities.base64Decode(data.fileBase64.split(',')[1]), data.mimeType, "STOCK_" + data.userMobile + "_" + new Date().getTime());
  const file = stockFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  
  const imgId = "IMG_" + new Date().getTime();
  ss.getSheetByName("Images").appendRow([imgId, data.userMobile, file.getUrl(), data.category, "Pending Review", "0", new Date(), ""]);
  ss.getSheetByName("Consent_Logs").appendRow([data.userMobile, imgId, "AGREED_FULL_RIGHTS", new Date()]);
  
  // Send Confirmation Email
  const userEmail = getUserEmail(data.userMobile);
  sendEmailNotification(userEmail, "Photo Received", "We received your photo. Our team will review it shortly.");
  
  return { success: true, message: "Uploaded successfully!" };
}

// 4. GET DASHBOARD & LEADERBOARD
function apiGetDashboard(userMobile) {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("SHEET_ID"));
  const data = ss.getSheetByName("Images").getDataRange().getValues();
  
  const userImages = data.filter(row => row[1] == userMobile).map(row => {
    return { status: row[4], earnings: row[5], date: new Date(row[6]).toLocaleDateString(), comment: row[7] };
  });
  
  // Leaderboard Logic (Top 5 Earners)
  // Note: This is a simplified calculation. Ideally, aggregate in a separate sheet.
  const users = ss.getSheetByName("Users").getDataRange().getValues();
  let leaderboard = [];
  
  // Calculate earnings per user
  let earningsMap = {};
  for(let i=1; i<data.length; i++) {
    let mob = data[i][1];
    let earn = parseFloat(data[i][5]) || 0;
    if(earningsMap[mob]) earningsMap[mob] += earn;
    else earningsMap[mob] = earn;
  }
  
  // Map back to names
  for(let i=1; i<users.length; i++) {
    let mob = users[i][2];
    if(earningsMap[mob] > 0) {
      leaderboard.push({ name: users[i][1], total: earningsMap[mob] });
    }
  }
  
  // Sort and Slice
  leaderboard.sort((a,b) => b.total - a.total);
  
  return { history: userImages, leaderboard: leaderboard.slice(0, 5) };
}

/* --- ADMIN FUNCTIONS ("God Mode") --- */

function apiAdminGetPending() {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("SHEET_ID"));
  const data = ss.getSheetByName("Images").getDataRange().getValues();
  const pending = [];
  
  for(let i=1; i<data.length; i++) {
    if(data[i][4] === "Pending Review") {
      pending.push({
        rowIndex: i + 1, // 1-based index for Sheet operations
        imgId: data[i][0],
        userMobile: data[i][1],
        url: data[i][2],
        category: data[i][3]
      });
    }
  }
  return pending;
}

function apiAdminProcess(rowIndex, action, amount, comment) {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("SHEET_ID"));
  const imgSheet = ss.getSheetByName("Images");
  const userSheet = ss.getSheetByName("Users");
  
  const rowData = imgSheet.getRange(rowIndex, 1, 1, 8).getValues()[0];
  const userMobile = rowData[1];
  const userEmail = getUserEmail(userMobile);
  
  if (action === "APPROVE") {
    imgSheet.getRange(rowIndex, 5).setValue("Approved");
    imgSheet.getRange(rowIndex, 6).setValue(amount);
    imgSheet.getRange(rowIndex, 8).setValue(comment);
    
    // Update User Wallet
    updateWallet(userMobile, amount);
    
    // REFERRAL CHECK: If this is their first approved photo?
    // Simplified: We just give referral bonus every time or check history.
    // For this code, let's give the referrer 10% of the earnings.
    handleReferralBonus(userMobile, amount);

    sendEmailNotification(userEmail, "Photo Sold! ₹" + amount, 
      `Congrats! Your photo was selected.<br>Amount: ₹${amount}<br>Comment: ${comment}`);
      
  } else {
    imgSheet.getRange(rowIndex, 5).setValue("Rejected");
    imgSheet.getRange(rowIndex, 8).setValue(comment);
    
    sendEmailNotification(userEmail, "Photo Update", 
      `Your photo was not selected.<br>Reason: ${comment}<br>Try uploading clearer images.`);
  }
  
  return { success: true };
}

/* --- HELPERS --- */

function getUserEmail(mobile) {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("SHEET_ID"));
  const users = ss.getSheetByName("Users").getDataRange().getValues();
  for(let i=1; i<users.length; i++) {
    if(users[i][2] == mobile) return users[i][3];
  }
  return "";
}

function updateWallet(mobile, amount) {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("SHEET_ID"));
  const sheet = ss.getSheetByName("Users");
  const data = sheet.getDataRange().getValues();
  for(let i=1; i<data.length; i++) {
    if(data[i][2] == mobile) {
      let current = parseFloat(data[i][8]) || 0;
      sheet.getRange(i+1, 9).setValue(current + parseFloat(amount));
      break;
    }
  }
}

function handleReferralBonus(userMobile, earningAmount) {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("SHEET_ID"));
  const sheet = ss.getSheetByName("Users");
  const data = sheet.getDataRange().getValues();
  
  // Find who referred this user
  let referrerMobile = "";
  for(let i=1; i<data.length; i++) {
    if(data[i][2] == userMobile) {
      referrerMobile = data[i][7]; // Referred_By column
      break;
    }
  }
  
  if(referrerMobile) {
    // Give 10% bonus
    const bonus = parseFloat(earningAmount) * 0.10;
    if(bonus > 0) updateWallet(referrerMobile, bonus);
  }
}

function sendEmailNotification(to, subject, htmlBody) {
  if(!to) return;
  try {
    MailApp.sendEmail({
      to: to,
      subject: "Imgbuy: " + subject,
      htmlBody: htmlBody + "<br><br><small>Team Imgbuy India</small>"
    });
  } catch(e) {
    console.log("Email failed: " + e.toString());
  }
}
