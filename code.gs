/**
 * BACKEND CONFIGURATION & DATABASE SETUP
 */

// Run this function ONCE to create the Sheet and Drive Folders
function setupEnvironment() {
  const ss = SpreadsheetApp.create("Imgbuy_Database");
  const drive = DriveApp.getRootFolder();
  
  // Create Folders
  const qrFolder = drive.createFolder("Imgbuy_Payment_QRs");
  const stockFolder = drive.createFolder("Imgbuy_Stock_Images");
  
  // Setup User Sheet
  const userSheet = ss.insertSheet("Users");
  userSheet.appendRow(["User ID", "Name", "Mobile", "Email", "PasswordHash", "QR_File_ID", "Date_Joined"]);
  
  // Setup Images Sheet
  const imgSheet = ss.insertSheet("Images");
  imgSheet.appendRow(["Image ID", "User_Mobile", "Image_URL", "Category", "Status", "Earnings", "Upload_Date"]);
  
  // Setup Consent Sheet
  const consentSheet = ss.insertSheet("Consent_Logs");
  consentSheet.appendRow(["User_Mobile", "Image_ID", "Consent_Text", "Timestamp"]);
  
  // Delete default sheet
  try { ss.deleteSheet(ss.getSheetByName("Sheet1")); } catch(e) {}
  
  // Save IDs to Script Properties for global access
  const props = PropertiesService.getScriptProperties();
  props.setProperty("SHEET_ID", ss.getId());
  props.setProperty("QR_FOLDER_ID", qrFolder.getId());
  props.setProperty("STOCK_FOLDER_ID", stockFolder.getId());
  
  Logger.log("Setup Complete. Sheet ID: " + ss.getId());
}

/* --- WEB APP SERVING --- */

function doGet(e) {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('Imgbuy - Sell Your Photos')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* --- API HANDLERS --- */

// 1. SIGN UP
function apiSignup(data) {
  const props = PropertiesService.getScriptProperties();
  const ss = SpreadsheetApp.openById(props.getProperty("SHEET_ID"));
  const userSheet = ss.getSheetByName("Users");
  
  // Check duplicates
  const users = userSheet.getDataRange().getValues();
  for (let i = 1; i < users.length; i++) {
    if (users[i][2] == data.mobile || users[i][3] == data.email) {
      return { success: false, message: "User already exists with this mobile or email." };
    }
  }
  
  // Save QR Image
  const qrFolder = DriveApp.getFolderById(props.getProperty("QR_FOLDER_ID"));
  const blob = Utilities.newBlob(Utilities.base64Decode(data.qrFile.split(',')[1]), data.mimeType, "QR_" + data.mobile);
  const file = qrFolder.createFile(blob);
  
  // Hash Password
  const passwordHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, data.password)
    .reduce((str,chr) => str + (chr < 0 ? chr + 256 : chr).toString(16).padStart(2,'0'), '');
  
  // Save User
  const userId = "USER_" + new Date().getTime();
  userSheet.appendRow([userId, data.name, data.mobile, data.email, passwordHash, file.getId(), new Date()]);
  
  return { success: true, message: "Account created successfully! Please login." };
}

// 2. LOGIN
function apiLogin(loginInput, password) {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("SHEET_ID"));
  const users = ss.getSheetByName("Users").getDataRange().getValues();
  
  const inputHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)
    .reduce((str,chr) => str + (chr < 0 ? chr + 256 : chr).toString(16).padStart(2,'0'), '');

  for (let i = 1; i < users.length; i++) {
    // Check Mobile OR Email
    if ((users[i][2] == loginInput || users[i][3] == loginInput) && users[i][4] == inputHash) {
      return { 
        success: true, 
        token: users[i][2], // Using mobile as simple session token for this MVP
        name: users[i][1]
      };
    }
  }
  return { success: false, message: "Invalid credentials." };
}

// 3. UPLOAD IMAGE
function apiUploadImage(data) {
  const props = PropertiesService.getScriptProperties();
  const ss = SpreadsheetApp.openById(props.getProperty("SHEET_ID"));
  
  // Save Image to Drive
  const stockFolder = DriveApp.getFolderById(props.getProperty("STOCK_FOLDER_ID"));
  const blob = Utilities.newBlob(Utilities.base64Decode(data.fileBase64.split(',')[1]), data.mimeType, "STOCK_" + new Date().getTime());
  const file = stockFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  
  const imgId = "IMG_" + new Date().getTime();
  
  // Log to Images Sheet
  ss.getSheetByName("Images").appendRow([
    imgId, 
    data.userMobile, 
    file.getUrl(), 
    data.category, 
    "Pending Review", 
    "0", 
    new Date()
  ]);
  
  // Log Consent
  ss.getSheetByName("Consent_Logs").appendRow([
    data.userMobile,
    imgId,
    "AGREED: I have full right of this image and no one else can challenge it. I sell the image to Imgbuy.",
    new Date()
  ]);
  
  return { success: true, message: "Image uploaded! Wait for review to earn money." };
}

// 4. GET DASHBOARD DATA
function apiGetDashboard(userMobile) {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("SHEET_ID"));
  const data = ss.getSheetByName("Images").getDataRange().getValues();
  
  // Filter for specific user
  const userImages = data.filter(row => row[1] == userMobile).map(row => {
    return {
      status: row[4],
      earnings: row[5],
      date: new Date(row[6]).toLocaleDateString()
    };
  });
  
  return userImages;
}

// 5. RESET PASSWORD (Simulated)
function apiResetPassword(email) {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("SHEET_ID"));
  const users = ss.getSheetByName("Users").getDataRange().getValues();
  let found = false;
  
  for(let i=1; i<users.length; i++){
    if(users[i][3] == email){
      found = true;
      break;
    }
  }
  
  if(found){
    // In a real app, you would generate a token. Here we simulate the email.
    MailApp.sendEmail({
      to: email,
      subject: "Imgbuy Password Reset",
      body: "Hello, \n\nYou requested a password reset. Please contact admin support with your Mobile Number to verify identity manually as this is a beta version.\n\n- Imgbuy Team"
    });
    return { success: true, message: "Reset instructions sent to email." };
  } else {
    return { success: false, message: "Email not found." };
  }
}
